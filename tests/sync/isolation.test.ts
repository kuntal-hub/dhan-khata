/**
 * Gola isolation, owner separation and RBAC (requirement_v2 §2.4, §21 Test 9): the server never
 * lets data cross Golas or businesses, even with crafted requests; tampered totals are rejected.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authedCall } from "@/client/auth/session";
import { db } from "@/client/db/dexie";
import { META, getMeta, getSession } from "@/client/db/meta";
import { rebuildDailyAgg, saveDoc, upsertMaster, voidDoc } from "@/client/repo";
import { godownBalances, godownTrialBalance } from "@/client/queries/ledger";
import { discardOp } from "@/client/sync/resolve";
import type { Doc as Voucher, PullResponse, PushResponse } from "@/domain/schemas";
import { createBusinessWithOwner } from "@/server/business";
import { closeMongo, cols, getDb, type UserDoc } from "@/server/db";
import { archiveGodown, createGodown } from "@/server/godownService";
import { createUser, setGodownAccess } from "@/server/users";
import { expenseDraft, paymentDraft, purchaseDraft, saleDraft } from "../helpers/local";

const createVoucher = (g: string, d: Parameters<typeof saveDoc>[1]) => saveDoc(g, d);
const editVoucher = (g: string, id: string, d: Parameters<typeof saveDoc>[1], reason?: string) =>
  saveDoc(g, d, { id, ...(reason ? { reason } : {}) });
const voidVoucher = (g: string, id: string, reason: string) => voidDoc(g, id, reason);
const advance = (partyId: string, paise: bigint) =>
  paymentDraft("OUT", paise, { type: "PARTY_ADVANCE", id: null }, { partyId });
import { TestDevice, nonZero, serverBalances, useTestServer } from "../helpers/server";

const QTL = 100_000n;
const OWNER = { phone: "9830000101", password: "owner-pass-1" };
const MGR = { phone: "9830000102", password: "manager-pass" };
const OTHER = { phone: "9830000103", password: "other-owner-pass" };

let owner: UserDoc;
let manager: UserDoc;
let GA: string;
let GB: string;
const od = new TestDevice("iso-owner");
const md = new TestDevice("iso-manager");

async function swarna(godownId: string): Promise<string> {
  const v = await db()
    .varieties.where("godownId")
    .equals(godownId)
    .filter((x) => x.systemKey === "SWARNA")
    .first();
  return v!._id;
}

async function crafted(dev: TestDevice, ops: unknown[]): Promise<PushResponse> {
  dev.use();
  return authedCall<PushResponse>("/api/sync/push", {
    body: { deviceId: (await getSession())!.deviceId, ops },
  });
}

function opFor(v: Voucher, baseRev = 0, extra: Record<string, unknown> = {}) {
  return {
    opId: crypto.randomUUID(),
    godownId: v.godownId,
    entity: "voucher",
    entityId: v._id,
    op: "upsert",
    baseRev,
    payload: v,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

/** Remove a voucher that was only built to craft a request (never meant to sync). */
async function forgetLocal(...vs: Voucher[]): Promise<void> {
  const d = db();
  for (const v of vs) {
    await d.vouchers.delete(v._id);
    await d.ledgerLines.where("voucherId").equals(v._id).delete();
    await d.stockMoves.where("voucherId").equals(v._id).delete();
  }
  await d.outbox.clear();
  await rebuildDailyAgg(GA);
  await rebuildDailyAgg(GB);
}

let partyA: string;
let partyB: string;

beforeAll(async () => {
  useTestServer("iso");
  const mdb = await getDb();
  owner = (
    await createBusinessWithOwner(mdb, {
      ownerName: "Owner",
      mobile: OWNER.phone,
      password: OWNER.password,
      businessName: "Business One",
    })
  ).owner;
  GA = (await createGodown(mdb, owner, { name: "Rampur", code: "RP" }))._id;
  GB = (await createGodown(mdb, owner, { name: "Sonapur", code: "SP" }))._id;
  manager = await createUser(mdb, {
    businessId: owner.businessId,
    name: "Munshi",
    ...MGR,
    godownAccess: [{ godownId: GA, role: "manager" }],
  });

  await od.reset();
  await od.login(OWNER.phone, OWNER.password);
  await od.sync();
  partyA = (await upsertMaster(GA, "party", { name: "Farmer A", roles: ["FARMER"] }))._id;
  partyB = (await upsertMaster(GB, "party", { name: "Farmer B", roles: ["FARMER"] }))._id;
  await createVoucher(GB, purchaseDraft(partyB, await swarna(GB), 3n * QTL, 200000n));
  await od.sync();

  await md.reset();
  await md.login(MGR.phone, MGR.password);
  await md.sync();
});

afterAll(async () => {
  await closeMongo();
});

describe("godown isolation", () => {
  it("A never changes B end to end (G10 through repo + sync)", async () => {
    const before = nonZero(await serverBalances(GB));
    od.use();
    const sw = await swarna(GA);
    await createVoucher(GA, purchaseDraft(partyA, sw, 8n * QTL, 200000n));
    await createVoucher(GA, saleDraft(partyA, sw, 2n * QTL, 230000n));
    await createVoucher(GA, advance(partyA, 70000n));
    await createVoucher(GA, expenseDraft(4000n));
    await od.sync();
    expect(nonZero(await serverBalances(GB))).toEqual(before);
    expect(nonZero(await godownBalances(GB))).toEqual(before);
  });

  it("pull for a user with access to A only never returns B documents, lines or changelog", async () => {
    md.use();
    const res = await authedCall<PullResponse>("/api/sync/pull?since=0&limit=500");
    expect(res.godownIds).toEqual([GA]);
    for (const c of res.changes) {
      if (c.godownId === null) {
        expect(["godown", "user", "business"]).toContain(c.entity);
        if (c.entity === "godown") expect(c.entityId).toBe(GA);
        if (c.entity === "user") expect(c.entityId).toBe(manager._id);
      } else expect(c.godownId).toBe(GA);
      expect(JSON.stringify(c)).not.toContain(GB);
    }
    // Asking for B's feed directly is refused.
    await expect(authedCall(`/api/sync/pull?since=0&godownId=${GB}`)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Nothing of B is on the manager's device.
    expect(await db().godowns.get(GB)).toBeUndefined();
    expect(await db().vouchers.where("godownId").equals(GB).count()).toBe(0);
    expect(
      await db().ledgerLines.where("[godownId+date]").between([GB, ""], [GB, "￿"]).count(),
    ).toBe(0);
  });

  it("server rejects a voucher whose party belongs to another godown", async () => {
    od.use();
    od.offline = true;
    const v = await createVoucher(GA, advance(partyA, 100n));
    od.offline = false;
    await forgetLocal(v);
    const res = await crafted(od, [opFor({ ...v, partyId: partyB } as Voucher)]);
    expect(res.results[0]).toMatchObject({ result: "rejected", reason: "CROSS_GODOWN_REFERENCE" });
  });

  it("server rejects changing godownId on edit", async () => {
    od.use();
    const v = await createVoucher(GA, advance(partyA, 100n));
    await od.sync();
    const moved = { ...v, godownId: GB, partyId: partyB, rev: 2 } as Voucher;
    const res = await crafted(od, [opFor(moved, 1)]);
    expect(res.results[0]).toMatchObject({ result: "rejected", reason: "GODOWN_IMMUTABLE" });
  });

  it("archived godown is read-only", async () => {
    const mdb = await getDb();
    const GC = (await createGodown(mdb, owner, { name: "Old", code: "OLD" }))._id;
    od.use();
    await od.sync();
    const p = await upsertMaster(GC, "place", { name: "Ghat" });
    await archiveGodown(mdb, owner, GC);
    await od.sync();
    const [op] = await db().outbox.toArray();
    expect(op).toMatchObject({ entityId: p._id, status: "error", lastError: "GODOWN_ARCHIVED" });
    expect((await db().godowns.get(GC))?.status).toBe("archived");
    await discardOp(op!.seq!);
    await expect(createVoucher(GC, expenseDraft(1n))).rejects.toMatchObject({
      code: "GODOWN_ARCHIVED",
    });
  });
});

describe("owner separation (Test 9)", () => {
  const xd = new TestDevice("iso-other-owner");
  let other: UserDoc;
  let GX: string;
  beforeAll(async () => {
    const mdb = await getDb();
    other = (
      await createBusinessWithOwner(mdb, {
        ownerName: "Other",
        mobile: OTHER.phone,
        password: OTHER.password,
        businessName: "Business Two",
      })
    ).owner;
    GX = (await createGodown(mdb, other, { name: "Other Gola", code: "OX" }))._id;
    await xd.reset();
    await xd.login(OTHER.phone, OTHER.password);
    await xd.sync();
  });

  it("another business's owner sees none of business one", async () => {
    xd.use();
    expect((await db().godowns.toArray()).map((g) => g._id)).toEqual([GX]);
    const res = await authedCall<PullResponse>("/api/sync/pull?since=0&limit=500");
    expect(res.godownIds).toEqual([GX]);
    for (const c of res.changes) {
      expect(JSON.stringify(c)).not.toContain(GA);
      expect(JSON.stringify(c)).not.toContain(GB);
    }
    await expect(authedCall(`/api/sync/pull?since=0&godownId=${GA}`)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(other.businessId).not.toBe(owner.businessId);
  });

  it("crafted pushes into another business's Gola are rejected, whatever the payload says", async () => {
    od.use();
    od.offline = true;
    const v = await createVoucher(GA, advance(partyA, 100n));
    od.offline = false;
    await forgetLocal(v);
    // Same payload (business one) pushed by business two's owner.
    let res = await crafted(xd, [opFor(v)]);
    expect(res.results[0]).toMatchObject({ result: "rejected", reason: "FORBIDDEN" });
    // Payload rewritten to claim business two, still into business one's Gola.
    res = await crafted(xd, [opFor({ ...v, businessId: other.businessId } as Voucher)]);
    expect(res.results[0]).toMatchObject({ result: "rejected", reason: "FORBIDDEN" });
    // And business one's owner can't write a document claiming business two.
    res = await crafted(od, [opFor({ ...v, businessId: other.businessId } as Voucher)]);
    expect(res.results[0]).toMatchObject({ result: "rejected", reason: "FORBIDDEN" });
    const mdb = await getDb();
    expect(await cols(mdb).vouchers.countDocuments({ _id: v._id })).toBe(0);
  });

  it("a payment that points at a bill of another Gola is rejected", async () => {
    od.use();
    const bill = await createVoucher(GB, purchaseDraft(partyB, await swarna(GB), QTL, 200000n));
    await od.sync();
    od.offline = true;
    const p = await createVoucher(GA, advance(partyA, 100n));
    od.offline = false;
    await forgetLocal(p);
    const forged = { ...p, source: { type: "PURCHASE", id: bill._id } } as Voucher;
    const res = await crafted(od, [opFor(forged)]);
    expect(res.results[0]).toMatchObject({ result: "rejected", reason: "CROSS_GODOWN_REFERENCE" });
  });
});

describe("RBAC on the server", () => {
  it("crafted push to a godown without access is rejected", async () => {
    od.use();
    od.offline = true;
    const v = await createVoucher(GB, advance(partyB, 100n));
    od.offline = false;
    await forgetLocal(v);
    const res = await crafted(md, [opFor(v)]);
    expect(res.results[0]).toMatchObject({ result: "rejected", reason: "FORBIDDEN" });
  });

  it("roles without permission are rejected (viewer; entry creating an ungrouped sale)", async () => {
    od.use();
    od.offline = true;
    const sale = await createVoucher(GA, saleDraft(partyA, await swarna(GA), QTL, 200000n));
    const purchase = await createVoucher(GA, purchaseDraft(partyA, await swarna(GA), QTL, 200000n));
    od.offline = false;
    await forgetLocal(sale, purchase);
    const mdb = await getDb();

    await setGodownAccess(mdb, manager._id, [{ godownId: GA, role: "viewer" }]);
    let res = await crafted(md, [opFor(purchase)]);
    expect(res.results[0]).toMatchObject({ result: "rejected", reason: "FORBIDDEN" });

    await setGodownAccess(mdb, manager._id, [{ godownId: GA, role: "entry" }]);
    res = await crafted(md, [opFor(sale), opFor(purchase)]);
    expect(res.results.map((r) => [r.result, r.reason])).toEqual([
      ["rejected", "FORBIDDEN"],
      ["applied", undefined],
    ]);
    await setGodownAccess(mdb, manager._id, [{ godownId: GA, role: "manager" }]);
    md.use();
    await md.sync();
  });

  it("revoking access purges B locally only after B's pending ops are pushed", async () => {
    const mdb = await getDb();
    await setGodownAccess(mdb, manager._id, [
      { godownId: GA, role: "manager" },
      { godownId: GB, role: "manager" },
    ]);
    md.use();
    await md.sync();
    expect(await db().godowns.get(GB)).toBeDefined();
    expect(await db().vouchers.where("godownId").equals(GB).count()).toBeGreaterThan(0);

    // Pending B op, then access to B is revoked: B's data stays on the device (nothing lost).
    md.offline = true;
    await upsertMaster(GB, "place", { name: "Pending place" });
    md.offline = false;
    await setGodownAccess(mdb, manager._id, [{ godownId: GA, role: "manager" }]);
    await md.sync();
    expect(await db().godowns.get(GB)).toBeDefined();
    expect(await getMeta<string[]>(META.pendingPurge)).toEqual([GB]);
    const [op] = await db().outbox.toArray();
    expect(op).toMatchObject({ godownId: GB, status: "error", lastError: "FORBIDDEN" });

    // Once B has no ops left, the next sync purges it.
    await discardOp(op!.seq!);
    await md.sync();
    expect(await db().godowns.get(GB)).toBeUndefined();
    expect(await db().vouchers.where("godownId").equals(GB).count()).toBe(0);
    expect(await db().parties.where("godownId").equals(GB).count()).toBe(0);
    expect(await getMeta(META.pendingPurge)).toBeUndefined();
    // A is untouched.
    expect(await db().godowns.get(GA)).toBeDefined();
    expect((await godownTrialBalance(GA)).balanced).toBe(true);
  });

  it("a newly granted godown is bootstrapped from the start", async () => {
    const mdb = await getDb();
    await setGodownAccess(mdb, manager._id, [
      { godownId: GA, role: "manager" },
      { godownId: GB, role: "viewer" },
    ]);
    md.use();
    await md.sync();
    expect(await db().godowns.get(GB)).toBeDefined();
    expect(nonZero(await godownBalances(GB))).toEqual(nonZero(await serverBalances(GB)));
    expect(await db().varieties.where("godownId").equals(GB).count()).toBe(6);
  });
});

describe("exit criterion: offline create/edit/void in two godowns, then sync", () => {
  it("Dexie ledgers are correct and isolated; after sync server totals == device totals", async () => {
    od.use();
    await od.sync();
    const serverBefore = { A: await serverBalances(GA), B: await serverBalances(GB) };
    od.offline = true;
    const swA = await swarna(GA);
    const swB = await swarna(GB);
    const pA = await createVoucher(GA, purchaseDraft(partyA, swA, 10n * QTL, 200000n));
    const pB = await createVoucher(GB, purchaseDraft(partyB, swB, 6n * QTL, 220000n));
    await editVoucher(GA, pA._id, purchaseDraft(partyA, swA, 11n * QTL, 200000n), "re-weighed");
    const payB = await createVoucher(GB, advance(partyB, 300000n));
    await voidVoucher(GB, payB._id, "entered twice");
    await createVoucher(GB, advance(partyB, 250000n));
    await createVoucher(GA, saleDraft(partyA, swA, 4n * QTL, 240000n));
    await editVoucher(GB, pB._id, purchaseDraft(partyB, swB, 6n * QTL, 225000n));

    // Local, before sync: each godown balanced; B's change in party B only.
    for (const g of [GA, GB]) expect((await godownTrialBalance(g)).balanced).toBe(true);
    const localA = await godownBalances(GA);
    const localB = await godownBalances(GB);
    expect(localB.get(`PARTY:${partyB}`)! - (serverBefore.B.get(`PARTY:${partyB}`) ?? 0n)).toBe(
      -(6n * 225000n) + 250000n,
    );
    expect([...localA.keys()].some((k) => k === `PARTY:${partyB}`)).toBe(false);
    expect([...localB.keys()].some((k) => k === `PARTY:${partyA}`)).toBe(false);

    od.offline = false;
    await od.sync();
    expect(await db().outbox.count()).toBe(0);
    expect(nonZero(await serverBalances(GA))).toEqual(nonZero(await godownBalances(GA)));
    expect(nonZero(await serverBalances(GB))).toEqual(nonZero(await godownBalances(GB)));
  });
});

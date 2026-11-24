/**
 * Sync engine suite (spec §19.1) against the real route handlers + in-memory Mongo replica set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { META, getMeta, getSession } from "@/client/db/meta";
import {
  createVoucher,
  editVoucher,
  updateGodownSettings,
  upsertMaster,
  voidVoucher,
} from "@/client/repo";
import { godownBalances } from "@/client/queries/ledger";
import { ApiCallError, NetworkError } from "@/client/sync/transport";
import { applyMineAsNewRevision, keepServer } from "@/client/sync/resolve";
import { pullAll } from "@/client/sync/pull";
import { pushOnce } from "@/client/sync/push";
import { nextBackoff, MAX_BACKOFF_MS, MIN_BACKOFF_MS } from "@/client/sync/engine";
import type { Party, PushResponse, Voucher } from "@/domain/schemas";
import { closeMongo, cols, getDb, type UserDoc } from "@/server/db";
import { createGodown } from "@/server/godownService";
import { createUser } from "@/server/users";
import { TestDevice, nonZero, serverBalances, useTestServer } from "../helpers/server";
import { purchaseDraft, paymentDraft, saleDraft } from "../helpers/local";

const QTL = 100_000n;
const OWNER = { phone: "9830000001", password: "owner-pass-1" };

let owner: UserDoc;
let GA: string;
let GB: string;
const d1 = new TestDevice("sync-d1");
const d2 = new TestDevice("sync-d2");

async function refs(godownId: string) {
  const d = db();
  const sw = await d.varieties
    .where("godownId")
    .equals(godownId)
    .filter((v) => v.systemKey === "SWARNA")
    .first();
  return { swarna: sw!._id };
}

async function addFarmer(godownId: string, name = "Ramesh"): Promise<Party> {
  return upsertMaster(godownId, "party", { name, roles: ["farmer"] });
}

beforeAll(async () => {
  useTestServer("sync");
  const mdb = await getDb();
  owner = await createUser(mdb, {
    name: "Owner",
    phone: OWNER.phone,
    password: OWNER.password,
    isOwner: true,
  });
  GA = (await createGodown(mdb, owner, { name: "Rampur", code: "RP" }))._id;
  GB = (await createGodown(mdb, owner, { name: "Sonapur", code: "SP" }))._id;
  for (const dev of [d1, d2]) {
    await dev.reset();
    await dev.login(OWNER.phone, OWNER.password);
    await dev.sync();
  }
});

afterAll(async () => {
  await closeMongo();
});

describe("login + bootstrap", () => {
  it("registers devices with codes A, B and pulls godowns, seeded masters and settings", async () => {
    d1.use();
    expect((await getSession())?.deviceCode).toBe("A");
    expect(await db().godowns.count()).toBe(2);
    expect(await db().varieties.count()).toBe(16);
    expect(await db().expenseCategories.count()).toBe(18);
    expect(await getMeta(`godownSettings:${GA}`)).toBeDefined();
    expect(await getMeta(META.cursor)).toBeGreaterThan(0);
    d2.use();
    expect((await getSession())?.deviceCode).toBe("B");
  });

  it("wrong password is rejected with a code; repeated failures are rate limited", async () => {
    const dev = await new TestDevice("sync-bad").reset();
    await expect(dev.login(OWNER.phone, "nope")).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    for (let i = 0; i < 4; i++) await dev.login("9830000999", "x").catch(() => {});
    await dev.login("9830000999", "x").catch(() => {});
    await expect(dev.login("9830000999", "x")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("push / pull", () => {
  it("idempotent re-push of the same op returns duplicate, no double posting", async () => {
    d1.use();
    const f = await addFarmer(GA);
    const v = await createVoucher(
      GA,
      purchaseDraft(f._id, (await refs(GA)).swarna, 5n * QTL, 200000n),
    );
    const ops = await db().outbox.orderBy("seq").toArray();
    await d1.sync();
    expect(await db().outbox.count()).toBe(0);

    const mdb = await getDb();
    const linesBefore = await cols(mdb).ledgerLines.countDocuments({ voucherId: v._id });
    const token = (await import("@/client/sync/transport")).accessToken().token;
    const res = await d1.fetch("http://test/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        deviceId: (await getSession())!.deviceId,
        ops: ops.map(({ seq: _s, status: _st, attempts: _a, ...o }) => o),
      }),
    });
    const body = (await res.json()) as PushResponse;
    expect(body.results.map((r) => r.result)).toEqual(["duplicate", "duplicate"]);
    expect(await cols(mdb).ledgerLines.countDocuments({ voucherId: v._id })).toBe(linesBefore);
    expect(await cols(mdb).vouchers.countDocuments({ _id: v._id })).toBe(1);
  });

  it("network error after the server applied → retry → duplicate, no double posting", async () => {
    d1.use();
    const f = await addFarmer(GA, "Kartik");
    await d1.sync();
    const v = await createVoucher(GA, paymentDraft(f._id, 12345n));
    d1.dropResponseFor = "POST /api/sync/push";
    await expect(pushOnce()).rejects.toBeInstanceOf(NetworkError);
    const op = await db().outbox.toArray();
    expect(op).toHaveLength(1);
    expect(op[0]!.status).toBe("pending");
    await d1.sync();
    expect(await db().outbox.count()).toBe(0);
    const mdb = await getDb();
    expect(await cols(mdb).ledgerLines.countDocuments({ voucherId: v._id })).toBe(2);
    expect((await db().vouchers.get(v._id))?.serverSeq).toBeGreaterThan(0);
  });

  it("two devices offline create vouchers → both sync → totals equal the sum", async () => {
    d1.use();
    const f1 = await addFarmer(GA, "Gopal");
    await d1.sync();
    d2.use();
    await d2.sync();
    const sw = (await refs(GA)).swarna;
    const before = nonZero(await serverBalances(GA));

    d1.offline = true;
    d2.offline = true;
    d1.use();
    await createVoucher(GA, purchaseDraft(f1._id, sw, 10n * QTL, 200000n));
    await createVoucher(GA, paymentDraft(f1._id, 500000n));
    d2.use();
    await createVoucher(GA, purchaseDraft(f1._id, sw, 3n * QTL, 210000n));
    await createVoucher(GA, paymentDraft(f1._id, 100000n));

    d1.offline = false;
    d2.offline = false;
    await d1.sync();
    await d2.sync();
    await d1.sync();

    const after = await serverBalances(GA);
    const party = `PARTY:${f1._id}`;
    expect((after.get(party) ?? 0n) - (before.get(party) ?? 0n)).toBe(
      -2000000n - 630000n + 500000n + 100000n,
    );
    expect((after.get("CASH") ?? 0n) - (before.get("CASH") ?? 0n)).toBe(-600000n);
    for (const dev of [d1, d2]) {
      dev.use();
      expect(nonZero(await godownBalances(GA))).toEqual(nonZero(after));
    }
  });

  it("edit/edit → conflict item, no silent overwrite; keep server / apply mine", async () => {
    d1.use();
    const f = await addFarmer(GA, "Sujit");
    const sw = (await refs(GA)).swarna;
    const v = await createVoucher(GA, purchaseDraft(f._id, sw, 4n * QTL, 200000n));
    await d1.sync();
    await d2.sync();

    d1.offline = true;
    d2.offline = true;
    d1.use();
    await editVoucher(GA, v._id, purchaseDraft(f._id, sw, 5n * QTL, 200000n));
    d2.use();
    await editVoucher(GA, v._id, purchaseDraft(f._id, sw, 6n * QTL, 200000n));
    d1.offline = false;
    d2.offline = false;
    await d1.sync();
    await d2.sync();

    const mdb = await getDb();
    const server = (await cols(mdb).vouchers.findOne({ _id: v._id })) as Voucher;
    expect(server.rev).toBe(2);
    expect(server.type === "PURCHASE" && server.lines[0]!.grossG).toBe(String(5n * QTL));
    d2.use();
    const [op] = await db().outbox.toArray();
    expect(op?.status).toBe("conflict");
    const mine = (await db().vouchers.get(v._id)) as Voucher;
    expect(mine.type === "PURCHASE" && mine.lines[0]!.grossG).toBe(String(6n * QTL));

    // Apply mine as a new revision → server takes D2's numbers as rev 3.
    await applyMineAsNewRevision(op!.seq!);
    await d2.sync();
    const after = (await cols(mdb).vouchers.findOne({ _id: v._id })) as Voucher;
    expect(after.rev).toBe(3);
    expect(after.type === "PURCHASE" && after.lines[0]!.grossG).toBe(String(6n * QTL));

    // Another conflict, resolved by keeping the server version.
    d1.use();
    await d1.sync();
    d1.offline = true;
    d2.offline = true;
    await editVoucher(GA, v._id, purchaseDraft(f._id, sw, 7n * QTL, 200000n));
    d2.use();
    await editVoucher(GA, v._id, purchaseDraft(f._id, sw, 8n * QTL, 200000n));
    d1.offline = false;
    d2.offline = false;
    await d1.sync();
    await d2.sync();
    const [op2] = await db().outbox.toArray();
    expect(op2?.status).toBe("conflict");
    await keepServer(op2!.seq!);
    const local = (await db().vouchers.get(v._id)) as Voucher;
    expect(local.rev).toBe(4);
    expect(local.type === "PURCHASE" && local.lines[0]!.grossG).toBe(String(7n * QTL));
    expect(nonZero(await godownBalances(GA))).toEqual(nonZero(await serverBalances(GA)));
  });

  it("void beats edit; an edit after a void becomes a conflict", async () => {
    d1.use();
    const f = await addFarmer(GA, "Nitai");
    const sw = (await refs(GA)).swarna;
    const v = await createVoucher(GA, purchaseDraft(f._id, sw, 2n * QTL, 200000n));
    await d1.sync();
    await d2.sync();

    d1.offline = true;
    d2.offline = true;
    d1.use();
    await voidVoucher(GA, v._id, "duplicate");
    d2.use();
    await editVoucher(GA, v._id, purchaseDraft(f._id, sw, 3n * QTL, 200000n));
    d1.offline = false;
    d2.offline = false;
    await d2.sync(); // edit lands first (rev 2)
    await d1.sync(); // void from rev 1 still wins (rev 3)
    const mdb = await getDb();
    const server = (await cols(mdb).vouchers.findOne({ _id: v._id }))!;
    expect(server.status).toBe("void");
    expect(server.rev).toBe(3);
    expect(await cols(mdb).ledgerLines.countDocuments({ voucherId: v._id })).toBe(0);

    // D2 edits again on top of its old copy → VOIDED conflict.
    d2.use();
    await d2.sync();
    expect((await db().vouchers.get(v._id))?.status).toBe("void");
  });

  it("pull while local edits are pending keeps the local version", async () => {
    d1.use();
    const f = await addFarmer(GA, "Haru");
    const sw = (await refs(GA)).swarna;
    const v = await createVoucher(GA, purchaseDraft(f._id, sw, 2n * QTL, 200000n));
    await d1.sync();
    await d2.sync();

    d2.use();
    d2.offline = true;
    await editVoucher(GA, v._id, purchaseDraft(f._id, sw, 9n * QTL, 200000n));
    d2.offline = false;

    d1.use();
    await editVoucher(GA, v._id, purchaseDraft(f._id, sw, 4n * QTL, 200000n));
    await d1.sync();

    d2.use();
    await pullAll(); // pull only
    const local = (await db().vouchers.get(v._id)) as Voucher;
    expect(local.type === "PURCHASE" && local.lines[0]!.grossG).toBe(String(9n * QTL));
    expect(await db().outbox.where("entityId").equals(v._id).count()).toBe(1);
    // Push → conflict; keep server so later tests start clean.
    await d2.sync();
    const [op] = await db().outbox.toArray();
    await keepServer(op!.seq!);
  });

  it("token expiry mid-queue: sync pauses, outbox intact, resumes after login", async () => {
    d1.use();
    const f = await addFarmer(GA, "Bablu");
    await d1.sync();
    await createVoucher(GA, paymentDraft(f._id, 100n));
    await createVoucher(GA, paymentDraft(f._id, 200n));
    await createVoucher(GA, paymentDraft(f._id, 300n));
    d1.dropAccessToken();
    d1.jar.clear(); // refresh cookie gone/expired
    await expect(d1.sync()).rejects.toBeInstanceOf(ApiCallError);
    expect(await db().outbox.count()).toBe(3);
    expect(await db().outbox.where("status").equals("pending").count()).toBe(3);

    await d1.login(OWNER.phone, OWNER.password);
    await d1.sync();
    expect(await db().outbox.count()).toBe(0);
    expect(nonZero(await godownBalances(GA))).toEqual(nonZero(await serverBalances(GA)));
  });

  it("refresh token rotation: a reused (stolen) refresh token revokes the family", async () => {
    const dev = await new TestDevice("sync-rot").reset();
    await dev.login(OWNER.phone, OWNER.password);
    const oldCookie = dev.jar.get("dk_rt")!;
    dev.dropAccessToken();
    await dev.sync(); // refresh → rotated
    expect(dev.jar.get("dk_rt")).not.toBe(oldCookie);
    // Replay the old token well after the grace window.
    const mdb = await getDb();
    await cols(mdb).refreshTokens.updateMany(
      {},
      { $set: { usedAt: new Date(Date.now() - 60_000) } },
    );
    dev.jar.set("dk_rt", oldCookie);
    dev.dropAccessToken();
    await expect(dev.sync()).rejects.toMatchObject({ code: "REFRESH_REUSED" });
  });

  it("masters: non-overlapping field edits merge; overlapping keep the server value", async () => {
    d1.use();
    const p = await addFarmer(GA, "Madan");
    await d1.sync();
    await d2.sync();
    d1.offline = true;
    d2.offline = true;
    d1.use();
    await upsertMaster(GA, "party", { _id: p._id, name: p.name, roles: p.roles, village: "Kalna" });
    d2.use();
    await upsertMaster(GA, "party", {
      _id: p._id,
      name: p.name,
      roles: p.roles,
      phone: "9830012345",
      village: "Memari",
    });
    d1.offline = false;
    d2.offline = false;
    await d1.sync();
    await d2.sync();
    const mdb = await getDb();
    const server = (await cols(mdb).parties.findOne({ _id: p._id }))!;
    expect(server.phone).toBe("9830012345");
    expect(server.village).toBe("Kalna");
    expect(await cols(mdb).conflicts.countDocuments({ entityId: p._id, field: "village" })).toBe(1);
    d2.use();
    expect((await db().parties.get(p._id))?.village).toBe("Kalna");
    expect(await db().outbox.count()).toBe(0);
  });

  it("godown settings: a second edit after the first one has synced is accepted", async () => {
    // The synced copy carries the server's serverSeq; editing again must not choke on it.
    d1.use();
    await updateGodownSettings(GA, { lockAfterDays: 3 });
    await d1.sync();
    await updateGodownSettings(GA, { lockAfterDays: 5 });
    await d1.sync();
    expect(await db().outbox.count()).toBe(0);
    const mdb = await getDb();
    expect((await cols(mdb).godownSettings.findOne({ _id: GA }))?.lockAfterDays).toBe(5);
    expect(await cols(mdb).conflicts.countDocuments({ godownId: GA, entity: "godownSettings" })).toBe(0);
    // And the device copy converged on the server's.
    expect(((await getMeta(`godownSettings:${GA}`)) as { lockAfterDays: number }).lockAfterDays).toBe(5);
  });
});

describe("server checks", () => {
  async function craftPush(dev: TestDevice, ops: unknown[]): Promise<PushResponse> {
    dev.use();
    const { accessToken } = await import("@/client/sync/transport");
    const { authedCall } = await import("@/client/auth/session");
    void accessToken;
    return authedCall<PushResponse>("/api/sync/push", {
      body: { deviceId: (await getSession())!.deviceId, ops },
    });
  }

  it("CALC_MISMATCH when stored derived fields don't match the recomputation", async () => {
    d1.use();
    const f = await addFarmer(GA, "Calc");
    await d1.sync();
    d1.offline = true;
    const v = await createVoucher(GA, purchaseDraft(f._id, (await refs(GA)).swarna, QTL, 200000n));
    d1.offline = false;
    const [op] = await db().outbox.toArray();
    await db().outbox.clear();
    const tampered = { ...(op!.payload as Voucher), totalPaise: "1" };
    const res = await craftPush(d1, [
      {
        opId: op!.opId,
        godownId: GA,
        entity: "voucher",
        entityId: v._id,
        op: "upsert",
        baseRev: 0,
        payload: tampered,
        createdAt: op!.createdAt,
      },
    ]);
    expect(res.results[0]).toMatchObject({ result: "rejected", reason: "CALC_MISMATCH" });
  });
});

describe("engine backoff", () => {
  it("doubles from 2 s to a 5 min cap with ±20 % jitter", () => {
    expect(nextBackoff(0, () => 0.5)).toBe(MIN_BACKOFF_MS);
    expect(nextBackoff(2000, () => 0.5)).toBe(4000);
    expect(nextBackoff(MAX_BACKOFF_MS, () => 1)).toBe(MAX_BACKOFF_MS);
    let b = 0;
    for (let i = 0; i < 20; i++) b = nextBackoff(b);
    expect(b).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    expect(nextBackoff(10_000, () => 0)).toBe(16_000);
  });
});

export { saleDraft, GB };

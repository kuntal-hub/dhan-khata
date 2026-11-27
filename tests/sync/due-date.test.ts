/**
 * Due date changes through sync (DECISIONS D54), real route handlers + in-memory Mongo:
 *  - the `dueDate` op updates only the field: same revision, same ledger lines; audited;
 *    other devices receive it;
 *  - a full edit from a device that has not pulled the new date can't put the old one back;
 *  - two devices offline: last writer wins on this field, no conflict;
 *  - a manager may change it on a closed day (a full edit there is DAY_LOCKED);
 *  - the server rejects a due date before the deal.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { getSession } from "@/client/db/meta";
import { saveBillWithInitialPayment, setDueDate, upsertMaster, type DraftOf } from "@/client/repo";
import { accessToken } from "@/client/sync/transport";
import { addDays, todayIST } from "@/domain/dates";
import type { Doc, PushResponse } from "@/domain/schemas";
import { closeMongo, cols, getDb, type UserDoc } from "@/server/db";
import { createBusinessWithOwner } from "@/server/business";
import { createGodown } from "@/server/godownService";
import { createUser } from "@/server/users";
import { TestDevice, useTestServer } from "../helpers/server";
import { purchaseDraft } from "../helpers/local";

const QTL = 100_000n;
const OWNER = { phone: "9830000071", password: "owner-pass-71" };
const MGR = { phone: "9830000072", password: "manager-pass-72" };
const TODAY = todayIST();
const D1 = addDays(TODAY, -3);

let owner: UserDoc;
let GA: string;
let farmer: string;
let swarna: string;
const d1 = new TestDevice("due-d1");
const d2 = new TestDevice("due-d2");
const dm = new TestDevice("due-mgr");

const dueOf = (d: unknown) => (d as { dueDate?: string } | null | undefined)?.dueDate;

async function newPurchase(dueDate?: string): Promise<Doc> {
  const draft: DraftOf<"PURCHASE"> = {
    ...purchaseDraft(farmer, swarna, 5n * QTL, 200_000n, D1),
    ...(dueDate ? { dueDate } : {}),
  };
  return (await saveBillWithInitialPayment(GA, draft, null)).bill;
}

async function serverDoc(id: string): Promise<Doc | null> {
  return (await cols(await getDb()).vouchers.findOne({ _id: id })) as Doc | null;
}

async function serverLines(id: string): Promise<string[]> {
  const rows = await cols(await getDb())
    .ledgerLines.find({ voucherId: id })
    .toArray();
  return rows.map((l) => `${l.account}|${l.debitPaise}|${l.creditPaise}|${l.voucherRev}`).sort();
}

beforeAll(async () => {
  useTestServer("duedate");
  const mdb = await getDb();
  owner = (
    await createBusinessWithOwner(mdb, {
      ownerName: "Owner",
      mobile: OWNER.phone,
      password: OWNER.password,
      businessName: "Due Business",
    })
  ).owner;
  GA = (await createGodown(mdb, owner, { name: "Rampur", code: "RP" }))._id;
  await createUser(mdb, {
    businessId: owner.businessId,
    name: "Manager",
    ...MGR,
    godownAccess: [{ godownId: GA, role: "manager" }],
  });
  for (const dev of [d1, d2]) {
    await dev.reset();
    await dev.login(OWNER.phone, OWNER.password);
    await dev.sync();
  }
  d1.use();
  farmer = (await upsertMaster(GA, "party", { name: "Ramesh", roles: ["FARMER"] }))._id;
  swarna = (await db()
    .varieties.where("godownId")
    .equals(GA)
    .filter((v) => v.systemKey === "SWARNA")
    .first())!._id;
  await d1.sync();
  await dm.reset();
  await dm.login(MGR.phone, MGR.password);
  await dm.sync();
});

afterAll(async () => {
  await closeMongo();
});

describe("due date op", () => {
  it("updates only the field on the server (same rev, same lines), audited, reaches others", async () => {
    d1.use();
    const p = await newPurchase(addDays(TODAY, 5));
    await d1.sync();
    await d2.sync();
    const linesBefore = await serverLines(p._id);
    const next = addDays(TODAY, 30);

    d1.use();
    await setDueDate(GA, p._id, next);
    await d1.sync();
    expect(await db().outbox.count()).toBe(0);
    const s = await serverDoc(p._id);
    expect(dueOf(s)).toBe(next);
    expect(s!.rev).toBe(p.rev);
    expect(await serverLines(p._id)).toEqual(linesBefore);
    const audit = await cols(await getDb())
      .audit.find({ entityId: p._id, action: "due_date" })
      .toArray();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.detail).toBe(`${addDays(TODAY, 5)}→${next}`);
    // The device keeps its derived rows.
    expect(await db().ledgerLines.where("voucherId").equals(p._id).count()).toBe(
      linesBefore.length,
    );

    await d2.sync();
    expect(dueOf(await db().vouchers.get(p._id))).toBe(next);
  });

  it("a stale full edit keeps the server's newer due date", async () => {
    d1.use();
    const p = await newPurchase(addDays(TODAY, 5));
    await d1.sync();
    await d2.sync();
    d1.use();
    await setDueDate(GA, p._id, addDays(TODAY, 12));
    await d1.sync();

    // d2 has not pulled: it edits the rate with its old copy (due in 5 days).
    d2.use();
    const local = (await db().vouchers.get(p._id))!;
    expect(dueOf(local)).toBe(addDays(TODAY, 5));
    await saveBillWithInitialPayment(
      GA,
      { ...purchaseDraft(farmer, swarna, 5n * QTL, 210_000n, D1), dueDate: addDays(TODAY, 5) },
      null,
      { id: p._id },
    );
    await d2.sync();
    expect(await db().outbox.count()).toBe(0);
    const s = await serverDoc(p._id);
    expect(s!.rev).toBe(p.rev + 1);
    expect(s!.type === "PURCHASE" && s!.ratePaisePerQtl).toBe("210000");
    expect(dueOf(s)).toBe(addDays(TODAY, 12));
    expect(dueOf(await db().vouchers.get(p._id))).toBe(addDays(TODAY, 12));
  });

  it("two devices offline: the last change to reach the server wins, no conflict", async () => {
    d1.use();
    const p = await newPurchase();
    await d1.sync();
    await d2.sync();
    d1.use();
    await setDueDate(GA, p._id, addDays(TODAY, 3));
    d2.use();
    await setDueDate(GA, p._id, addDays(TODAY, 8));
    await d2.sync();
    await d1.sync();
    expect(await db().outbox.count()).toBe(0);
    expect(dueOf(await serverDoc(p._id))).toBe(addDays(TODAY, 3));
    await d2.sync();
    expect(await db().outbox.count()).toBe(0);
    expect(dueOf(await db().vouchers.get(p._id))).toBe(addDays(TODAY, 3));
  });

  it("a manager changes it on a closed day; a full edit of that day is refused", async () => {
    d1.use();
    const p = await newPurchase(addDays(TODAY, 2));
    await d1.sync();
    await cols(await getDb()).dayStatus.replaceOne(
      { _id: `${GA}:${D1}` },
      { godownId: GA, date: D1, closed: true },
      { upsert: true },
    );
    await dm.sync();
    dm.use();
    await setDueDate(GA, p._id, addDays(TODAY, 15));
    await dm.sync();
    expect(await db().outbox.count()).toBe(0);
    expect(dueOf(await serverDoc(p._id))).toBe(addDays(TODAY, 15));

    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(farmer, swarna, 5n * QTL, 220_000n, D1),
      null,
      { id: p._id },
    );
    await dm.sync();
    const [op] = await db().outbox.toArray();
    expect(op).toMatchObject({ status: "error", lastError: "DAY_LOCKED" });
  });

  it("fix:due-dates copies dates changed on the old reminders tab onto their deals", async () => {
    d1.use();
    const p = await newPurchase(addDays(TODAY, 5));
    const q = await newPurchase();
    await d1.sync();
    const mdb = await getDb();
    const now = new Date().toISOString();
    const legacy = (id: string, dueDate: string) => ({
      _id: `auto:${id}`,
      businessId: owner.businessId,
      godownId: GA,
      kind: "PAY",
      source: { type: "PURCHASE", id },
      dueDate,
      title: "",
      status: "open",
      rev: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    await cols(mdb).reminders.insertMany([
      legacy(p._id, addDays(TODAY, 20)),
      legacy(q._id, addDays(D1, -1)),
    ] as never);
    const { fixDueDates } = await import("@/server/fixDueDates");

    const dry = await fixDueDates(mdb, { apply: false, actorId: owner._id, godownIds: [GA] });
    expect(dry.changes).toEqual([
      expect.objectContaining({ docId: p._id, from: addDays(TODAY, 5), to: addDays(TODAY, 20) }),
    ]);
    expect(dry.skipped).toEqual([expect.objectContaining({ docId: q._id, reason: "BEFORE_DEAL" })]);
    expect(dueOf(await serverDoc(p._id))).toBe(addDays(TODAY, 5));

    const linesBefore = await serverLines(p._id);
    await fixDueDates(mdb, { apply: true, actorId: owner._id, godownIds: [GA] });
    const s = await serverDoc(p._id);
    expect(dueOf(s)).toBe(addDays(TODAY, 20));
    expect(s!.rev).toBe(p.rev);
    expect(await serverLines(p._id)).toEqual(linesBefore);
    expect(dueOf(await serverDoc(q._id))).toBeUndefined();

    await d2.sync();
    expect(dueOf(await db().vouchers.get(p._id))).toBe(addDays(TODAY, 20));
    // Idempotent.
    const again = await fixDueDates(mdb, { apply: false, actorId: owner._id, godownIds: [GA] });
    expect(again.changes).toHaveLength(0);
  });

  it("the server rejects a due date before the deal", async () => {
    d1.use();
    const p = await newPurchase();
    await d1.sync();
    const local = (await db().vouchers.get(p._id))!;
    const res = await d1.fetch("http://test/api/sync/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken().token}`,
      },
      body: JSON.stringify({
        deviceId: (await getSession())!.deviceId,
        ops: [
          {
            opId: "019a0000-0000-7000-8000-00000000d0e1",
            godownId: GA,
            entity: "voucher",
            entityId: p._id,
            op: "dueDate",
            baseRev: local.rev,
            payload: { ...local, dueDate: addDays(D1, -1) },
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    const body = (await res.json()) as PushResponse;
    expect(body.results[0]).toMatchObject({ result: "rejected", reason: "DUE_BEFORE_DEAL" });
    expect(dueOf(await serverDoc(p._id))).toBeUndefined();
  });
});

/**
 * Due dates and part-payments on the device (DECISIONS D54):
 *  - only deals take a due date; it may be in the future, never before the deal;
 *  - changing it later is a field update: same revision, same ledger lines and stock moves,
 *    one `dueDate` outbox op, an audit row "old→new"; allowed on a closed day;
 *  - a full edit never changes it; legacy due dates on other types stay untouched;
 *  - a deal takes any number of payments, any day from the deal's date, any amount up to the due
 *    (more only as an advance), before or after the due date alike;
 *  - the automatic reminder moves with the due date and closes when the deal is fully paid.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { dueAlerts } from "@/client/queries/dashboard";
import { reminderRows } from "@/client/queries/dues";
import { paymentsOf, stateOf } from "@/client/queries/purchases";
import {
  closeDay,
  expectedCash,
  payBill,
  saveBillWithInitialPayment,
  saveDoc,
  setDueDate,
  setReminderState,
  voidDoc,
  type DraftOf,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Doc } from "@/domain/schemas";
import {
  QTL,
  RS,
  TODAY,
  expenseDraft,
  purchaseDraft,
  setupDevice,
  type LocalGodown,
} from "../helpers/local";

let G: LocalGodown;
const GA = "GA";
const D1 = addDays(TODAY, -10);
const D2 = addDays(TODAY, -4);

beforeEach(async () => {
  const gs = await setupDevice("repo-due-date", { godowns: [{ id: GA, code: "RP" }] });
  G = gs[GA]!;
});

/** A purchase of 10 qtl × ₹2,000 = ₹20,000 dated `date`. */
function buy(date = D1, extra: Partial<DraftOf<"PURCHASE">> = {}): DraftOf<"PURCHASE"> {
  return { ...purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 2000n * RS, date), ...extra };
}

async function postedRows(id: string) {
  const lines = (await db().ledgerLines.where("voucherId").equals(id).toArray())
    .map((l) => JSON.stringify(l))
    .sort();
  const moves = (await db().stockMoves.where("voucherId").equals(id).toArray())
    .map((m) => JSON.stringify(m))
    .sort();
  return { lines, moves };
}

const dueOfDoc = async (id: string) => {
  const doc = (await db().vouchers.get(id))!;
  const pays = (await paymentsOf(id)).filter((p) => p.status === "active");
  return stateOf(doc, pays)!;
};

describe("only deals take a due date", () => {
  it("a new purchase takes a future due date; one before the purchase is refused", async () => {
    const future = addDays(TODAY, 45);
    const { bill } = await saveBillWithInitialPayment(GA, buy(D1, { dueDate: future }), null);
    expect((bill as { dueDate?: string }).dueDate).toBe(future);
    await expect(
      saveBillWithInitialPayment(GA, buy(D1, { dueDate: addDays(D1, -1) }), null),
    ).rejects.toMatchObject({ code: "DUE_BEFORE_DEAL" });
  });

  it("an expense takes no due date (dropped on create)", async () => {
    const ex = await saveDoc(GA, expenseDraft(5_000n * RS, D1, { dueDate: addDays(TODAY, 5) }));
    expect((ex as { dueDate?: string }).dueDate).toBeUndefined();
    expect(await reminderRows(GA)).toHaveLength(0);
  });
});

describe("changing the due date later", () => {
  it("touches nothing that posts: same rev, lines, moves; one dueDate op; audited", async () => {
    const { bill } = await saveBillWithInitialPayment(GA, buy(D1, { dueDate: D2 }), {
      amountPaise: (3_000n * RS).toString(),
      paymentDate: D1,
      mode: "CASH",
    });
    const before = await postedRows(bill._id);
    await db().outbox.clear();
    const next = addDays(TODAY, 20);

    const doc = await setDueDate(GA, bill._id, next);
    expect((doc as { dueDate?: string }).dueDate).toBe(next);
    expect(doc.rev).toBe(bill.rev);
    expect((await db().vouchers.get(bill._id))!.rev).toBe(bill.rev);
    expect(await postedRows(bill._id)).toEqual(before);
    const ops = await db().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      entity: "voucher",
      entityId: bill._id,
      op: "dueDate",
      baseRev: bill.rev,
      fields: ["dueDate"],
    });
    const audit = (await db().auditLocal.toArray()).at(-1)!;
    expect(audit).toMatchObject({ action: "dueDate", entityId: bill._id, detail: `${D2}→${next}` });
    // Money is exactly as before.
    expect((await dueOfDoc(bill._id)).duePaise).toBe(17_000n * RS);

    // Clear.
    const cleared = await setDueDate(GA, bill._id, null);
    expect((cleared as { dueDate?: string }).dueDate).toBeUndefined();
    expect((await db().auditLocal.toArray()).at(-1)!.detail).toBe(`${next}→`);
    // Same value again: nothing written.
    const n = await db().outbox.count();
    await setDueDate(GA, bill._id, null);
    expect(await db().outbox.count()).toBe(n);
  });

  it("works on a closed day; refused before the deal, on a reversed deal, on an expense", async () => {
    const { bill } = await saveBillWithInitialPayment(GA, buy(D1), null);
    await closeDay(GA, { date: D1, actualPaise: await expectedCash(GA, D1) });
    await setDueDate(GA, bill._id, addDays(TODAY, 3));
    expect((await db().vouchers.get(bill._id)) as { dueDate?: string }).toMatchObject({
      dueDate: addDays(TODAY, 3),
    });
    // A past date on/after the deal is fine (editing old records).
    await setDueDate(GA, bill._id, D2);
    await expect(setDueDate(GA, bill._id, addDays(D1, -1))).rejects.toMatchObject({
      code: "DUE_BEFORE_DEAL",
    });
    const ex = await saveDoc(GA, expenseDraft(1_000n * RS, D1));
    await expect(setDueDate(GA, ex._id, TODAY)).rejects.toMatchObject({ code: "TYPE_IMMUTABLE" });
    await voidDoc(GA, bill._id, "wrong farmer");
    await expect(setDueDate(GA, bill._id, TODAY)).rejects.toMatchObject({ code: "VOUCHER_VOID" });
  });

  it("a full edit keeps the due date; a legacy due date on an expense stays untouched", async () => {
    const { bill } = await saveBillWithInitialPayment(GA, buy(D1), null);
    await setDueDate(GA, bill._id, addDays(TODAY, 9));
    const { bill: edited } = await saveBillWithInitialPayment(
      GA,
      { ...buy(D1, { dueDate: addDays(TODAY, 1) }), ratePaisePerQtl: (2100n * RS).toString() },
      null,
      { id: bill._id },
    );
    expect(edited.rev).toBe(bill.rev + 1);
    expect((edited as { dueDate?: string }).dueDate).toBe(addDays(TODAY, 9));

    const ex = await saveDoc(GA, expenseDraft(1_000n * RS, D1));
    await db().vouchers.update(ex._id, { dueDate: "2026-12-31" } as Partial<Doc>);
    const exEdited = await saveDoc(GA, { ...expenseDraft(1_200n * RS, D1) }, { id: ex._id });
    expect((exEdited as { dueDate?: string }).dueDate).toBe("2026-12-31");
    // Ignored everywhere: no reminder from it.
    expect((await reminderRows(GA)).filter((r) => r.source?.id === ex._id)).toHaveLength(0);
  });
});

describe("part-payments", () => {
  it("any number, any day from the deal's date, before or after the due date", async () => {
    const { bill } = await saveBillWithInitialPayment(GA, buy(D1, { dueDate: D2 }), null);
    const pay = (amountRs: bigint, date: string, extraAsAdvance = false) =>
      payBill(
        GA,
        bill,
        { amountPaise: (amountRs * RS).toString(), paymentDate: date, mode: "CASH" },
        { extraAsAdvance },
      );
    expect((await dueOfDoc(bill._id)).status).toBe("UNPAID");
    await pay(3_000n, D1); // before the due date
    await pay(2_000n, D2); // on it
    let st = await dueOfDoc(bill._id);
    expect(st).toMatchObject({ status: "PARTIAL", duePaise: 15_000n * RS });
    // Today is after the due date and something is still due: overdue (extra flag).
    expect(st.overdue).toBe(true);
    await pay(1_000n, TODAY); // after it: never blocked
    await expect(pay(1_000n, addDays(D1, -1))).rejects.toMatchObject({
      code: "PAYMENT_BEFORE_DEAL",
    });
    await expect(pay(1_000n, addDays(TODAY, 1))).rejects.toMatchObject({ code: "FUTURE_DATE" });
    // More than the due: only as an advance, after confirming.
    await expect(pay(15_000n, TODAY)).rejects.toMatchObject({ code: "OVERPAYMENT" });
    await pay(15_000n, TODAY, true);
    st = await dueOfDoc(bill._id);
    expect(st).toMatchObject({ status: "PAID", duePaise: 0n, overdue: false });
    const active = (await paymentsOf(bill._id)).filter((p) => p.status === "active");
    // ₹3,000 + ₹2,000 + ₹1,000 + ₹14,000 on the bill; the extra ₹1,000 is a separate advance.
    expect(active.map((p) => p.amountPaise).sort()).toEqual(
      ["300000", "200000", "100000", "1400000"].sort(),
    );
    expect(active.reduce((s, p) => s + BigInt(p.amountPaise), 0n)).toBe(20_000n * RS);
  });
});

describe("reminders follow the due date", () => {
  it("moves when changed (done state starts over), closes when fully paid", async () => {
    const due = addDays(TODAY, 2);
    const { bill } = await saveBillWithInitialPayment(GA, buy(D1, { dueDate: due }), null);
    let rows = (await reminderRows(GA)).filter((r) => r.auto);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dueDate: due, status: "open", kind: "PAY" });
    expect((await dueAlerts(GA)).map((a) => a.doc._id)).toEqual([bill._id]);

    await setReminderState(
      GA,
      { source: rows[0]!.source!, kind: "PAY", dueDate: due, partyId: G.farmer },
      "done",
    );
    expect((await reminderRows(GA)).find((r) => r.auto)!.status).toBe("done");

    const later = addDays(TODAY, 10);
    await setDueDate(GA, bill._id, later);
    rows = (await reminderRows(GA)).filter((r) => r.auto);
    expect(rows[0]).toMatchObject({ dueDate: later, status: "open" });
    expect(await db().reminders.get(`auto:${bill._id}`)).toMatchObject({
      dueDate: later,
      status: "open",
    });
    // Outside the 7-day alert window now; still in the outstanding lists.
    expect(await dueAlerts(GA)).toHaveLength(0);

    await payBill(GA, bill, {
      amountPaise: (20_000n * RS).toString(),
      paymentDate: TODAY,
      mode: "CASH",
    });
    expect((await reminderRows(GA)).filter((r) => r.auto)).toHaveLength(0);
  });

  it("no due date: in no reminder or alert", async () => {
    await saveBillWithInitialPayment(GA, buy(D1), null);
    expect(await reminderRows(GA)).toHaveLength(0);
    expect(await dueAlerts(GA)).toHaveLength(0);
  });
});

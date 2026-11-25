/**
 * v2 Phase 7 repo + queries: backdated expense with payments on their own dates (Test 5), unpaid
 * expenses, filters by expense date vs payment date, farmer payments shown in Daily Expenses but
 * never counted as expenses, custom categories, reversal.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { godownBalances } from "@/client/queries/ledger";
import {
  categoryList,
  expenseDay,
  expenseRows,
  expenseTotals,
  openPurchasesOf,
  unpaidExpenses,
} from "@/client/queries/expenses";
import {
  payAdvance,
  payBill,
  RepoError,
  saveBillWithInitialPayment,
  upsertMaster,
  voidDoc,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Doc } from "@/domain/schemas";
import { cashbookDay } from "@/domain/v2/cashbook";
import { deriveAll } from "@/domain/v2/replay";
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
const D1 = addDays(TODAY, -4);

beforeEach(async () => {
  const gs = await setupDevice("repo-expenses", { godowns: [{ id: GA, code: "RP" }] });
  G = gs[GA]!;
});

async function storedEqualsReplay(): Promise<void> {
  const want = deriveAll((await db().vouchers.toArray()) as Doc[]);
  const lines = (await db().ledgerLines.toArray()).map((l) => l._id).sort();
  expect(lines).toEqual(want.lines.map((l) => l._id).sort());
}

describe("backdated expense (Test 5)", () => {
  it("₹5,000 labour dated 4 days ago; ₹3,000 then, ₹2,000 today → 0 due, counted once", async () => {
    const { bill, payment } = await saveBillWithInitialPayment(
      GA,
      expenseDraft(5_000n * RS, D1, { title: "লেবার", categoryCode: "LABOUR" }),
      { amountPaise: (3_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
    );
    expect(bill.type === "EXPENSE" && bill.expenseDate).toBe(D1);
    expect(bill.entryDate).toBe(TODAY);
    expect(payment?.type === "PAYMENT" && payment.isInitial).toBe(true);
    let [row] = await expenseRows(GA);
    expect(row!.state.status).toBe("PARTIAL");
    expect((await unpaidExpenses(GA)).map((r) => r.doc._id)).toEqual([bill._id]);

    await payBill(GA, bill, {
      amountPaise: (2_000n * RS).toString(),
      paymentDate: TODAY,
      mode: "CASH",
    });
    [row] = await expenseRows(GA);
    expect(row!.state.duePaise).toBe(0n);
    expect(row!.state.status).toBe("PAID");
    expect(row!.payments.map((p) => p.paymentDate)).toEqual([D1, TODAY]);
    expect(await unpaidExpenses(GA)).toHaveLength(0);

    // Cashbook: ₹3,000 expense on D1, ₹2,000 today; total once.
    const docs = (await db().vouchers.toArray()) as Doc[];
    expect(cashbookDay(docs, "CASH", D1).expensesPaise).toBe(3_000n * RS);
    expect(cashbookDay(docs, "CASH", TODAY).expensesPaise).toBe(2_000n * RS);
    expect((await godownBalances(GA)).get("CASH")).toBe(-5_000n * RS);
    expect((await godownBalances(GA)).get("EXP:LABOUR")).toBe(5_000n * RS);

    // Day views: incurred on D1; money out on D1 (₹3,000) and today (₹2,000).
    const day1 = await expenseDay(GA, D1);
    expect(day1.incurredPaise).toBe(5_000n * RS);
    expect(day1.groups.map((g) => g.code)).toEqual(["LABOUR"]);
    expect(day1.cashOutPaise).toBe(3_000n * RS);
    const today = await expenseDay(GA, TODAY);
    expect(today.incurredPaise).toBe(0n);
    expect(today.cashOutPaise).toBe(2_000n * RS);

    // Filters: by expense date vs by payment date.
    expect(await expenseRows(GA, { from: TODAY, to: TODAY })).toHaveLength(0);
    expect(await expenseRows(GA, { from: TODAY, to: TODAY, by: "PAYMENT" })).toHaveLength(1);
    expect(expenseTotals(await expenseRows(GA)).amountPaise).toBe(5_000n * RS);
    await storedEqualsReplay();
  });

  it("an unpaid expense moves no cash; voiding with payments restores cash", async () => {
    const { bill } = await saveBillWithInitialPayment(
      GA,
      expenseDraft(1_200n * RS, D1, { categoryCode: "DIESEL", dueDate: TODAY }),
      null,
    );
    expect((await godownBalances(GA)).get("CASH") ?? 0n).toBe(0n);
    const [u] = await unpaidExpenses(GA);
    expect(u!.state.status).toBe("UNPAID");
    await payBill(GA, bill, {
      amountPaise: (500n * RS).toString(),
      paymentDate: TODAY,
      mode: "CASH",
    });
    const err = await voidDoc(GA, bill._id, "wrong").catch((e: unknown) => e);
    expect((err as RepoError).code).toBe("LINKED_PAYMENTS");
    await voidDoc(GA, bill._id, "wrong", { withPayments: true });
    expect((await godownBalances(GA)).get("CASH") ?? 0n).toBe(0n);
    expect(await unpaidExpenses(GA)).toHaveLength(0);
    await storedEqualsReplay();
  });

  it("an expense can't use the Farmer payment category", async () => {
    const err = await saveBillWithInitialPayment(
      GA,
      expenseDraft(100n * RS, D1, { categoryCode: "FARMER_PAYMENT" }),
      null,
    ).catch((e: unknown) => e);
    expect((err as RepoError).code).toBe("CATEGORY_IS_PAYMENT");
  });
});

describe("farmer payments in Daily Expenses", () => {
  it("are listed with the day's money out but never as expenses", async () => {
    const { bill: p } = await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 5n * QTL, 2000n * RS, D1),
      null,
    );
    const open = await openPurchasesOf(GA, G.farmer);
    expect(open.map((o) => o.state.duePaise)).toEqual([10_000n * RS]);
    await payBill(GA, p, {
      amountPaise: (4_000n * RS).toString(),
      paymentDate: TODAY,
      mode: "CASH",
    });
    await payAdvance(GA, G.farmer, "OUT", {
      amountPaise: (1_000n * RS).toString(),
      paymentDate: TODAY,
      mode: "CASH",
    });
    const day = await expenseDay(GA, TODAY);
    expect(day.incurredPaise).toBe(0n);
    expect(day.farmerPayments).toHaveLength(2);
    expect(day.farmerPaidPaise).toBe(5_000n * RS);
    expect(day.cashOutCashPaise).toBe(5_000n * RS);
    // Cashbook: under "cash paid", not "cash expenses".
    const docs = (await db().vouchers.toArray()) as Doc[];
    const cb = cashbookDay(docs, "CASH", TODAY);
    expect(cb.paidPaise).toBe(5_000n * RS);
    expect(cb.expensesPaise).toBe(0n);
    expect((await openPurchasesOf(GA, G.farmer))[0]!.state.duePaise).toBe(6_000n * RS);
  });
});

describe("categories", () => {
  it("custom categories are added after the built-in ones and can be hidden", async () => {
    const c = await upsertMaster(GA, "expenseCategory", {
      code: "",
      isSystem: false,
      enabled: true,
      name: "চা-জলখাবার",
    });
    expect(c.code).toMatch(/^U_/);
    const list = await categoryList(GA);
    expect(list[0]!.code).toBe("FARMER_PAYMENT");
    expect(list.at(-1)!._id).toBe(c._id);
    await upsertMaster(GA, "expenseCategory", { ...c, enabled: false });
    expect((await categoryList(GA)).find((x) => x._id === c._id)!.enabled).toBe(false);
    // An expense can use it.
    await saveBillWithInitialPayment(
      GA,
      expenseDraft(50n * RS, TODAY, { categoryCode: c.code }),
      null,
    );
    expect((await expenseDay(GA, TODAY)).groups[0]!.code).toBe(c.code);
  });
});

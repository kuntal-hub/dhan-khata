/**
 * Daily Expenses reads (requirement_v2 §12.4), one Gola at a time. An expense keeps its
 * `expenseDate`; each payment is a separate record with its own `paymentDate`. Paid / unpaid /
 * status are derived from the ACTIVE payments (never stored). Farmer payments are PURCHASE /
 * PARTY_ADVANCE payments shown here for visibility only — never counted as expenses.
 */
import { todayIST } from "@/domain/dates";
import type { BillState, PayStatus } from "@/domain/v2/payments";
import type { DocOf, ExpenseCategory, Party, Payment } from "@/domain/schemas";
import { FARMER_PAYMENT_CODE } from "@/domain/v2/accounts";
import { db } from "../db/dexie";
import { paymentsOf, stateOf } from "./purchases";

export type Expense = DocOf<"EXPENSE">;

export interface ExpenseRow {
  doc: Expense;
  party?: Party;
  category?: ExpenseCategory;
  payments: Payment[];
  state: BillState;
}

export interface ExpenseFilter {
  from?: string;
  to?: string;
  /** Which date the range applies to. */
  by?: "EXPENSE" | "PAYMENT";
  categoryCode?: string;
  status?: PayStatus | "ALL" | "OPEN";
  q?: string;
}

async function lookups(godownId: string) {
  const d = db();
  const [parties, cats] = await Promise.all([
    d.parties.where("godownId").equals(godownId).toArray(),
    d.expenseCategories.where("godownId").equals(godownId).toArray(),
  ]);
  return {
    party: new Map(parties.map((p) => [p._id, p] as const)),
    cat: new Map(cats.map((c) => [c.code, c] as const)),
  };
}

async function rowsOf(godownId: string, docs: readonly Expense[]): Promise<ExpenseRow[]> {
  const lk = await lookups(godownId);
  const today = todayIST();
  const out: ExpenseRow[] = [];
  for (const doc of docs) {
    const payments = await paymentsOf(doc._id);
    out.push({
      doc,
      party: doc.partyId ? lk.party.get(doc.partyId) : undefined,
      category: lk.cat.get(doc.categoryCode),
      payments,
      state: stateOf(
        doc,
        payments.filter((p) => p.status === "active"),
        today,
      )!,
    });
  }
  return out;
}

function matches(r: ExpenseRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [r.doc.title, r.doc.personText, r.party?.name, r.party?.searchKey, r.doc.number]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(s)) return true;
  const digits = s.replace(/[^0-9]/g, "");
  return digits.length >= 2 && (BigInt(r.doc.amountPaise) / 100n).toString().startsWith(digits);
}

export async function expenseRows(godownId: string, f: ExpenseFilter = {}): Promise<ExpenseRow[]> {
  const d = db();
  let docs: Expense[];
  if (f.by === "PAYMENT" && (f.from || f.to)) {
    const pays = await d.vouchers
      .where("[godownId+paymentDate]")
      .between([godownId, f.from ?? ""], [godownId, f.to ?? "￿"], true, true)
      .filter((p) => p.type === "PAYMENT" && p.status === "active" && p.source.type === "EXPENSE")
      .toArray();
    const ids = [
      ...new Set(pays.map((p) => (p.type === "PAYMENT" ? p.source.id : null)).filter(Boolean)),
    ] as string[];
    docs = (await d.vouchers.bulkGet(ids)).filter((x): x is Expense => !!x && x.type === "EXPENSE");
  } else {
    docs = (await d.vouchers
      .where("[godownId+expenseDate]")
      .between([godownId, f.from ?? ""], [godownId, f.to ?? "￿"], true, true)
      .filter((x) => x.type === "EXPENSE")
      .toArray()) as Expense[];
  }
  const rows = await rowsOf(
    godownId,
    docs.filter((x) => !f.categoryCode || x.categoryCode === f.categoryCode),
  );
  return rows
    .filter((r) => {
      if (f.status && f.status !== "ALL") {
        if (r.doc.status === "void") return false;
        if (f.status === "OPEN") return r.state.duePaise > 0n;
        if (r.state.status !== f.status) return false;
      }
      return !f.q || matches(r, f.q);
    })
    .sort((a, b) =>
      a.doc.expenseDate === b.doc.expenseDate
        ? a.doc.createdAt < b.doc.createdAt
          ? 1
          : -1
        : a.doc.expenseDate < b.doc.expenseDate
          ? 1
          : -1,
    );
}

/** Unpaid / part-paid expenses, earliest due first (then oldest). */
export async function unpaidExpenses(godownId: string): Promise<ExpenseRow[]> {
  const rows = await expenseRows(godownId, { status: "OPEN" });
  return rows.sort((a, b) => {
    const da = a.doc.dueDate ?? "9999";
    const dbb = b.doc.dueDate ?? "9999";
    if (da !== dbb) return da < dbb ? -1 : 1;
    return a.doc.expenseDate < b.doc.expenseDate ? -1 : 1;
  });
}

export function expenseTotals(rows: readonly ExpenseRow[]): {
  count: number;
  amountPaise: bigint;
  paidPaise: bigint;
  duePaise: bigint;
} {
  let count = 0;
  let amount = 0n;
  let paid = 0n;
  let due = 0n;
  for (const r of rows) {
    if (r.doc.status !== "active") continue;
    count++;
    amount += BigInt(r.doc.amountPaise);
    paid += r.state.paidPaise;
    due += r.state.duePaise > 0n ? r.state.duePaise : 0n;
  }
  return { count, amountPaise: amount, paidPaise: paid, duePaise: due };
}

export interface FarmerPaymentRow {
  payment: Payment;
  party?: Party;
}

export interface ExpenseDay {
  date: string;
  /** Expenses incurred on the day (by expense date), grouped by category. */
  groups: Array<{
    code: string;
    category?: ExpenseCategory;
    rows: ExpenseRow[];
    totalPaise: bigint;
  }>;
  incurredPaise: bigint;
  /** Farmer payments made on the day (payments, NOT expenses). */
  farmerPayments: FarmerPaymentRow[];
  farmerPaidPaise: bigint;
  /** Money paid out on the day for expenses (any expense date) + farmer payments. */
  cashOutPaise: bigint;
  /** …of which in cash. */
  cashOutCashPaise: bigint;
}

/** One day of the Daily Expenses screen (§12.4 "আজকের খরচ"). */
export async function expenseDay(godownId: string, date: string): Promise<ExpenseDay> {
  const d = db();
  const rows = (await expenseRows(godownId, { from: date, to: date })).filter(
    (r) => r.doc.status === "active",
  );
  const byCode = new Map<string, ExpenseRow[]>();
  for (const r of rows)
    byCode.set(r.doc.categoryCode, [...(byCode.get(r.doc.categoryCode) ?? []), r]);
  const groups = [...byCode.entries()]
    .map(([code, list]) => ({
      code,
      category: list[0]!.category,
      rows: list,
      totalPaise: list.reduce((s, r) => s + BigInt(r.doc.amountPaise), 0n),
    }))
    .sort((a, b) => (a.totalPaise > b.totalPaise ? -1 : a.totalPaise < b.totalPaise ? 1 : 0));
  const pays = (await d.vouchers
    .where("[godownId+paymentDate]")
    .equals([godownId, date])
    .filter((p) => p.type === "PAYMENT" && p.status === "active" && p.direction === "OUT")
    .toArray()) as Payment[];
  const parties = new Map(
    (await d.parties.where("godownId").equals(godownId).toArray()).map((p) => [p._id, p] as const),
  );
  const farmerPayments: FarmerPaymentRow[] = [];
  let cashOut = 0n;
  let cashOutCash = 0n;
  let farmerPaid = 0n;
  for (const p of pays) {
    const party = p.partyId ? parties.get(p.partyId) : undefined;
    const isExpense = p.source.type === "EXPENSE" || p.source.type === "VEHICLE_COST";
    const isFarmer =
      p.source.type === "PURCHASE" ||
      (p.source.type === "PARTY_ADVANCE" &&
        !!party &&
        (party.roles.includes("FARMER") || party.roles.includes("SUPPLIER")));
    if (!isExpense && !isFarmer) continue;
    const amt = BigInt(p.amountPaise);
    cashOut += amt;
    if (p.mode === "CASH") cashOutCash += amt;
    if (isFarmer) {
      farmerPaid += amt;
      farmerPayments.push({ payment: p, ...(party ? { party } : {}) });
    }
  }
  return {
    date,
    groups,
    incurredPaise: groups.reduce((s, g) => s + g.totalPaise, 0n),
    farmerPayments,
    farmerPaidPaise: farmerPaid,
    cashOutPaise: cashOut,
    cashOutCashPaise: cashOutCash,
  };
}

/** Categories of the Gola (Farmer payment first, then built-in, then custom). */
export async function categoryList(godownId: string): Promise<ExpenseCategory[]> {
  const cats = (await db().expenseCategories.where("godownId").equals(godownId).toArray()).filter(
    (c) => c.status === "active",
  );
  const rank = (c: ExpenseCategory) => (c.code === FARMER_PAYMENT_CODE ? 0 : c.isSystem ? 1 : 2);
  return cats.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
}

export interface OpenBill {
  doc: DocOf<"PURCHASE">;
  state: BillState;
}

/** A farmer's purchases that still have a due (oldest first) — the farmer-payment flow. */
export async function openPurchasesOf(godownId: string, partyId: string): Promise<OpenBill[]> {
  const docs = (await db()
    .vouchers.where("[godownId+partyId]")
    .equals([godownId, partyId])
    .filter((x) => x.type === "PURCHASE" && x.status === "active")
    .toArray()) as Array<DocOf<"PURCHASE">>;
  const today = todayIST();
  const out: OpenBill[] = [];
  for (const doc of docs) {
    const pays = (await paymentsOf(doc._id)).filter((p) => p.status === "active");
    const state = stateOf(doc, pays, today)!;
    if (state.duePaise > 0n) out.push({ doc, state });
  }
  return out.sort((a, b) => (a.doc.transactionDate < b.doc.transactionDate ? -1 : 1));
}

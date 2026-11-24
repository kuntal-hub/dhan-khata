/**
 * Daily Expense screen (spec §9.4) and the monthly view by category. Per godown.
 * Farmer payments are SHOWN here for visibility but remain payments (not expenses).
 */
import type { Voucher, VoucherOf } from "@/domain/schemas";
import { db } from "../db/dexie";
import { VEHICLE_BUCKET } from "./dashboard";

export interface CategoryBlock {
  /** Expense category code, or "VEHICLE" for own-vehicle (trip) expenses. */
  code: string;
  items: Array<{ voucher: Voucher; amountPaise: bigint; label?: string }>;
  totalPaise: bigint;
}

export interface DailyExpense {
  farmerPayments: Array<VoucherOf<"PAYMENT">>;
  farmerTotalPaise: bigint;
  categories: CategoryBlock[];
  expenseTotalPaise: bigint;
  /** Farmer payments + expenses of the day (all modes). */
  grandTotalPaise: bigint;
  /** The part of the grand total that left in cash. */
  cashOutflowPaise: bigint;
}

function dayRange(godownId: string, type: Voucher["type"], from: string, to: string) {
  return db()
    .vouchers.where("[godownId+type+date]")
    .between([godownId, type, from], [godownId, type, to], true, true)
    .filter((v) => v.status === "active")
    .toArray();
}

function addTo(blocks: Map<string, CategoryBlock>, code: string, voucher: Voucher, amount: bigint) {
  const b = blocks.get(code) ?? { code, items: [], totalPaise: 0n };
  b.items.push({ voucher, amountPaise: amount });
  b.totalPaise += amount;
  blocks.set(code, b);
}

export async function dailyExpense(godownId: string, date: string): Promise<DailyExpense> {
  const [payments, expenses, trips, parties] = await Promise.all([
    dayRange(godownId, "PAYMENT", date, date),
    dayRange(godownId, "EXPENSE", date, date),
    dayRange(godownId, "TRIP", date, date),
    db().parties.where("godownId").equals(godownId).toArray(),
  ]);
  const farmers = new Set(parties.filter((p) => p.roles.includes("farmer")).map((p) => p._id));
  const farmerPayments = payments
    .filter((v): v is VoucherOf<"PAYMENT"> => v.type === "PAYMENT" && farmers.has(v.partyId))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  let farmerTotal = 0n;
  let cash = 0n;
  for (const p of farmerPayments) {
    farmerTotal += BigInt(p.amountPaise);
    if (p.mode === "CASH") cash += BigInt(p.amountPaise);
  }
  const blocks = new Map<string, CategoryBlock>();
  for (const v of expenses) {
    if (v.type !== "EXPENSE") continue;
    addTo(blocks, v.categoryCode, v, BigInt(v.amountPaise));
    if (!v.onCredit && v.mode === "CASH") cash += BigInt(v.amountPaise);
  }
  for (const v of trips) {
    if (v.type !== "TRIP") continue;
    for (const e of v.expenses) {
      addTo(blocks, VEHICLE_BUCKET, v, BigInt(e.amountPaise));
      if (!e.creditPartyId && e.mode === "CASH") cash += BigInt(e.amountPaise);
    }
  }
  const categories = [...blocks.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
  let expenseTotal = 0n;
  for (const b of categories) expenseTotal += b.totalPaise;
  return {
    farmerPayments,
    farmerTotalPaise: farmerTotal,
    categories,
    expenseTotalPaise: expenseTotal,
    grandTotalPaise: farmerTotal + expenseTotal,
    cashOutflowPaise: cash,
  };
}

/** "2026-11" → "2026-10". */
export function previousMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const year = Number(y);
  const month = Number(m);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

export interface MonthlyRow {
  code: string;
  thisMonthPaise: bigint;
  lastMonthPaise: bigint;
}

async function monthTotals(godownId: string, ym: string): Promise<Map<string, bigint>> {
  const from = `${ym}-01`;
  const to = `${ym}-31`;
  const [expenses, trips] = await Promise.all([
    dayRange(godownId, "EXPENSE", from, to),
    dayRange(godownId, "TRIP", from, to),
  ]);
  const m = new Map<string, bigint>();
  const add = (k: string, p: bigint) => m.set(k, (m.get(k) ?? 0n) + p);
  for (const v of expenses) if (v.type === "EXPENSE") add(v.categoryCode, BigInt(v.amountPaise));
  for (const v of trips) {
    if (v.type !== "TRIP") continue;
    for (const e of v.expenses) add(VEHICLE_BUCKET, BigInt(e.amountPaise));
  }
  return m;
}

/** Monthly expenses by category compared with the previous month (spec §9.4). */
export async function monthlyExpenses(godownId: string, ym: string): Promise<MonthlyRow[]> {
  const [cur, prev] = await Promise.all([
    monthTotals(godownId, ym),
    monthTotals(godownId, previousMonth(ym)),
  ]);
  const codes = new Set([...cur.keys(), ...prev.keys()]);
  return [...codes]
    .map((code) => ({
      code,
      thisMonthPaise: cur.get(code) ?? 0n,
      lastMonthPaise: prev.get(code) ?? 0n,
    }))
    .sort((a, b) => (a.thisMonthPaise > b.thisMonthPaise ? -1 : 1));
}

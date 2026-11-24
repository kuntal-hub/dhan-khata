/**
 * Home dashboard (spec §9.1) for ONE godown and one business date. Balances come from the
 * `dailyAgg` cache (one row per day: Σdebit/Σcredit per account, Σ stock per variety|location),
 * so the cost is O(days), not O(vouchers): < 300 ms with 50k vouchers. Day figures come from the
 * day's vouchers (one indexed range).
 */
import { ACC, accountType } from "@/domain/posting/accounts";
import type { DayStatus, Reminder, Voucher } from "@/domain/schemas";
import { db } from "../db/dexie";

export interface DueSummary {
  count: number;
  amountPaise: bigint;
  overdueCount: number;
}

export interface VarietyStock {
  varietyId: string;
  qtyG: bigint;
  valuePaise: bigint;
}

export interface DashboardData {
  date: string;
  /** Card 1: CASH at the start of the date (= previous day's closing, counted if closed). */
  openingCashPaise: bigint;
  cashInPaise: bigint;
  cashOutPaise: bigint;
  /** Card 2: opening + today's CASH debits − credits. */
  expectedClosingCashPaise: bigint;
  /** Card 3: STORE stock only (TRANSIT excluded). */
  stockQtyG: bigint;
  stockValuePaise: bigint;
  stockByVariety: VarietyStock[];
  /** Cards 4 and 6. */
  saleQtyG: bigint;
  saleAmountPaise: bigint;
  saleCount: number;
  /** Card 5. */
  purchaseQtyG: bigint;
  purchaseAmountPaise: bigint;
  purchaseCount: number;
  /** Card 7: EXPENSE vouchers + own-vehicle (trip) expenses; key = category code or "VEHICLE". */
  expensePaise: bigint;
  expenseByCategory: Map<string, bigint>;
  /** Cards 8 and 9 (as of the end of the date). */
  receivablePaise: bigint;
  payablePaise: bigint;
  /** Card 10: open reminders due on or before the date. */
  collectDue: DueSummary;
  payDue: DueSummary;
  /** Bank balances row. */
  banks: Array<{ bankAccountId: string; balancePaise: bigint }>;
  chequesInHandPaise: bigint;
  /** Owner-only "আজকের লাভ": the day's income − expense accounts. */
  profitPaise: bigint;
  dayStatus: DayStatus | null;
}

export const VEHICLE_BUCKET = "VEHICLE";

function dueSummary(list: readonly Reminder[], date: string): DueSummary {
  let amount = 0n;
  let overdue = 0;
  for (const r of list) {
    amount += BigInt(r.amountPaise ?? "0");
    if (r.dueDate < date) overdue++;
  }
  return { count: list.length, amountPaise: amount, overdueCount: overdue };
}

/** Income and expense accounts (a JOURNAL may use free-form keys: those are skipped). */
function isProfitAccount(acc: string): boolean {
  try {
    const type = accountType(acc);
    return type === "income" || (type === "expense" && acc !== ACC.PURCHASE);
  } catch {
    return false;
  }
}

function netOf(v: { dr: string; cr: string } | undefined): bigint {
  return v ? BigInt(v.dr) - BigInt(v.cr) : 0n;
}

export async function dashboardData(godownId: string, date: string): Promise<DashboardData> {
  const d = db();
  const [aggRows, dayVouchers, reminders, banks, dayStatus] = await Promise.all([
    d.dailyAgg
      .where("[godownId+date]")
      .between([godownId, ""], [godownId, date], true, true)
      .toArray(),
    d.vouchers.where("[godownId+date]").equals([godownId, date]).toArray(),
    d.reminders.where("[godownId+status]").equals([godownId, "open"]).toArray(),
    d.bankAccounts.where("godownId").equals(godownId).toArray(),
    d.dayStatus.get(`${godownId}:${date}`),
  ]);

  // Balances as of the end of `date` (and CASH before it).
  const balances = new Map<string, bigint>();
  const stock = new Map<string, VarietyStock>();
  let openingCash = 0n;
  let cashIn = 0n;
  let cashOut = 0n;
  let profit = 0n;
  for (const row of aggRows) {
    const today = row.date === date;
    for (const [acc, v] of Object.entries(row.accounts)) {
      const net = netOf(v);
      balances.set(acc, (balances.get(acc) ?? 0n) + net);
      if (acc === ACC.CASH) {
        if (today) {
          cashIn += BigInt(v.dr);
          cashOut += BigInt(v.cr);
        } else openingCash += net;
      }
      if (today && isProfitAccount(acc)) profit -= net;
    }
    for (const [key, s] of Object.entries(row.stock)) {
      const [varietyId, location] = key.split("|");
      if (location !== "STORE" || !varietyId) continue;
      const cur = stock.get(varietyId) ?? { varietyId, qtyG: 0n, valuePaise: 0n };
      cur.qtyG += BigInt(s.qtyG);
      cur.valuePaise += BigInt(s.valuePaise);
      stock.set(varietyId, cur);
    }
  }

  let receivable = 0n;
  let payable = 0n;
  for (const [acc, bal] of balances) {
    if (!acc.startsWith("PARTY:")) continue;
    if (bal > 0n) receivable += bal;
    else payable -= bal;
  }

  // The day's own figures.
  let saleQty = 0n;
  let saleAmount = 0n;
  let saleCount = 0;
  let purchaseQty = 0n;
  let purchaseAmount = 0n;
  let purchaseCount = 0;
  const expenseByCategory = new Map<string, bigint>();
  const addExpense = (k: string, p: bigint) =>
    expenseByCategory.set(k, (expenseByCategory.get(k) ?? 0n) + p);
  for (const v of dayVouchers as Voucher[]) {
    if (v.status !== "active") continue;
    switch (v.type) {
      case "SALE":
        saleCount++;
        saleAmount += BigInt(v.totalPaise);
        for (const l of v.lines) saleQty += BigInt(l.netG);
        break;
      case "PURCHASE":
        purchaseCount++;
        purchaseAmount += BigInt(v.totalPaise);
        for (const l of v.lines) purchaseQty += BigInt(l.netG);
        break;
      case "EXPENSE":
        addExpense(v.categoryCode, BigInt(v.amountPaise));
        break;
      case "TRIP":
        for (const e of v.expenses) addExpense(VEHICLE_BUCKET, BigInt(e.amountPaise));
        break;
      default:
        break;
    }
  }
  let expense = 0n;
  for (const p of expenseByCategory.values()) expense += p;

  const due = reminders.filter((r) => r.dueDate <= date);
  const stockByVariety = [...stock.values()].filter((s) => s.qtyG !== 0n || s.valuePaise !== 0n);
  let stockQty = 0n;
  let stockValue = 0n;
  for (const s of stockByVariety) {
    stockQty += s.qtyG;
    stockValue += s.valuePaise;
  }

  return {
    date,
    openingCashPaise: openingCash,
    cashInPaise: cashIn,
    cashOutPaise: cashOut,
    expectedClosingCashPaise: openingCash + cashIn - cashOut,
    stockQtyG: stockQty,
    stockValuePaise: stockValue,
    stockByVariety,
    saleQtyG: saleQty,
    saleAmountPaise: saleAmount,
    saleCount,
    purchaseQtyG: purchaseQty,
    purchaseAmountPaise: purchaseAmount,
    purchaseCount,
    expensePaise: expense,
    expenseByCategory,
    receivablePaise: receivable,
    payablePaise: payable,
    collectDue: dueSummary(
      due.filter((r) => r.kind === "COLLECT_DUE" || r.kind === "CHEQUE"),
      date,
    ),
    payDue: dueSummary(
      due.filter((r) => r.kind === "PAY_DUE"),
      date,
    ),
    banks: banks
      .filter((b) => b.status === "active")
      .map((b) => ({ bankAccountId: b._id, balancePaise: balances.get(`BANK:${b._id}`) ?? 0n })),
    chequesInHandPaise: balances.get(ACC.CHEQUE_IN_HAND) ?? 0n,
    profitPaise: profit,
    dayStatus: dayStatus ?? null,
  };
}

/** Top `n` open reminders due soonest (dashboard list), overdue first. */
export async function topReminders(godownId: string, n = 5): Promise<Reminder[]> {
  const list = await db().reminders.where("[godownId+status]").equals([godownId, "open"]).toArray();
  return list
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
    .slice(0, n);
}

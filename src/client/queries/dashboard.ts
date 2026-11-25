/**
 * Dashboard reads for ONE Gola (requirement_v2 §12.1). Balances (cash, bank, stock, dues) are the
 * position at the END of the range; flows (purchase, sales, expenses, cash in / out, vehicle
 * income) are totals WITHIN the range. Everything is derived from documents, ledger lines and
 * stock moves — nothing is stored. The all-Golas sum lives in `consolidated/dashboard.ts`.
 */
import { addDays, todayIST } from "@/domain/dates";
import { cashEffects, cashbookDayFromEffects, type CashbookDay } from "@/domain/v2/cashbook";
import { billState, dueBillsOf, type Direction } from "@/domain/v2/payments";
import { businessDate, type Doc, type Party, type Payment } from "@/domain/schemas";
import { db } from "../db/dexie";
import { getGodownSettings } from "../db/meta";

export interface OverviewData {
  purchasePaise: bigint;
  purchaseG: bigint;
  salesPaise: bigint;
  salesG: bigint;
  expensesPaise: bigint;
  /** Vehicle trip costs within the range (shown with expenses, labelled). */
  vehicleCostPaise: bigint;
  cashPaise: bigint;
  bankPaise: bigint;
  banks: Array<{ id: string; name: string; paise: bigint }>;
  paddyG: bigint;
  riceG: bigint;
  millPaddyG: bigint;
  mills: Array<{ id: string; name: string; g: bigint }>;
  receivablePaise: bigint;
  farmerPayablePaise: bigint;
  millPayablePaise: bigint;
  vehicleIncomePaise: bigint;
  cashInPaise: bigint;
  cashOutPaise: bigint;
  /** Per day of the range (max 92 days): purchase and sales totals. */
  series: Array<{ date: string; purchasePaise: bigint; salesPaise: bigint }>;
  /** Cash flow over the range: opening at `from`, flows, closing at `to`. */
  cashflow: { cash: FlowSummary; bank: FlowSummary };
  /** Warehouse paddy by variety at the range end. */
  paddyByVariety: Array<{ varietyId: string; g: bigint }>;
}

export interface FlowSummary {
  openingPaise: bigint;
  receivedPaise: bigint;
  paidPaise: bigint;
  expensesPaise: bigint;
  /** Opening entries and day-close differences within the range (signed). */
  otherPaise: bigint;
  closingPaise: bigint;
}

const SALES_SIDE = new Set(["CUSTOMER", "MILL", "VEHICLE_CUSTOMER", "GOLA"]);

export async function golaDocs(godownId: string): Promise<Doc[]> {
  return (await db().vouchers.where("godownId").equals(godownId).toArray()) as Doc[];
}

function flow(
  effects: ReturnType<typeof cashEffects>,
  match: (account: string) => boolean,
  from: string,
  to: string,
): FlowSummary {
  let opening = 0n;
  let received = 0n;
  let paid = 0n;
  let expenses = 0n;
  let other = 0n;
  for (const e of effects) {
    if (!match(e.account) || e.date > to) continue;
    if (e.date < from) {
      opening += e.signedPaise;
      continue;
    }
    const abs = e.signedPaise < 0n ? -e.signedPaise : e.signedPaise;
    if (e.category === "RECEIVED") received += abs;
    else if (e.category === "PAID") paid += abs;
    else if (e.category === "EXPENSE") expenses += abs;
    else other += e.signedPaise;
  }
  return {
    openingPaise: opening,
    receivedPaise: received,
    paidPaise: paid,
    expensesPaise: expenses,
    otherPaise: other,
    closingPaise: opening + received - paid - expenses + other,
  };
}

export function emptyOverview(): OverviewData {
  const f: FlowSummary = {
    openingPaise: 0n,
    receivedPaise: 0n,
    paidPaise: 0n,
    expensesPaise: 0n,
    otherPaise: 0n,
    closingPaise: 0n,
  };
  return {
    purchasePaise: 0n,
    purchaseG: 0n,
    salesPaise: 0n,
    salesG: 0n,
    expensesPaise: 0n,
    vehicleCostPaise: 0n,
    cashPaise: 0n,
    bankPaise: 0n,
    banks: [],
    paddyG: 0n,
    riceG: 0n,
    millPaddyG: 0n,
    mills: [],
    receivablePaise: 0n,
    farmerPayablePaise: 0n,
    millPayablePaise: 0n,
    vehicleIncomePaise: 0n,
    cashInPaise: 0n,
    cashOutPaise: 0n,
    series: [],
    cashflow: { cash: { ...f }, bank: { ...f } },
    paddyByVariety: [],
  };
}

export function daysBetween(from: string, to: string, max = 92): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}

export async function golaOverview(
  godownId: string,
  from: string,
  to: string,
): Promise<OverviewData> {
  const d = db();
  const docs = await golaDocs(godownId);
  const o = emptyOverview();
  const series = new Map<string, { purchase: bigint; sales: bigint }>(
    daysBetween(from, to).map((x) => [x, { purchase: 0n, sales: 0n }]),
  );
  for (const doc of docs) {
    if (doc.status !== "active") continue;
    const date = businessDate(doc);
    if (date < from || date > to) continue;
    switch (doc.type) {
      case "PURCHASE":
        o.purchasePaise += BigInt(doc.totalPaise);
        o.purchaseG += BigInt(doc.weight.netG);
        if (series.has(date)) series.get(date)!.purchase += BigInt(doc.totalPaise);
        break;
      case "SALE":
        if (doc.saleStatus !== "CONFIRMED") break;
        o.salesPaise += BigInt(doc.totalPaise);
        o.salesG += BigInt(doc.weight.netG);
        if (series.has(date)) series.get(date)!.sales += BigInt(doc.totalPaise);
        break;
      case "EXPENSE":
        o.expensesPaise += BigInt(doc.amountPaise);
        break;
      case "TRIP":
        o.vehicleIncomePaise += BigInt(doc.totalIncomePaise);
        for (const c of doc.costs) o.vehicleCostPaise += BigInt(c.amountPaise);
        break;
      default:
        break;
    }
  }
  o.series = [...series.entries()].map(([date, v]) => ({
    date,
    purchasePaise: v.purchase,
    salesPaise: v.sales,
  }));

  // Cash / bank: flows in range and balances at the end (same classifier as the cashbook).
  const effects = docs.flatMap(cashEffects);
  o.cashflow.cash = flow(effects, (a) => a === "CASH", from, to);
  o.cashflow.bank = flow(effects, (a) => a.startsWith("BANK:"), from, to);
  o.cashPaise = o.cashflow.cash.closingPaise;
  o.bankPaise = o.cashflow.bank.closingPaise;
  o.cashInPaise = o.cashflow.cash.receivedPaise;
  o.cashOutPaise = o.cashflow.cash.paidPaise + o.cashflow.cash.expensesPaise;
  const banks = await d.bankAccounts.where("godownId").equals(godownId).toArray();
  o.banks = banks
    .filter((b) => b.status === "active")
    .map((b) => ({
      id: b._id,
      name: b.name,
      paise: effects
        .filter((e) => e.account === `BANK:${b._id}` && e.date <= to)
        .reduce((s, e) => s + e.signedPaise, 0n),
    }));

  // Party positions at the range end, by role.
  const parties = new Map(
    (await d.parties.where("godownId").equals(godownId).toArray()).map((p) => [p._id, p] as const),
  );
  const lines = await d.ledgerLines
    .where("[godownId+date]")
    .between([godownId, ""], [godownId, to], true, true)
    .toArray();
  const bal = new Map<string, bigint>();
  for (const l of lines) {
    if (!l.account.startsWith("PARTY:")) continue;
    bal.set(l.account, (bal.get(l.account) ?? 0n) + BigInt(l.debitPaise) - BigInt(l.creditPaise));
  }
  for (const [acct, v] of bal) {
    const p = parties.get(acct.slice(6));
    const roles = p?.roles ?? [];
    if (v > 0n && roles.some((r) => SALES_SIDE.has(r))) o.receivablePaise += v;
    if (v < 0n && (roles.includes("FARMER") || roles.includes("SUPPLIER")))
      o.farmerPayablePaise -= v;
    if (v < 0n && roles.includes("MILL")) o.millPayablePaise -= v;
  }

  // Stock at the range end.
  const moves = await d.stockMoves
    .where("[godownId+date]")
    .between([godownId, ""], [godownId, to], true, true)
    .toArray();
  const mills = new Map<string, bigint>();
  const byVariety = new Map<string, bigint>();
  for (const m of moves) {
    const q = BigInt(m.qtyG);
    if (m.product === "PADDY" && m.location === "WAREHOUSE") {
      o.paddyG += q;
      const k = m.varietyId ?? "";
      byVariety.set(k, (byVariety.get(k) ?? 0n) + q);
    } else if (m.product === "PADDY" && m.location === "MILL") {
      o.millPaddyG += q;
      const k = m.millPartyId ?? "";
      mills.set(k, (mills.get(k) ?? 0n) + q);
    } else if (m.product === "RICE" && m.location === "WAREHOUSE") o.riceG += q;
  }
  o.mills = [...mills.entries()]
    .filter(([, g]) => g !== 0n)
    .map(([id, g]) => ({ id, name: parties.get(id)?.name ?? "", g }));
  o.paddyByVariety = [...byVariety.entries()]
    .filter(([, g]) => g !== 0n)
    .map(([varietyId, g]) => ({ varietyId, g }))
    .sort((a, b) => (a.g > b.g ? -1 : 1));
  return o;
}

export interface RecentItem {
  doc: Doc;
  party?: Party;
  godownId: string;
  /** For a payment: the bill it settles (for a readable title). */
  source?: Doc;
}

async function withParties(godownId: string, docs: Doc[]): Promise<RecentItem[]> {
  const parties = new Map(
    (await db().parties.where("godownId").equals(godownId).toArray()).map(
      (p) => [p._id, p] as const,
    ),
  );
  const srcIds = [
    ...new Set(
      docs
        .map((d) => (d.type === "PAYMENT" && d.source.id ? d.source.id.split(":")[0]! : ""))
        .filter(Boolean),
    ),
  ];
  const sources = new Map(
    ((await db().vouchers.bulkGet(srcIds)).filter(Boolean) as Doc[]).map(
      (d) => [d._id, d] as const,
    ),
  );
  return docs.map((doc) => {
    const pid = PARTY_OF(doc);
    const src =
      doc.type === "PAYMENT" && doc.source.id
        ? sources.get(doc.source.id.split(":")[0]!)
        : undefined;
    return {
      doc,
      godownId,
      ...(pid && parties.get(pid) ? { party: parties.get(pid) } : {}),
      ...(src ? { source: src } : {}),
    };
  });
}

const PARTY_OF = (doc: Doc): string | undefined => {
  switch (doc.type) {
    case "PURCHASE":
    case "SALE":
    case "SECOND_PARTY":
      return doc.partyId;
    case "PAYMENT":
    case "EXPENSE":
      return doc.partyId;
    case "MILL_DISPATCH":
    case "MILL_RETURN":
      return doc.millPartyId;
    case "TRIP":
      return doc.customerPartyId;
    default:
      return undefined;
  }
};

export function partyIdOf(doc: Doc): string | undefined {
  return PARTY_OF(doc);
}

/** The last `n` entries (any module) by entry time. */
export async function recentEntries(godownId: string, n = 10): Promise<RecentItem[]> {
  const docs = (await golaDocs(godownId))
    .filter((x) => x.status === "active" && x.type !== "DAY_CLOSE")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, n);
  return withParties(godownId, docs);
}

export interface DueAlert {
  godownId: string;
  doc: Doc;
  party?: Party;
  direction: Direction;
  duePaise: bigint;
  dueDate: string;
  overdue: boolean;
}

/** Bills overdue or due within `withinDays` days (collect = IN, pay = OUT). */
export async function dueAlerts(godownId: string, withinDays = 3): Promise<DueAlert[]> {
  const today = todayIST();
  const limit = addDays(today, withinDays);
  const docs = await golaDocs(godownId);
  const payments = docs.filter((x): x is Payment => x.type === "PAYMENT" && x.status === "active");
  const bySource = new Map<string, Payment[]>();
  for (const p of payments) {
    if (!p.source.id) continue;
    bySource.set(p.source.id, [...(bySource.get(p.source.id) ?? []), p]);
  }
  const parties = new Map(
    (await db().parties.where("godownId").equals(godownId).toArray()).map(
      (p) => [p._id, p] as const,
    ),
  );
  const out: DueAlert[] = [];
  for (const doc of docs) {
    for (const b of dueBillsOf(doc)) {
      if (!b.dueDate || b.dueDate > limit) continue;
      const st = billState(b, bySource.get(b.sourceId) ?? [], today);
      if (st.duePaise <= 0n) continue;
      out.push({
        godownId,
        doc,
        ...(b.partyId && parties.get(b.partyId) ? { party: parties.get(b.partyId) } : {}),
        direction: b.direction,
        duePaise: st.duePaise,
        dueDate: b.dueDate,
        overdue: b.dueDate < today,
      });
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

export interface LowStockAlert {
  godownId: string;
  varietyId?: string;
  haveG: bigint;
  thresholdG: bigint;
}

/** Warehouse paddy below the Gola's thresholds (total and per variety, §9.3). */
export async function lowStockAlerts(godownId: string): Promise<LowStockAlert[]> {
  const settings = await getGodownSettings(godownId);
  const ls = settings?.lowStock;
  if (!ls || (!ls.totalG && !ls.perVariety)) return [];
  const moves = await db()
    .stockMoves.where("[godownId+product+location]")
    .equals([godownId, "PADDY", "WAREHOUSE"])
    .toArray();
  let total = 0n;
  const byVariety = new Map<string, bigint>();
  for (const m of moves) {
    total += BigInt(m.qtyG);
    if (m.varietyId)
      byVariety.set(m.varietyId, (byVariety.get(m.varietyId) ?? 0n) + BigInt(m.qtyG));
  }
  const out: LowStockAlert[] = [];
  if (ls.totalG && BigInt(ls.totalG) > 0n && total < BigInt(ls.totalG)) {
    out.push({ godownId, haveG: total, thresholdG: BigInt(ls.totalG) });
  }
  for (const [vid, th] of Object.entries(ls.perVariety ?? {})) {
    const have = byVariety.get(vid) ?? 0n;
    if (BigInt(th) > 0n && have < BigInt(th)) {
      out.push({ godownId, varietyId: vid, haveG: have, thresholdG: BigInt(th) });
    }
  }
  return out;
}

// ── Daily cashbook (§12.1B) ──────────────────────────────────────────────────────────────────

export interface CashbookView extends CashbookDay {
  /** Bank accounts and their closing at the end of the day (shown beside cash). */
  banks: Array<{ id: string; name: string; closingPaise: bigint }>;
  closed: boolean;
  lateEntry: boolean;
  dayClose?: Doc;
}

/** One day of the cash book (account "CASH") or one bank book ("BANK:<id>"). */
export async function cashbookView(
  godownId: string,
  account: string,
  date: string,
): Promise<CashbookView> {
  const d = db();
  const docs = await golaDocs(godownId);
  const effects = docs.flatMap(cashEffects);
  const day = cashbookDayFromEffects(
    effects.filter((e) => e.account === account),
    account,
    date,
  );
  const banks = (await d.bankAccounts.where("godownId").equals(godownId).toArray())
    .filter((b) => b.status === "active")
    .map((b) => ({
      id: b._id,
      name: b.name,
      closingPaise: effects
        .filter((e) => e.account === `BANK:${b._id}` && e.date <= date)
        .reduce((s, e) => s + e.signedPaise, 0n),
    }));
  const status = await d.dayStatus.get(`${godownId}:${date}`);
  const dayClose = docs.find(
    (x) => x.type === "DAY_CLOSE" && x.status === "active" && x.date === date,
  );
  return {
    ...day,
    banks,
    closed: !!dayClose,
    lateEntry: !!status?.lateEntry && !!dayClose,
    ...(dayClose ? { dayClose } : {}),
  };
}

// ── Daily overview (§12.1D) ──────────────────────────────────────────────────────────────────

export interface DailyRow {
  date: string;
  receivedPaise: bigint;
  paidPaise: bigint;
  expensesPaise: bigint;
  purchasePaise: bigint;
  purchaseG: bigint;
  salesPaise: bigint;
  salesG: bigint;
  stockInG: bigint;
  stockOutG: bigint;
  closingCashPaise: bigint;
  closingPaddyG: bigint;
  closingRiceG: bigint;
}

/** One row per day of the range (cash + bank flows; warehouse paddy in / out; closings). */
export async function dailyRows(godownId: string, from: string, to: string): Promise<DailyRow[]> {
  const d = db();
  const docs = await golaDocs(godownId);
  const effects = docs.flatMap(cashEffects);
  const moves = await d.stockMoves
    .where("[godownId+date]")
    .between([godownId, ""], [godownId, to], true, true)
    .toArray();
  const days = daysBetween(from, to, 366);
  const rows = new Map<string, DailyRow>(
    days.map((date) => [
      date,
      {
        date,
        receivedPaise: 0n,
        paidPaise: 0n,
        expensesPaise: 0n,
        purchasePaise: 0n,
        purchaseG: 0n,
        salesPaise: 0n,
        salesG: 0n,
        stockInG: 0n,
        stockOutG: 0n,
        closingCashPaise: 0n,
        closingPaddyG: 0n,
        closingRiceG: 0n,
      },
    ]),
  );
  let cash = 0n;
  let paddy = 0n;
  let rice = 0n;
  for (const e of effects) {
    if (e.account === "CASH" && e.date < from) cash += e.signedPaise;
    const r = rows.get(e.date);
    if (!r) continue;
    const abs = e.signedPaise < 0n ? -e.signedPaise : e.signedPaise;
    if (e.category === "RECEIVED") r.receivedPaise += abs;
    else if (e.category === "PAID") r.paidPaise += abs;
    else if (e.category === "EXPENSE") r.expensesPaise += abs;
  }
  for (const m of moves) {
    if (m.location !== "WAREHOUSE") continue;
    const q = BigInt(m.qtyG);
    if (m.date < from) {
      if (m.product === "PADDY") paddy += q;
      else if (m.product === "RICE") rice += q;
      continue;
    }
    const r = rows.get(m.date);
    if (!r || m.product !== "PADDY") continue;
    if (q > 0n) r.stockInG += q;
    else r.stockOutG -= q;
  }
  for (const doc of docs) {
    if (doc.status !== "active") continue;
    if (doc.type !== "PURCHASE" && doc.type !== "SALE") continue;
    const r = rows.get(doc.transactionDate);
    if (!r) continue;
    if (doc.type === "PURCHASE") {
      r.purchasePaise += BigInt(doc.totalPaise);
      r.purchaseG += BigInt(doc.weight.netG);
    } else if (doc.saleStatus === "CONFIRMED") {
      r.salesPaise += BigInt(doc.totalPaise);
      r.salesG += BigInt(doc.weight.netG);
    }
  }
  for (const date of days) {
    const r = rows.get(date)!;
    for (const e of effects) if (e.account === "CASH" && e.date === date) cash += e.signedPaise;
    for (const m of moves) {
      if (m.date !== date || m.location !== "WAREHOUSE") continue;
      if (m.product === "PADDY") paddy += BigInt(m.qtyG);
      else if (m.product === "RICE") rice += BigInt(m.qtyG);
    }
    r.closingCashPaise = cash;
    r.closingPaddyG = paddy;
    r.closingRiceG = rice;
  }
  return days.map((x) => rows.get(x)!);
}

/** Every active document whose business (or payment) date is `date` — the single-day list. */
export async function docsOfDay(godownId: string, date: string): Promise<RecentItem[]> {
  const docs = (await golaDocs(godownId)).filter(
    (x) => x.status === "active" && x.type !== "DAY_CLOSE" && businessDate(x) === date,
  );
  return withParties(
    godownId,
    docs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  );
}

/** Every stock move of a Gola (for the Daily Stock tab). */
export async function golaMoves(godownId: string) {
  return db()
    .stockMoves.where("[godownId+date]")
    .between([godownId, ""], [godownId, "￿"], true, true)
    .toArray();
}

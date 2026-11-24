/**
 * Report builders (spec §9.14). Every per-godown report reads ONLY the given godown through the
 * normal queries; the all-godowns reports live in `queries/consolidated/reports.ts`.
 * All money/weight math is bigint; labels come from i18n (current UI language).
 */
import { agingBuckets, type AgingBucket } from "@/domain/aging";
import { vehiclePnl } from "@/domain/calc/vehicle";
import { SEASONS } from "@/domain/dates";
import { GRAMS_PER_QUINTAL } from "@/domain/money";
import { ACC, accountType } from "@/domain/posting/accounts";
import { divRoundHalfUp } from "@/domain/rounding";
import type { LedgerLine, Voucher, VoucherOf } from "@/domain/schemas";
import type { TKey, TVars } from "@/i18n/translate";
import { db } from "../db/dexie";
import { accountBook } from "../queries/cashbank";
import { VEHICLE_BUCKET } from "../queries/dashboard";
import { dueList, partyBills, partyStatement } from "../queries/parties";
import { loadRegister } from "../queries/vouchers";
import { vehicleSummaries } from "../queries/vehicles";
import { amountOf } from "../ui/amount";
import { sumCol, type CellValue, type ReportModel, type ReportTable } from "./model";

export interface Labels {
  t: (k: TKey, vars?: TVars) => string;
  party: (id: string | undefined) => string;
  variety: (id: string | undefined) => string;
  bank: (id: string | undefined) => string;
  vehicle: (id: string | undefined) => string;
  category: (code: string) => string;
  godown: (id: string) => string;
}

export interface ReportCtx {
  godownId: string;
  /** Accessible godowns (consolidated reports). */
  godownIds: readonly string[];
  from: string;
  to: string;
  partyId?: string;
  /** Account for the cash/bank book ("CASH" or "BANK:<id>"). */
  account?: string;
  labels: Labels;
}

export type ReportGroup = "daily" | "party" | "stock" | "owner" | "all";

export interface ReportDef {
  id: string;
  title: TKey;
  group: ReportGroup;
  ownerOnly?: boolean;
  /** Owner or `consolidated` permission (mixes godowns, read-only). */
  consolidated?: boolean;
  needs?: "party" | "account";
  /** Single as-of date reports ignore `from`. */
  asOf?: boolean;
  build: (ctx: ReportCtx) => Promise<ReportModel>;
}

// ── shared helpers ───────────────────────────────────────────────────────────

const avgRate = (amount: bigint, qtyG: bigint): bigint | null =>
  qtyG > 0n ? divRoundHalfUp(amount * GRAMS_PER_QUINTAL, qtyG) : null;

function vouchersOf(godownId: string, type: Voucher["type"], from: string, to: string) {
  return db()
    .vouchers.where("[godownId+type+date]")
    .between([godownId, type, from], [godownId, type, to], true, true)
    .filter((v) => v.status === "active")
    .toArray();
}

function linesIn(godownId: string, from: string, to: string): Promise<LedgerLine[]> {
  return db()
    .ledgerLines.where("[godownId+date]")
    .between([godownId, from], [godownId, to], true, true)
    .toArray();
}

function partyOf(v: Voucher): string | undefined {
  if (v.type === "LOAD") return v.toMillPartyId;
  if (v.type === "EXPENSE") return v.payeePartyId;
  return "partyId" in v ? (v.partyId as string | undefined) : undefined;
}

/** Human label of any account key. */
export function accountLabel(key: string, l: Labels): string {
  if (key.startsWith("BANK:")) return l.t("account.bank", { name: l.bank(key.slice(5)) });
  if (key.startsWith("PARTY:")) return l.party(key.slice(6));
  if (key.startsWith("EXP:")) return l.t("account.expense", { name: l.category(key.slice(4)) });
  if (key.startsWith("VEH_INCOME:")) {
    return l.t("account.vehicleIncome", { name: l.vehicle(key.slice(11)) });
  }
  if (key.startsWith("VEH_EXP:")) {
    const [, veh, kind] = key.split(":");
    return `${l.t("account.vehicleExpense", { name: l.vehicle(veh) })} · ${l.t(`vehicle.expenseKind.${kind}` as TKey)}`;
  }
  return l.t(`account.${key}` as TKey);
}

const typeLabel = (v: Voucher, l: Labels) => l.t(`voucherType.${v.type}` as TKey);
const vLink = (v: Voucher): string =>
  v.type === "PURCHASE"
    ? `/purchase/view?id=${v._id}`
    : v.type === "SALE"
      ? `/sale/view?id=${v._id}`
      : v.type === "LOAD"
        ? `/load/view?id=${v._id}`
        : v.type === "PAYMENT" || v.type === "RECEIPT"
          ? `/payment/view?id=${v._id}`
          : `/voucher/view?id=${v._id}`;

// ── builders ─────────────────────────────────────────────────────────────────

/** দৈনিক খাতা: all vouchers of the period, their cash and bank effect, totals. */
async function dayBook(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const [vs, lines] = await Promise.all([
    db()
      .vouchers.where("[godownId+date]")
      .between([c.godownId, c.from], [c.godownId, c.to], true, true)
      .filter((v) => v.status === "active")
      .toArray(),
    linesIn(c.godownId, c.from, c.to),
  ]);
  const cash = new Map<string, bigint>();
  const bank = new Map<string, bigint>();
  for (const x of lines) {
    const net = BigInt(x.debitPaise) - BigInt(x.creditPaise);
    if (x.account === ACC.CASH) cash.set(x.voucherId, (cash.get(x.voucherId) ?? 0n) + net);
    else if (x.account.startsWith("BANK:"))
      bank.set(x.voucherId, (bank.get(x.voucherId) ?? 0n) + net);
  }
  vs.sort((a, b) =>
    a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1,
  );
  const rows: CellValue[][] = vs.map((v) => [
    v.date,
    v.number,
    typeLabel(v, l),
    l.party(partyOf(v)),
    cash.get(v._id) ?? 0n,
    bank.get(v._id) ?? 0n,
    amountOf(v),
  ]);
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.date"), kind: "date" },
          { label: l.t("reports.col.number"), kind: "text" },
          { label: l.t("reports.col.type"), kind: "text" },
          { label: l.t("reports.col.party"), kind: "text" },
          { label: l.t("reports.col.cashEffect"), kind: "money" },
          { label: l.t("reports.col.bankEffect"), kind: "money" },
          { label: l.t("reports.col.amount"), kind: "money" },
        ],
        rows,
        totals: [
          l.t("reports.col.total"),
          null,
          null,
          null,
          sumCol(rows, 4),
          sumCol(rows, 5),
          null,
        ],
        links: vs.map(vLink),
      },
    ],
  };
}

/** Cash book / bank book: opening, every voucher with running balance, closing. */
async function cashBook(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const account = c.account ?? ACC.CASH;
  const book = await accountBook(c.godownId, account, { from: c.from, to: c.to });
  const rows: CellValue[][] = [
    [c.from, l.t("cashbank.opening"), null, null, null, book.openingPaise],
    ...book.rows.map((r) => [
      r.date,
      r.voucher ? `${r.voucher.number} · ${typeLabel(r.voucher, l)}` : "",
      r.voucher ? l.party(partyOf(r.voucher)) : "",
      r.inPaise,
      r.outPaise,
      r.balancePaise,
    ]),
  ];
  return {
    tables: [
      {
        title: account === ACC.CASH ? l.t("cashbank.cashBook") : accountLabel(account, l),
        columns: [
          { label: l.t("reports.col.date"), kind: "date" },
          { label: l.t("reports.col.number"), kind: "text" },
          { label: l.t("reports.col.party"), kind: "text" },
          { label: l.t("reports.col.in"), kind: "money" },
          { label: l.t("reports.col.out"), kind: "money" },
          { label: l.t("reports.col.balance"), kind: "money" },
        ],
        rows,
        totals: [
          l.t("cashbank.closing"),
          null,
          null,
          book.totalInPaise,
          book.totalOutPaise,
          book.closingPaise,
        ],
        links: [null, ...book.rows.map((r) => (r.voucher ? vLink(r.voucher) : null))],
      },
    ],
  };
}

async function partyReport(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  if (!c.partyId) return { tables: [], notes: [{ text: l.t("reports.needParty"), tone: "warn" }] };
  const st = await partyStatement(c.godownId, c.partyId, { from: c.from, to: c.to });
  const rows: CellValue[][] = [
    [c.from, l.t("party.opening"), null, null, null, st.openingPaise],
    ...st.rows.map((r) => [
      r.date,
      r.number,
      l.t(`voucherType.${r.type}` as TKey),
      r.debitPaise,
      r.creditPaise,
      r.balancePaise,
    ]),
  ];
  return {
    tables: [
      {
        title: l.party(c.partyId),
        columns: [
          { label: l.t("reports.col.date"), kind: "date" },
          { label: l.t("reports.col.number"), kind: "text" },
          { label: l.t("reports.col.type"), kind: "text" },
          { label: l.t("party.debit"), kind: "money" },
          { label: l.t("party.credit"), kind: "money" },
          { label: l.t("reports.col.balance"), kind: "money" },
        ],
        rows,
        totals: [
          l.t("party.closing"),
          null,
          null,
          st.totalDebitPaise,
          st.totalCreditPaise,
          st.closingPaise,
        ],
        links: [null, ...st.rows.map((r) => (r.voucher ? vLink(r.voucher) : null))],
      },
    ],
  };
}

function groupTrade(vs: Array<VoucherOf<"PURCHASE"> | VoucherOf<"SALE">>): {
  byParty: Map<string, { count: number; qty: bigint; amount: bigint; settled: number }>;
  byVariety: Map<string, { qty: bigint; amount: bigint }>;
} {
  const byParty = new Map<
    string,
    { count: number; qty: bigint; amount: bigint; settled: number }
  >();
  const byVariety = new Map<string, { qty: bigint; amount: bigint }>();
  for (const v of vs) {
    const p = byParty.get(v.partyId) ?? { count: 0, qty: 0n, amount: 0n, settled: 0 };
    p.count++;
    p.amount += BigInt(v.totalPaise);
    if (v.type === "SALE" && v.settlementStatus === "SETTLED") p.settled++;
    for (const ln of v.lines) {
      p.qty += BigInt(ln.netG);
      const r = byVariety.get(ln.varietyId) ?? { qty: 0n, amount: 0n };
      r.qty += BigInt(ln.netG);
      r.amount += BigInt(ln.amountPaise);
      byVariety.set(ln.varietyId, r);
    }
    byParty.set(v.partyId, p);
  }
  return { byParty, byVariety };
}

function varietyTable(
  l: Labels,
  byVariety: Map<string, { qty: bigint; amount: bigint }>,
): ReportTable {
  const rows: CellValue[][] = [...byVariety].map(([id, r]) => [
    l.variety(id),
    r.qty,
    r.amount,
    avgRate(r.amount, r.qty),
  ]);
  const q = sumCol(rows, 1);
  const a = sumCol(rows, 2);
  return {
    title: l.t("reports.table.byVariety"),
    columns: [
      { label: l.t("reports.col.variety"), kind: "text" },
      { label: l.t("reports.col.qty"), kind: "qty" },
      { label: l.t("reports.col.amount"), kind: "money" },
      { label: l.t("reports.col.avgRate"), kind: "rate" },
    ],
    rows,
    totals: [l.t("reports.col.total"), q, a, avgRate(a, q)],
  };
}

/** Purchase register: farmer-wise and variety-wise (qty, amount, avg rate). */
async function purchaseRegister(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const vs = (await vouchersOf(c.godownId, "PURCHASE", c.from, c.to)) as Array<
    VoucherOf<"PURCHASE">
  >;
  const { byParty, byVariety } = groupTrade(vs);
  const rows: CellValue[][] = [...byParty].map(([id, r]) => [
    l.party(id),
    r.count,
    r.qty,
    r.amount,
    avgRate(r.amount, r.qty),
  ]);
  const q = sumCol(rows, 2);
  const a = sumCol(rows, 3);
  return {
    tables: [
      {
        title: l.t("reports.table.byParty"),
        columns: [
          { label: l.t("reports.col.party"), kind: "text" },
          { label: l.t("reports.col.count"), kind: "count" },
          { label: l.t("reports.col.qty"), kind: "qty" },
          { label: l.t("reports.col.amount"), kind: "money" },
          { label: l.t("reports.col.avgRate"), kind: "rate" },
        ],
        rows,
        totals: [l.t("reports.col.total"), vs.length, q, a, avgRate(a, q)],
      },
      varietyTable(l, byVariety),
    ],
  };
}

/** Sales register: mill-wise (with settlement status) and variety-wise. */
async function salesRegister(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const vs = (await vouchersOf(c.godownId, "SALE", c.from, c.to)) as Array<VoucherOf<"SALE">>;
  const { byParty, byVariety } = groupTrade(vs);
  const rows: CellValue[][] = [...byParty].map(([id, r]) => [
    l.party(id),
    r.count,
    r.qty,
    r.amount,
    r.settled,
    r.count - r.settled,
  ]);
  const settled = vs.filter((v) => v.settlementStatus === "SETTLED").length;
  return {
    tables: [
      {
        title: l.t("reports.table.byParty"),
        columns: [
          { label: l.t("reports.col.party"), kind: "text" },
          { label: l.t("reports.col.count"), kind: "count" },
          { label: l.t("reports.col.qty"), kind: "qty" },
          { label: l.t("reports.col.amount"), kind: "money" },
          { label: l.t("reports.col.settled"), kind: "count" },
          { label: l.t("reports.col.pending"), kind: "count" },
        ],
        rows,
        totals: [
          l.t("reports.col.total"),
          vs.length,
          sumCol(rows, 2),
          sumCol(rows, 3),
          settled,
          vs.length - settled,
        ],
      },
      varietyTable(l, byVariety),
    ],
  };
}

async function loadReport(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const list = await loadRegister(c.godownId, { from: c.from, to: c.to });
  const rows: CellValue[][] = list.map(({ load: v, marginPaise }) => [
    v.date,
    v.number,
    v.loadPlaceText ?? "",
    v.fromStore ? l.t("load.fromStore") : l.party(v.fromPartyId),
    l.variety(v.varietyId),
    BigInt(v.netG),
    l.party(v.toMillPartyId),
    v.vehicleNumber,
    BigInt(v.totalAmountPaise),
    v.partySellRatePaisePerQtl ? BigInt(v.partySellRatePaisePerQtl) : null,
    v.millRatePaisePerQtl ? BigInt(v.millRatePaisePerQtl) : null,
    marginPaise,
  ]);
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.date"), kind: "date" },
          { label: l.t("reports.col.number"), kind: "text" },
          { label: l.t("reports.col.place"), kind: "text" },
          { label: l.t("reports.col.party"), kind: "text" },
          { label: l.t("reports.col.variety"), kind: "text" },
          { label: l.t("reports.col.qty"), kind: "qty" },
          { label: l.t("reports.col.mill"), kind: "text" },
          { label: l.t("reports.col.vehicle"), kind: "text" },
          { label: l.t("reports.col.amount"), kind: "money" },
          { label: l.t("reports.col.partyRate"), kind: "rate" },
          { label: l.t("reports.col.millRate"), kind: "rate" },
          { label: l.t("reports.col.margin"), kind: "money" },
        ],
        rows,
        totals: [
          l.t("reports.col.total"),
          null,
          null,
          null,
          null,
          sumCol(rows, 5),
          null,
          null,
          sumCol(rows, 8),
          null,
          null,
          sumCol(rows, 11),
        ],
        links: list.map((x) => vLink(x.load)),
      },
    ],
  };
}

/** Stock: per variety opening, in, out, closing quantity and closing value (STORE). */
async function stockReport(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const moves = await db()
    .stockMoves.where("[godownId+date]")
    .between([c.godownId, ""], [c.godownId, c.to], true, true)
    .filter((m) => m.location === "STORE")
    .toArray();
  const by = new Map<string, { open: bigint; inQ: bigint; outQ: bigint; value: bigint }>();
  for (const m of moves) {
    const r = by.get(m.varietyId) ?? { open: 0n, inQ: 0n, outQ: 0n, value: 0n };
    const q = BigInt(m.qtyG);
    if (m.date < c.from) r.open += q;
    else if (q > 0n) r.inQ += q;
    else r.outQ -= q;
    r.value += BigInt(m.valuePaise);
    by.set(m.varietyId, r);
  }
  const rows: CellValue[][] = [...by]
    .filter(([, r]) => r.open !== 0n || r.inQ !== 0n || r.outQ !== 0n || r.value !== 0n)
    .map(([id, r]) => [l.variety(id), r.open, r.inQ, r.outQ, r.open + r.inQ - r.outQ, r.value]);
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.variety"), kind: "text" },
          { label: l.t("reports.col.opening"), kind: "qty" },
          { label: l.t("reports.col.in"), kind: "qty" },
          { label: l.t("reports.col.out"), kind: "qty" },
          { label: l.t("reports.col.closing"), kind: "qty" },
          { label: l.t("reports.col.value"), kind: "money" },
        ],
        rows,
        totals: [
          l.t("reports.col.total"),
          sumCol(rows, 1),
          sumCol(rows, 2),
          sumCol(rows, 3),
          sumCol(rows, 4),
          sumCol(rows, 5),
        ],
      },
    ],
  };
}

const BUCKETS: AgingBucket[] = ["D0_30", "D31_60", "D61_90", "D90_PLUS"];

/** Outstanding & aging: every party with a balance as of today, open bills by age. */
async function outstanding(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const rows: CellValue[][] = [];
  const links: string[] = [];
  for (const d of await dueList(c.godownId)) {
    const bills = await partyBills(c.godownId, d.party._id);
    const open = (d.balancePaise >= 0n ? bills.sales : bills.purchases).map((b) => ({
      date: bills.billDates.get(b.voucherId) ?? c.to,
      outstandingPaise: b.outstandingPaise,
    }));
    const ages = agingBuckets(open, c.to);
    rows.push([
      l.party(d.party._id),
      d.balancePaise > 0n ? d.balancePaise : 0n,
      d.balancePaise < 0n ? -d.balancePaise : 0n,
      ...BUCKETS.map((b) => ages[b]),
    ]);
    links.push(`/party/view?id=${d.party._id}`);
  }
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.party"), kind: "text" },
          { label: l.t("reports.col.receivable"), kind: "money" },
          { label: l.t("reports.col.payable"), kind: "money" },
          ...BUCKETS.map((b) => ({ label: l.t(`due.aging.${b}` as TKey), kind: "money" as const })),
        ],
        rows,
        totals: [l.t("reports.col.total"), ...[1, 2, 3, 4, 5, 6].map((i) => sumCol(rows, i))],
        links,
      },
    ],
  };
}

/** Expense report: by category (incl. own-vehicle trip costs) and by load / vehicle tag. */
async function expenseReport(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const [exps, trips] = await Promise.all([
    vouchersOf(c.godownId, "EXPENSE", c.from, c.to),
    vouchersOf(c.godownId, "TRIP", c.from, c.to),
  ]);
  const byCat = new Map<string, bigint>();
  const byTag = new Map<string, bigint>();
  const add = (m: Map<string, bigint>, k: string, p: bigint) => m.set(k, (m.get(k) ?? 0n) + p);
  for (const v of exps) {
    if (v.type !== "EXPENSE") continue;
    const p = BigInt(v.amountPaise);
    add(byCat, v.categoryCode, p);
    if (v.vehicleId) add(byTag, l.vehicle(v.vehicleId), p);
    if (v.loadId) {
      const load = await db().vouchers.get(v.loadId);
      add(byTag, load?.number ?? v.loadId, p);
    }
  }
  for (const v of trips) {
    if (v.type !== "TRIP") continue;
    for (const e of v.expenses) {
      add(byCat, VEHICLE_BUCKET, BigInt(e.amountPaise));
      add(byTag, l.vehicle(v.vehicleId), BigInt(e.amountPaise));
    }
  }
  const catRows: CellValue[][] = [...byCat].map(([code, p]) => [
    code === VEHICLE_BUCKET ? l.t("exp.vehicleBucket") : l.category(code),
    p,
  ]);
  const tagRows: CellValue[][] = [...byTag].map(([k, p]) => [k, p]);
  return {
    tables: [
      {
        title: l.t("reports.table.byCategory"),
        columns: [
          { label: l.t("reports.col.category"), kind: "text" },
          { label: l.t("reports.col.amount"), kind: "money" },
        ],
        rows: catRows,
        totals: [l.t("reports.col.total"), sumCol(catRows, 1)],
      },
      {
        title: l.t("reports.table.byTag"),
        columns: [
          { label: l.t("reports.col.tag"), kind: "text" },
          { label: l.t("reports.col.amount"), kind: "money" },
        ],
        rows: tagRows,
        totals: [l.t("reports.col.total"), sumCol(tagRows, 1)],
      },
    ],
  };
}

async function vehicleReport(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const list = await vehicleSummaries(c.godownId, { from: c.from, to: c.to });
  const vRows: CellValue[][] = list.map((s) => [
    l.vehicle(s.vehicle._id),
    s.pnl.tripCount,
    s.pnl.freightPaise,
    s.pnl.totalExpensesPaise,
    s.pnl.netProfitPaise,
    s.pnl.dueFromHirersPaise,
  ]);
  const trips = list.flatMap((s) => s.trips).sort((a, b) => (a.date < b.date ? -1 : 1));
  const tRows: CellValue[][] = trips.map((t) => {
    const p = vehiclePnl([t]);
    return [
      t.date,
      l.vehicle(t.vehicleId),
      [t.loadingPlace, t.unloadingPlace].filter(Boolean).join(" → "),
      p.freightPaise,
      p.totalExpensesPaise,
      p.netProfitPaise,
    ];
  });
  return {
    tables: [
      {
        title: l.t("reports.table.byVehicle"),
        columns: [
          { label: l.t("reports.col.vehicle"), kind: "text" },
          { label: l.t("reports.col.trips"), kind: "count" },
          { label: l.t("reports.col.freight"), kind: "money" },
          { label: l.t("reports.col.expenses"), kind: "money" },
          { label: l.t("reports.col.profit"), kind: "money" },
          { label: l.t("reports.col.due"), kind: "money" },
        ],
        rows: vRows,
        totals: [
          l.t("reports.col.total"),
          list.reduce((s, x) => s + x.pnl.tripCount, 0),
          sumCol(vRows, 2),
          sumCol(vRows, 3),
          sumCol(vRows, 4),
          sumCol(vRows, 5),
        ],
      },
      {
        title: l.t("reports.table.byTrip"),
        columns: [
          { label: l.t("reports.col.date"), kind: "date" },
          { label: l.t("reports.col.vehicle"), kind: "text" },
          { label: l.t("reports.col.route"), kind: "text" },
          { label: l.t("reports.col.freight"), kind: "money" },
          { label: l.t("reports.col.expenses"), kind: "money" },
          { label: l.t("reports.col.profit"), kind: "money" },
        ],
        rows: tRows,
        totals: [
          l.t("reports.col.total"),
          null,
          null,
          sumCol(tRows, 3),
          sumCol(tRows, 4),
          sumCol(tRows, 5),
        ],
        links: trips.map(vLink),
      },
    ],
  };
}

/** Shortage: dispatched vs mill-received weight per sale / mill / vehicle. */
async function shortageReport(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const sets = (await vouchersOf(c.godownId, "MILL_SETTLEMENT", c.from, c.to)) as Array<
    VoucherOf<"MILL_SETTLEMENT">
  >;
  const sales = await db().vouchers.bulkGet(sets.map((s) => s.saleId));
  const rows: CellValue[][] = sets.map((s, i) => {
    const sale = sales[i];
    return [
      s.date,
      sale?.number ?? "",
      l.party(s.partyId),
      sale && sale.type === "SALE" ? sale.vehicleNumber : "",
      BigInt(s.dispatchedNetG),
      BigInt(s.millNetG),
      BigInt(s.shortageG),
      BigInt(s.differencePaise),
    ];
  });
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.date"), kind: "date" },
          { label: l.t("reports.col.number"), kind: "text" },
          { label: l.t("reports.col.mill"), kind: "text" },
          { label: l.t("reports.col.vehicle"), kind: "text" },
          { label: l.t("reports.col.dispatched"), kind: "qty" },
          { label: l.t("reports.col.millNet"), kind: "qty" },
          { label: l.t("reports.col.shortage"), kind: "qty" },
          { label: l.t("reports.col.difference"), kind: "money" },
        ],
        rows,
        totals: [
          l.t("reports.col.total"),
          null,
          null,
          null,
          sumCol(rows, 4),
          sumCol(rows, 5),
          sumCol(rows, 6),
          sumCol(rows, 7),
        ],
        links: sales.map((s) => (s ? vLink(s) : null)),
      },
    ],
  };
}

export interface PnlFigures {
  sales: bigint;
  deductions: bigint;
  cogs: bigint;
  grossProfit: bigint;
  expenses: Map<string, bigint>;
  commission: bigint;
  vehicleIncome: bigint;
  vehicleExpense: bigint;
  cashDiff: bigint;
  stockAdj: bigint;
  netProfit: bigint;
}

/** P&L figures of one godown for a period (from ledger lines). */
export async function pnlFigures(godownId: string, from: string, to: string): Promise<PnlFigures> {
  const net = new Map<string, bigint>();
  for (const x of await linesIn(godownId, from, to)) {
    net.set(x.account, (net.get(x.account) ?? 0n) + BigInt(x.debitPaise) - BigInt(x.creditPaise));
  }
  const g = (k: string) => net.get(k) ?? 0n;
  const expenses = new Map<string, bigint>();
  let vehicleIncome = 0n;
  let vehicleExpense = 0n;
  let total = 0n; // Σ (income − expense) over every P&L account
  for (const [k, v] of net) {
    let type: string;
    try {
      type = accountType(k);
    } catch {
      continue;
    }
    if (type === "income") total -= v;
    else if (type === "expense" && k !== ACC.PURCHASE) total -= v;
    if (k.startsWith("EXP:")) expenses.set(k.slice(4), v);
    else if (k.startsWith("VEH_INCOME:")) vehicleIncome -= v;
    else if (k.startsWith("VEH_EXP:")) vehicleExpense += v;
  }
  const sales = -g(ACC.SALES);
  const deductions = g(ACC.SALES_DEDUCTION);
  const cogs = g(ACC.COGS);
  return {
    sales,
    deductions,
    cogs,
    grossProfit: sales - deductions - cogs,
    expenses,
    commission: -g(ACC.COMMISSION_INCOME),
    vehicleIncome,
    vehicleExpense,
    cashDiff: g(ACC.CASH_DIFF),
    stockAdj: g(ACC.STOCK_ADJ),
    netProfit: total,
  };
}

async function pnlReport(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const f = await pnlFigures(c.godownId, c.from, c.to);
  const rows: CellValue[][] = [
    [l.t("reports.pnl.sales"), f.sales],
    [l.t("reports.pnl.deductions"), -f.deductions],
    [l.t("reports.pnl.cogs"), -f.cogs],
    [l.t("reports.pnl.grossProfit"), f.grossProfit],
    ...[...f.expenses].map(([code, p]) => [l.category(code), -p] as CellValue[]),
    [l.t("reports.pnl.commission"), f.commission],
    [l.t("reports.pnl.vehicleIncome"), f.vehicleIncome],
    [l.t("reports.pnl.vehicleExpense"), -f.vehicleExpense],
    [l.t("reports.pnl.cashDiff"), -f.cashDiff],
    [l.t("reports.pnl.stockAdj"), -f.stockAdj],
  ];
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.item"), kind: "text" },
          { label: l.t("reports.col.amount"), kind: "money" },
        ],
        rows,
        totals: [l.t("reports.pnl.netProfit"), f.netProfit],
      },
    ],
  };
}

/** Per load: sale value − cost of goods − tagged expenses (+ mill settlement difference). */
async function loadProfit(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const loads = (await vouchersOf(c.godownId, "LOAD", c.from, c.to)) as Array<VoucherOf<"LOAD">>;
  const rows: CellValue[][] = [];
  for (const ld of loads) {
    const lines = await db()
      .ledgerLines.where("[godownId+date]")
      .between([c.godownId, ""], [c.godownId, "￿"], true, true)
      .filter((x) => x.loadId === ld._id)
      .toArray();
    let sales = 0n;
    let cost = 0n;
    let exp = 0n;
    let comm = 0n;
    for (const x of lines) {
      const net = BigInt(x.debitPaise) - BigInt(x.creditPaise);
      if (x.account === ACC.SALES) sales -= net;
      else if (x.account === ACC.COGS) cost += net;
      else if (x.account === ACC.COMMISSION_INCOME) comm -= net;
      else if (x.account.startsWith("EXP:") || x.account.startsWith("VEH_EXP:")) exp += net;
    }
    let settle = 0n;
    if (ld.linkedSaleId) {
      const s = await db()
        .vouchers.where("[godownId+type+date]")
        .between([c.godownId, "MILL_SETTLEMENT", ""], [c.godownId, "MILL_SETTLEMENT", "￿"])
        .filter(
          (v) =>
            v.status === "active" && v.type === "MILL_SETTLEMENT" && v.saleId === ld.linkedSaleId,
        )
        .first();
      if (s && s.type === "MILL_SETTLEMENT") settle = BigInt(s.differencePaise);
    }
    rows.push([
      ld.date,
      ld.number,
      l.party(ld.toMillPartyId),
      BigInt(ld.netG),
      sales + settle + comm,
      cost,
      exp,
      sales + settle + comm - cost - exp,
    ]);
  }
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.date"), kind: "date" },
          { label: l.t("reports.col.number"), kind: "text" },
          { label: l.t("reports.col.mill"), kind: "text" },
          { label: l.t("reports.col.qty"), kind: "qty" },
          { label: l.t("reports.col.sale"), kind: "money" },
          { label: l.t("reports.col.cost"), kind: "money" },
          { label: l.t("reports.col.expenses"), kind: "money" },
          { label: l.t("reports.col.margin"), kind: "money" },
        ],
        rows,
        totals: [
          l.t("reports.col.total"),
          null,
          null,
          sumCol(rows, 3),
          sumCol(rows, 4),
          sumCol(rows, 5),
          sumCol(rows, 6),
          sumCol(rows, 7),
        ],
        links: loads.map(vLink),
      },
    ],
  };
}

/** Trial balance as of `to`: every account's debit or credit balance; must balance. */
async function trialReport(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const lines = await linesIn(c.godownId, "", c.to);
  const net = new Map<string, bigint>();
  for (const x of lines)
    net.set(x.account, (net.get(x.account) ?? 0n) + BigInt(x.debitPaise) - BigInt(x.creditPaise));
  const rows: CellValue[][] = [...net]
    .filter(([, v]) => v !== 0n)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => [accountLabel(k, l), v > 0n ? v : 0n, v < 0n ? -v : 0n]);
  const dr = sumCol(rows, 1);
  const cr = sumCol(rows, 2);
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.account"), kind: "text" },
          { label: l.t("reports.col.debit"), kind: "money" },
          { label: l.t("reports.col.credit"), kind: "money" },
        ],
        rows,
        totals: [l.t("reports.col.total"), dr, cr],
      },
    ],
    notes: [
      dr === cr
        ? { text: l.t("reports.balanced"), tone: "ok" }
        : { text: l.t("reports.unbalanced"), tone: "warn" },
    ],
  };
}

/** Totals per season (purchase, sale, expense) in the period, with a bar chart. */
async function seasonReport(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const vs = await db()
    .vouchers.where("[godownId+date]")
    .between([c.godownId, c.from], [c.godownId, c.to], true, true)
    .filter((v) => v.status === "active")
    .toArray();
  const by = new Map<string, { pq: bigint; pa: bigint; sq: bigint; sa: bigint; e: bigint }>();
  for (const s of SEASONS) by.set(s, { pq: 0n, pa: 0n, sq: 0n, sa: 0n, e: 0n });
  for (const v of vs) {
    if (!v.season) continue;
    const r = by.get(v.season)!;
    if (v.type === "PURCHASE") {
      r.pa += BigInt(v.totalPaise);
      for (const ln of v.lines) r.pq += BigInt(ln.netG);
    } else if (v.type === "SALE") {
      r.sa += BigInt(v.totalPaise);
      for (const ln of v.lines) r.sq += BigInt(ln.netG);
    } else if (v.type === "EXPENSE") r.e += BigInt(v.amountPaise);
    else if (v.type === "TRIP") for (const e of v.expenses) r.e += BigInt(e.amountPaise);
  }
  const rows: CellValue[][] = [...by].map(([s, r]) => [
    l.t(`season.${s}` as TKey),
    r.pq,
    r.pa,
    r.sq,
    r.sa,
    r.e,
  ]);
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.season"), kind: "text" },
          { label: l.t("reports.col.purchaseQty"), kind: "qty" },
          { label: l.t("reports.col.purchaseAmount"), kind: "money" },
          { label: l.t("reports.col.saleQty"), kind: "qty" },
          { label: l.t("reports.col.saleAmount"), kind: "money" },
          { label: l.t("reports.col.expenses"), kind: "money" },
        ],
        rows,
        totals: [l.t("reports.col.total"), ...[1, 2, 3, 4, 5].map((i) => sumCol(rows, i))],
      },
    ],
    chart: {
      labels: rows.map((r) => String(r[0])),
      series: [
        { name: l.t("reports.col.purchaseAmount"), values: rows.map((r) => r[2] as bigint) },
        { name: l.t("reports.col.saleAmount"), values: rows.map((r) => r[4] as bigint) },
      ],
    },
  };
}

export const REPORTS: ReportDef[] = [
  { id: "dayBook", title: "reports.name.dayBook", group: "daily", build: dayBook },
  {
    id: "cashBook",
    title: "reports.name.cashBook",
    group: "daily",
    needs: "account",
    build: cashBook,
  },
  { id: "expense", title: "reports.name.expense", group: "daily", build: expenseReport },
  {
    id: "partyStatement",
    title: "reports.name.partyStatement",
    group: "party",
    needs: "party",
    build: partyReport,
  },
  {
    id: "purchaseRegister",
    title: "reports.name.purchaseRegister",
    group: "party",
    build: purchaseRegister,
  },
  {
    id: "salesRegister",
    title: "reports.name.salesRegister",
    group: "party",
    build: salesRegister,
  },
  { id: "loadRegister", title: "reports.name.loadRegister", group: "party", build: loadReport },
  {
    id: "outstanding",
    title: "reports.name.outstanding",
    group: "party",
    asOf: true,
    build: outstanding,
  },
  { id: "shortage", title: "reports.name.shortage", group: "party", build: shortageReport },
  { id: "stock", title: "reports.name.stock", group: "stock", build: stockReport },
  { id: "vehicle", title: "reports.name.vehicle", group: "stock", build: vehicleReport },
  { id: "season", title: "reports.name.season", group: "stock", build: seasonReport },
  { id: "pnl", title: "reports.name.pnl", group: "owner", ownerOnly: true, build: pnlReport },
  {
    id: "loadProfit",
    title: "reports.name.loadProfit",
    group: "owner",
    ownerOnly: true,
    build: loadProfit,
  },
  {
    id: "trial",
    title: "reports.name.trial",
    group: "owner",
    ownerOnly: true,
    asOf: true,
    build: trialReport,
  },
];

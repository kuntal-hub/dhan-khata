/**
 * Report builders (requirement_v2 §13). Each one reads real records through the section queries
 * and returns a `ReportModel`. Reports live in their section's রিপোর্ট tab; business-wide,
 * Gola-wise and combined ones in Dashboard → রিপোর্ট. Section reports run per Gola; in the
 * all-Golas view they are run for every Gola and merged with a Gola column (read-only).
 */
import { agingBucketOf, type AgingBucket } from "@/domain/aging";
import { addDays, todayIST } from "@/domain/dates";
import { cashEffects, cashbookDayFromEffects } from "@/domain/v2/cashbook";
import { displayStatus } from "@/domain/v2/payments";
import { millDay, paddyDay, productDay, valueAt, qtyAt } from "@/domain/v2/stock";
import type { ExpenseCategory, Variety } from "@/domain/schemas";
import type { TKey } from "@/i18n/translate";
import { db } from "../db/dexie";
import { dailyRows, daysBetween, golaDocs, golaMoves, golaOverview } from "../queries/dashboard";
import { partyDues, reminderRows } from "../queries/dues";
import { expenseRows } from "../queries/expenses";
import { groupLoads, loadRows, type LoadGroupBy } from "../queries/loads";
import { conversionRows, dispatchRows, returnRows, secondPartySummaries } from "../queries/mill";
import { farmerSummaries, partyLedger, purchaseRows } from "../queries/purchases";
import { fareRows, vehicleOwnerSummaries } from "../queries/fares";
import { customerSummaries, saleRows } from "../queries/sales";
import { pnlByPeriod, tripRows, vehicleSummaries } from "../queries/vehicles";
import { autoTotals, type CellValue, type Column, type ReportModel } from "./model";
import { displayVehicleNumber } from "@/domain/vehicleNumber";

export type T = (key: TKey, vars?: Record<string, string | number>) => string;

export type ReportSection =
  "dashboard" | "purchase" | "sales" | "expenses" | "loads" | "dues" | "vehicles" | "mill";

export interface ReportCtx {
  godownId: string;
  /** Every Gola in scope (business-wide reports). */
  godownIds: string[];
  golaName: (id: string) => string;
  from: string;
  to: string;
  /** Report-specific choice (group by, account, party). */
  opt?: string;
  t: T;
  /** Rice / other products shown (business profile). Absent = shown. */
  rice?: boolean;
}

export interface ReportOption {
  /** "party" = a party picker; otherwise fixed values. */
  kind: "select" | "party" | "bank";
  label: TKey;
  values?: Array<{ value: string; label: TKey }>;
}

export interface ReportDef {
  id: string;
  section: ReportSection;
  title: TKey;
  /** "range" = from–to; "date" = one date (`to`); "none" = current position. */
  period: "range" | "date" | "none";
  option?: ReportOption;
  /** Built once for all Golas (Gola-wise / combined). */
  business?: boolean;
  /** Only about rice / other products: not offered when rice is hidden (business profile). */
  rice?: boolean;
  build(ctx: ReportCtx): Promise<ReportModel>;
}

const col = (label: string, kind: Column["kind"] = "text"): Column => ({ label, kind });
/** A rice quantity column: dropped when rice is hidden (`withoutRice`). */
const riceCol = (label: string): Column => ({ label, kind: "qty", rice: true });
const m = (p: bigint | string): CellValue => ({ m: BigInt(p) });
const q = (g: bigint | string): CellValue => ({ q: BigInt(g) });
const n = (x: number): CellValue => ({ n: x });
const d = (ymd: string): CellValue => ({ d: ymd });

function vName(v: Variety | undefined, t: T): string {
  if (!v) return "";
  if (v.systemKey && !v.renamed && !v.name) return t(`variety.${v.systemKey}` as TKey);
  return v.name;
}
function catName(c: ExpenseCategory | undefined, t: T, code: string): string {
  if (!c) return code;
  return c.name || t(`expenseCategory.${c.code}` as TKey);
}
const status = (t: T, s: string) => t(`ui.status.${s}` as TKey);

function withTotals(
  columns: Column[],
  rows: CellValue[][],
  t: T,
  extra?: Partial<ReportModel>,
): ReportModel {
  return {
    columns,
    rows,
    ...(rows.length ? { totals: autoTotals(columns, rows, t("rep.total")) } : {}),
    ...extra,
  };
}

/** Group rows by a key into day rows (date ascending). */
function byDay<R>(rows: readonly R[], date: (r: R) => string): Map<string, R[]> {
  const out = new Map<string, R[]>();
  for (const r of [...rows].sort((a, b) => (date(a) < date(b) ? -1 : 1))) {
    out.set(date(r), [...(out.get(date(r)) ?? []), r]);
  }
  return out;
}

// ── Purchase ─────────────────────────────────────────────────────────────────────────────────

const purchaseDaily: ReportDef = {
  id: "purchase-daily",
  section: "purchase",
  title: "rep.r.purchase-daily",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = (await purchaseRows(godownId, { from, to })).filter(
      (r) => r.doc.status === "active",
    );
    const days = byDay(rows, (r) => r.doc.transactionDate);
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.count"), "count"),
      col(t("rep.c.qty"), "qty"),
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.paid"), "money"),
      col(t("rep.c.due"), "money"),
    ];
    const out = [...days.entries()].map(([day, rs]) => [
      d(day),
      n(rs.length),
      q(rs.reduce((s, r) => s + BigInt(r.doc.weight.netG), 0n)),
      m(rs.reduce((s, r) => s + BigInt(r.doc.totalPaise), 0n)),
      m(rs.reduce((s, r) => s + r.state.paidPaise, 0n)),
      m(rs.reduce((s, r) => s + (r.state.duePaise > 0n ? r.state.duePaise : 0n), 0n)),
    ]);
    return withTotals(columns, out, t, {
      chart: {
        labels: [...days.keys()],
        series: [{ name: t("rep.c.amount"), values: out.map((r) => (r[3] as { m: bigint }).m) }],
      },
    });
  },
};

const purchaseRegister: ReportDef = {
  id: "purchase-register",
  section: "purchase",
  title: "rep.r.purchase-register",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = await purchaseRows(godownId, { from, to });
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.number")),
      col(t("rep.c.farmer")),
      col(t("rep.c.variety")),
      col(t("rep.c.qty"), "qty"),
      { ...col(t("rep.c.rate"), "money"), noTotal: true },
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.paid"), "money"),
      col(t("rep.c.due"), "money"),
      col(t("rep.c.status")),
    ];
    const active = rows.filter((r) => r.doc.status === "active").reverse();
    return withTotals(
      columns,
      active.map((r) => [
        d(r.doc.transactionDate),
        r.doc.number,
        r.party?.name ?? "",
        vName(r.variety, t),
        q(r.doc.weight.netG),
        m(r.doc.ratePaisePerQtl),
        m(r.doc.totalPaise),
        m(r.state.paidPaise),
        m(r.state.duePaise > 0n ? r.state.duePaise : 0n),
        status(t, displayStatus(r.state)),
      ]),
      t,
    );
  },
};

const farmerLedger: ReportDef = {
  id: "farmer-ledger",
  section: "purchase",
  title: "rep.r.farmer-ledger",
  period: "none",
  async build({ godownId, t }) {
    const rows = await farmerSummaries(godownId);
    const columns = [
      col(t("rep.c.farmer")),
      col(t("rep.c.mobile")),
      col(t("rep.c.qty"), "qty"),
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.payable"), "money"),
      col(t("rep.c.advance"), "money"),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        r.party.name,
        r.party.phone ?? "",
        q(r.qtyG),
        m(r.amountPaise),
        m(r.balancePaise < 0n ? -r.balancePaise : 0n),
        m(r.balancePaise > 0n ? r.balancePaise : 0n),
      ]),
      t,
    );
  },
};

// ── Purchase: vehicle fare (D56) ─────────────────────────────────────────────────────────────

const vehicleFareRegister: ReportDef = {
  id: "vehicle-fare",
  section: "purchase",
  title: "rep.r.vehicle-fare",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = await fareRows(godownId, from, to);
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.number")),
      col(t("rep.c.owner")),
      col(t("rep.c.farmer")),
      col(t("rep.c.kind")),
      col(t("rep.c.fare"), "money"),
      col(t("rep.c.paid"), "money"),
      col(t("rep.c.due"), "money"),
      col(t("rep.c.status")),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        d(r.purchase.transactionDate),
        r.purchase.number,
        r.owner?.name ?? "",
        r.farmer?.name ?? "",
        t(`fare.kind.${r.purchase.vehicleFare!.vehicleKind}` as TKey),
        m(r.state.bill.totalPaise),
        m(r.state.paidPaise),
        m(r.state.duePaise > 0n ? r.state.duePaise : 0n),
        status(t, r.state.status),
      ]),
      t,
    );
  },
};

const vehicleFareMonths: ReportDef = {
  id: "vehicle-fare-months",
  section: "purchase",
  title: "rep.r.vehicle-fare-months",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = await fareRows(godownId, from, to);
    const by = new Map<string, { n: number; fare: bigint; paid: bigint; due: bigint }>();
    for (const r of rows) {
      const k = r.purchase.transactionDate.slice(0, 7);
      const e = by.get(k) ?? { n: 0, fare: 0n, paid: 0n, due: 0n };
      e.n++;
      e.fare += r.state.bill.totalPaise;
      e.paid += r.state.paidPaise;
      e.due += r.state.duePaise > 0n ? r.state.duePaise : 0n;
      by.set(k, e);
    }
    const keys = [...by.keys()].sort();
    const columns = [
      col(t("rep.c.month")),
      col(t("rep.c.trips"), "count"),
      col(t("rep.c.fare"), "money"),
      col(t("rep.c.paid"), "money"),
      col(t("rep.c.due"), "money"),
    ];
    return withTotals(
      columns,
      keys.map((k) => {
        const e = by.get(k)!;
        return [k, n(e.n), m(e.fare), m(e.paid), m(e.due)];
      }),
      t,
      {
        chart: {
          labels: keys,
          series: [{ name: t("rep.c.fare"), values: keys.map((k) => by.get(k)!.fare) }],
        },
      },
    );
  },
};

const vehicleOwnersReport: ReportDef = {
  id: "vehicle-owners",
  section: "purchase",
  title: "rep.r.vehicle-owners",
  period: "none",
  async build({ godownId, t }) {
    const rows = await vehicleOwnerSummaries(godownId);
    const columns = [
      col(t("rep.c.owner")),
      col(t("rep.c.mobile")),
      col(t("rep.c.trips"), "count"),
      col(t("rep.c.fare"), "money"),
      col(t("rep.c.paid"), "money"),
      col(t("rep.c.due"), "money"),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        r.party.name,
        r.party.phone ?? "",
        n(r.jobs),
        m(r.earnedPaise),
        m(r.paidPaise),
        m(r.outstandingPaise),
      ]),
      t,
    );
  },
};

// ── Sales ────────────────────────────────────────────────────────────────────────────────────

const salesDaily: ReportDef = {
  id: "sales-daily",
  section: "sales",
  title: "rep.r.sales-daily",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = (await saleRows(godownId, { from, to })).filter(
      (r) => r.doc.status === "active" && r.doc.saleStatus === "CONFIRMED",
    );
    const days = byDay(rows, (r) => r.doc.transactionDate);
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.count"), "count"),
      col(t("rep.c.paddy"), "qty"),
      riceCol(t("rep.c.rice")),
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.received"), "money"),
      col(t("rep.c.due"), "money"),
    ];
    const out = [...days.entries()].map(([day, rs]) => [
      d(day),
      n(rs.length),
      q(
        rs
          .filter((r) => r.doc.product === "PADDY")
          .reduce((s, r) => s + BigInt(r.doc.weight.netG), 0n),
      ),
      q(
        rs
          .filter((r) => r.doc.product === "RICE")
          .reduce((s, r) => s + BigInt(r.doc.weight.netG), 0n),
      ),
      m(rs.reduce((s, r) => s + BigInt(r.doc.totalPaise), 0n)),
      m(rs.reduce((s, r) => s + r.state.paidPaise, 0n)),
      m(rs.reduce((s, r) => s + (r.state.duePaise > 0n ? r.state.duePaise : 0n), 0n)),
    ]);
    return withTotals(columns, out, t, {
      chart: {
        labels: [...days.keys()],
        series: [{ name: t("rep.c.amount"), values: out.map((r) => (r[4] as { m: bigint }).m) }],
      },
    });
  },
};

const salesRegister: ReportDef = {
  id: "sales-register",
  section: "sales",
  title: "rep.r.sales-register",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = (await saleRows(godownId, { from, to }))
      .filter((r) => r.doc.status === "active")
      .reverse();
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.number")),
      col(t("rep.c.buyer")),
      col(t("rep.c.product")),
      col(t("rep.c.qty"), "qty"),
      { ...col(t("rep.c.rate"), "money"), noTotal: true },
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.received"), "money"),
      col(t("rep.c.due"), "money"),
      col(t("rep.c.status")),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        d(r.doc.transactionDate),
        r.doc.number,
        r.party?.name ?? "",
        `${t(`sl.${r.doc.product}` as TKey)} · ${vName(r.variety, t)}`,
        q(r.doc.weight.netG),
        m(r.doc.ratePaisePerQtl),
        m(r.doc.saleStatus === "ORDER" ? 0n : BigInt(r.doc.totalPaise)),
        m(r.state.paidPaise),
        m(r.doc.saleStatus === "ORDER" || r.state.duePaise < 0n ? 0n : r.state.duePaise),
        r.doc.saleStatus === "ORDER" ? status(t, "ORDER") : status(t, displayStatus(r.state)),
      ]),
      t,
    );
  },
};

const customerLedger: ReportDef = {
  id: "customer-ledger",
  section: "sales",
  title: "rep.r.customer-ledger",
  period: "none",
  async build({ godownId, t }) {
    const rows = await customerSummaries(godownId);
    const columns = [
      col(t("rep.c.buyer")),
      col(t("rep.c.mobile")),
      col(t("rep.c.paddy"), "qty"),
      riceCol(t("rep.c.rice")),
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.receivable"), "money"),
      col(t("rep.c.advance"), "money"),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        r.party.name,
        r.party.phone ?? "",
        q(r.paddyG),
        q(r.riceG),
        m(r.amountPaise),
        m(r.balancePaise > 0n ? r.balancePaise : 0n),
        m(r.balancePaise < 0n ? -r.balancePaise : 0n),
      ]),
      t,
    );
  },
};

const deliveryStatus: ReportDef = {
  id: "delivery-status",
  section: "sales",
  title: "rep.r.delivery-status",
  period: "range",
  option: {
    kind: "select",
    label: "rep.o.delivery",
    values: [
      { value: "", label: "rep.o.all" },
      { value: "PENDING", label: "sl.delivery.PENDING" },
      { value: "LOADED", label: "sl.delivery.LOADED" },
      { value: "IN_TRANSIT", label: "sl.delivery.IN_TRANSIT" },
      { value: "DELIVERED", label: "sl.delivery.DELIVERED" },
    ],
  },
  async build({ godownId, from, to, t, opt }) {
    const rows = (
      await saleRows(godownId, {
        from,
        to,
        ...(opt ? { delivery: opt as "PENDING" | "LOADED" | "IN_TRANSIT" | "DELIVERED" } : {}),
      })
    )
      .filter((r) => r.doc.status === "active")
      .reverse();
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.number")),
      col(t("rep.c.buyer")),
      col(t("rep.c.qty"), "qty"),
      col(t("rep.c.vehicle")),
      col(t("rep.c.delivery")),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        d(r.doc.transactionDate),
        r.doc.number,
        r.party?.name ?? "",
        q(r.doc.weight.netG),
        r.doc.vehicleNumber ? displayVehicleNumber(r.doc.vehicleNumber) : "",
        t(`sl.delivery.${r.doc.deliveryStatus}` as TKey),
      ]),
      t,
    );
  },
};

// ── Expenses ─────────────────────────────────────────────────────────────────────────────────

async function cats(godownId: string) {
  return new Map(
    (await db().expenseCategories.where("godownId").equals(godownId).toArray()).map(
      (c) => [c.code, c] as const,
    ),
  );
}

const expenseDaily: ReportDef = {
  id: "expense-daily",
  section: "expenses",
  title: "rep.r.expense-daily",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = (await expenseRows(godownId, { from, to })).filter(
      (r) => r.doc.status === "active",
    );
    const c = await cats(godownId);
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.title")),
      col(t("rep.c.category")),
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.paid"), "money"),
      col(t("rep.c.due"), "money"),
    ];
    return withTotals(
      columns,
      [...rows]
        .sort((a, b) => (a.doc.expenseDate < b.doc.expenseDate ? -1 : 1))
        .map((r) => [
          d(r.doc.expenseDate),
          r.doc.title,
          catName(c.get(r.doc.categoryCode), t, r.doc.categoryCode),
          m(r.doc.amountPaise),
          m(r.state.paidPaise),
          m(r.state.duePaise > 0n ? r.state.duePaise : 0n),
        ]),
      t,
    );
  },
};

const expenseCategory: ReportDef = {
  id: "expense-category",
  section: "expenses",
  title: "rep.r.expense-category",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = (await expenseRows(godownId, { from, to })).filter(
      (r) => r.doc.status === "active",
    );
    const c = await cats(godownId);
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.doc.categoryCode, [...(by.get(r.doc.categoryCode) ?? []), r]);
    const columns = [
      col(t("rep.c.category")),
      col(t("rep.c.count"), "count"),
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.paid"), "money"),
      col(t("rep.c.due"), "money"),
    ];
    const out = [...by.entries()]
      .map(([code, rs]) => [
        catName(c.get(code), t, code),
        n(rs.length),
        m(rs.reduce((s, r) => s + BigInt(r.doc.amountPaise), 0n)),
        m(rs.reduce((s, r) => s + r.state.paidPaise, 0n)),
        m(rs.reduce((s, r) => s + (r.state.duePaise > 0n ? r.state.duePaise : 0n), 0n)),
      ])
      .sort((a, b) => ((a[2] as { m: bigint }).m > (b[2] as { m: bigint }).m ? -1 : 1));
    return withTotals(columns, out, t, {
      chart: {
        labels: out.map((r) => r[0] as string),
        series: [{ name: t("rep.c.amount"), values: out.map((r) => (r[2] as { m: bigint }).m) }],
      },
    });
  },
};

const expenseMonths: ReportDef = {
  id: "expense-months",
  section: "expenses",
  title: "rep.r.expense-months",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = (await expenseRows(godownId, { from, to })).filter(
      (r) => r.doc.status === "active",
    );
    const by = new Map<string, bigint>();
    for (const r of rows) {
      const k = r.doc.expenseDate.slice(0, 7);
      by.set(k, (by.get(k) ?? 0n) + BigInt(r.doc.amountPaise));
    }
    const keys = [...by.keys()].sort();
    const columns = [col(t("rep.c.month")), col(t("rep.c.amount"), "money")];
    return withTotals(
      columns,
      keys.map((k) => [k, m(by.get(k)!)]),
      t,
      {
        chart: {
          labels: keys,
          series: [{ name: t("rep.c.amount"), values: keys.map((k) => by.get(k)!) }],
        },
      },
    );
  },
};

const expenseUnpaid: ReportDef = {
  id: "expense-unpaid",
  section: "expenses",
  title: "rep.r.expense-unpaid",
  period: "none",
  async build({ godownId, t }) {
    const rows = await expenseRows(godownId, { status: "OPEN" });
    const c = await cats(godownId);
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.title")),
      col(t("rep.c.category")),
      col(t("rep.c.person")),
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.due"), "money"),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        d(r.doc.expenseDate),
        r.doc.title,
        catName(c.get(r.doc.categoryCode), t, r.doc.categoryCode),
        r.party?.name ?? r.doc.personText ?? "",
        m(r.doc.amountPaise),
        m(r.state.duePaise),
      ]),
      t,
    );
  },
};

// ── Load khata ───────────────────────────────────────────────────────────────────────────────

const loadRegister: ReportDef = {
  id: "load-register",
  section: "loads",
  title: "rep.r.load-register",
  period: "range",
  option: {
    kind: "select",
    label: "rep.o.groupBy",
    values: [
      { value: "date", label: "sections.loadsTabs.date" },
      { value: "party", label: "sections.loadsTabs.party" },
      { value: "mill", label: "sections.loadsTabs.mill" },
      { value: "vehicle", label: "sections.loadsTabs.vehicle" },
    ],
  },
  async build({ godownId, from, to, t, opt }) {
    const rows = (await loadRows(godownId, { from, to })).filter((r) => r.doc.status === "active");
    const by = (opt || "date") as LoadGroupBy;
    const groups = groupLoads(rows, by);
    const columns = [
      col(t("rep.c.group")),
      col(t("rep.c.date"), "date"),
      col(t("rep.c.vehicle")),
      col(t("rep.c.from")),
      col(t("rep.c.mill")),
      col(t("rep.c.variety")),
      col(t("rep.c.qty"), "qty"),
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.linked")),
    ];
    const out: CellValue[][] = [];
    for (const g of groups) {
      for (const r of [...g.rows].reverse()) {
        const label: CellValue =
          by === "date"
            ? d(g.key)
            : by === "party"
              ? (r.from?.name ?? "")
              : by === "mill"
                ? (r.mill?.name ?? "")
                : displayVehicleNumber(r.doc.vehicleNumber);
        out.push([
          label,
          d(r.doc.transactionDate),
          displayVehicleNumber(r.doc.vehicleNumber),
          r.from?.name ?? "",
          r.mill?.name ?? "",
          vName(r.variety, t),
          q(r.doc.weight.netG),
          m(r.doc.totalPaise),
          r.linked ? r.linked.number : t("ld.notLinked"),
        ]);
      }
    }
    return withTotals(columns, out, t);
  },
};

// ── Due & Advance ────────────────────────────────────────────────────────────────────────────

const dueAdvance: ReportDef = {
  id: "due-advance",
  section: "dues",
  title: "rep.r.due-advance",
  period: "none",
  async build({ godownId, t }) {
    const rows = await partyDues(godownId);
    const columns = [
      col(t("rep.c.party")),
      col(t("rep.c.category")),
      col(t("rep.c.mobile")),
      col(t("rep.c.opening"), "money"),
      col(t("rep.c.amount"), "money"),
      col(t("rep.c.paid"), "money"),
      col(t("rep.c.theyOwe"), "money"),
      col(t("rep.c.weOwe"), "money"),
      col(t("rep.c.dueDate"), "date"),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        r.party.name,
        t(`dues.cat.${r.category}` as TKey),
        r.party.phone ?? "",
        m(r.openingPaise),
        m(r.totalPaise),
        m(r.paidPaise),
        m(r.balancePaise > 0n ? r.balancePaise : 0n),
        m(r.balancePaise < 0n ? -r.balancePaise : 0n),
        r.earliestDue ? d(r.earliestDue) : null,
      ]),
      t,
    );
  },
};

const dueAging: ReportDef = {
  id: "due-aging",
  section: "dues",
  title: "rep.r.due-aging",
  period: "none",
  async build({ godownId, t }) {
    const rows = await partyDues(godownId);
    const today = todayIST();
    const columns = [
      col(t("rep.c.party")),
      col(t("rep.c.side")),
      col(t("dues.age.D0_30"), "money"),
      col(t("dues.age.D31_60"), "money"),
      col(t("dues.age.D61_90"), "money"),
      col(t("dues.age.D90_PLUS"), "money"),
    ];
    const out: CellValue[][] = [];
    for (const r of rows) {
      for (const side of ["IN", "OUT"] as const) {
        const open = r.open.filter((o) => o.state.bill.direction === side);
        if (!open.length) continue;
        const sum = (b: AgingBucket) =>
          open
            .filter((o) => agingBucketOf(o.state.bill.date, today) === b)
            .reduce((a, o) => a + o.state.duePaise, 0n);
        out.push([
          r.party.name,
          t(side === "IN" ? "dues.side.collect" : "dues.side.pay"),
          m(sum("D0_30")),
          m(sum("D31_60")),
          m(sum("D61_90")),
          m(sum("D90_PLUS")),
        ]);
      }
    }
    return withTotals(columns, out, t);
  },
};

const remindersReport: ReportDef = {
  id: "reminders",
  section: "dues",
  title: "rep.r.reminders",
  period: "none",
  async build({ godownId, t }) {
    const rows = (await reminderRows(godownId)).filter((r) => r.status !== "done");
    const columns = [
      col(t("rep.c.dueDate"), "date"),
      col(t("rep.c.party")),
      col(t("rep.c.kind")),
      col(t("rep.c.title")),
      col(t("rep.c.amount"), "money"),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        d(r.dueDate),
        r.party?.name ?? "",
        t(
          r.kind === "COLLECT"
            ? "dues.side.collect"
            : r.kind === "PAY"
              ? "dues.side.pay"
              : "rep.c.other",
        ),
        r.title || r.doc?.number || "",
        r.amountPaise !== undefined ? m(r.amountPaise) : null,
      ]),
      t,
    );
  },
};

const partyLedgerReport: ReportDef = {
  id: "party-ledger",
  section: "dues",
  title: "rep.r.party-ledger",
  period: "range",
  option: { kind: "party", label: "rep.o.party" },
  async build({ godownId, from, to, t, opt }) {
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.type")),
      col(t("rep.c.number")),
      col(t("rep.c.debit"), "money"),
      col(t("rep.c.credit"), "money"),
      col(t("rep.c.balance"), "money"),
    ];
    if (!opt) return { columns, rows: [], note: t("rep.pickParty") };
    const l = await partyLedger(godownId, opt, from, to);
    const rows: CellValue[][] = [
      [d(from), t("rep.c.opening"), "", null, null, m(l.opening)],
      ...l.rows.map((r) => [
        d(r.date),
        t(`voucherType.${r.doc.type}` as TKey),
        r.doc.number,
        m(r.debitPaise),
        m(r.creditPaise),
        m(r.balancePaise),
      ]),
    ];
    return {
      columns,
      rows,
      totals: [
        t("rep.c.closing"),
        "",
        "",
        m(l.rows.reduce((s, r) => s + r.debitPaise, 0n)),
        m(l.rows.reduce((s, r) => s + r.creditPaise, 0n)),
        m(l.closing),
      ],
      note: t("rep.balanceSign"),
    };
  },
};

// ── Vehicles ─────────────────────────────────────────────────────────────────────────────────

const vehicleIncome: ReportDef = {
  id: "vehicle-income",
  section: "vehicles",
  title: "rep.r.vehicle-income",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = (await tripRows(godownId, { from, to }))
      .filter((r) => r.doc.status === "active")
      .reverse();
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.number")),
      col(t("rep.c.vehicle")),
      col(t("rep.c.customer")),
      col(t("rep.c.route")),
      col(t("rep.c.income"), "money"),
      col(t("rep.c.received"), "money"),
      col(t("rep.c.due"), "money"),
      col(t("rep.c.costs"), "money"),
      col(t("rep.c.net"), "money"),
    ];
    const days = byDay(rows, (r) => r.doc.transactionDate);
    return withTotals(
      columns,
      rows.map((r) => [
        d(r.doc.transactionDate),
        r.doc.number,
        r.vehicle ? displayVehicleNumber(r.vehicle.number) : "",
        r.customer?.name ?? "",
        `${r.doc.loadingLocation} → ${r.doc.destination}`,
        m(r.doc.totalIncomePaise),
        m(r.income?.paidPaise ?? 0n),
        m(r.income && r.income.duePaise > 0n ? r.income.duePaise : 0n),
        m(r.costPaise),
        m(r.netPaise),
      ]),
      t,
      {
        chart: {
          labels: [...days.keys()],
          series: [
            {
              name: t("rep.c.income"),
              values: [...days.values()].map((rs) =>
                rs.reduce((s, r) => s + BigInt(r.doc.totalIncomePaise), 0n),
              ),
            },
          ],
        },
      },
    );
  },
};

const vehicleProfit: ReportDef = {
  id: "vehicle-profit",
  section: "vehicles",
  title: "rep.r.vehicle-profit",
  period: "range",
  option: {
    kind: "select",
    label: "rep.o.groupBy",
    values: [
      { value: "vehicle", label: "veh.vehicle" },
      { value: "month", label: "veh.byMonth" },
      { value: "day", label: "veh.byDay" },
    ],
  },
  async build({ godownId, from, to, t, opt }) {
    const columns = [
      col(opt === "vehicle" || !opt ? t("rep.c.vehicle") : t("rep.c.period")),
      col(t("rep.c.trips"), "count"),
      col(t("rep.c.income"), "money"),
      col(t("veh.cost.DRIVER"), "money"),
      col(t("veh.cost.DIESEL"), "money"),
      col(t("veh.cost.OTHER"), "money"),
      col(t("veh.linkedExpenses"), "money"),
      col(t("rep.c.net"), "money"),
    ];
    const line = (
      label: string,
      p: Awaited<ReturnType<typeof vehicleSummaries>>[number]["pnl"],
    ) => [
      label,
      n(p.trips),
      m(p.incomePaise),
      m(p.cost.DRIVER),
      m(p.cost.DIESEL),
      m(p.cost.OTHER),
      m(p.expensePaise),
      m(p.netPaise),
    ];
    const rows =
      opt === "month" || opt === "day"
        ? (await pnlByPeriod(godownId, opt, from, to)).reverse().map((r) => line(r.period, r.pnl))
        : (await vehicleSummaries(godownId, from, to)).map((r) =>
            line(displayVehicleNumber(r.vehicle.number), r.pnl),
          );
    return withTotals(columns, rows, t, {
      chart: {
        labels: rows.map((r) => r[0] as string),
        series: [{ name: t("rep.c.net"), values: rows.map((r) => (r[7] as { m: bigint }).m) }],
      },
    });
  },
};

// ── Mill & second party ──────────────────────────────────────────────────────────────────────

const millDispatch: ReportDef = {
  id: "mill-dispatch",
  section: "mill",
  title: "rep.r.mill-dispatch",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = (await dispatchRows(godownId))
      .filter(
        (r) => r.doc.status === "active" && r.doc.dispatchDate >= from && r.doc.dispatchDate <= to,
      )
      .reverse();
    // The mill pays us (v2.1): value (net of return credits and the final settlement),
    // collected, and what is still receivable (negative = to refund).
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.number")),
      col(t("rep.c.mill")),
      col(t("rep.c.variety")),
      col(t("mill.sent"), "qty"),
      col(t("mill.returned"), "qty"),
      col(t("mill.consumed"), "qty"),
      col(t("mill.accepted"), "qty"),
      col(t("mill.atMill"), "qty"),
      col(t("mill.value"), "money"),
      col(t("mill.collected"), "money"),
      col(t("mill.remaining"), "money"),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        d(r.doc.dispatchDate),
        r.doc.number,
        r.mill?.name ?? "",
        vName(r.variety, t),
        q(r.balance.sentG),
        q(r.balance.returnedPaddyG),
        q(r.balance.consumedG),
        q(r.balance.acceptedG),
        q(r.balance.remainingG),
        m(r.money.netValuePaise),
        m(r.money.collectedPaise),
        m(r.money.receivablePaise),
      ]),
      t,
    );
  },
};

const millReturn: ReportDef = {
  id: "mill-return",
  section: "mill",
  title: "rep.r.mill-return",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = (await returnRows(godownId))
      .filter(
        (r) => r.doc.status === "active" && r.doc.returnDate >= from && r.doc.returnDate <= to,
      )
      .reverse();
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.number")),
      col(t("rep.c.mill")),
      col(t("rep.c.dispatch")),
      col(t("rep.c.product")),
      col(t("rep.c.qty"), "qty"),
      // Paddy returns are a credit to the mill (its receivable goes down); rice / other: none.
      col(t("mill.creditValue"), "money"),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        d(r.doc.returnDate),
        r.doc.number,
        r.mill?.name ?? "",
        r.dispatch?.number ?? "",
        r.doc.product === "OTHER"
          ? (r.doc.otherProductName ?? "")
          : t(`mill.${r.doc.product}` as TKey),
        q(r.doc.weight.netG),
        m(r.creditPaise),
      ]),
      t,
    );
  },
};

const millStock: ReportDef = {
  id: "mill-stock",
  section: "mill",
  title: "rep.r.mill-stock",
  period: "range",
  async build({ godownId, from, to, t }) {
    const moves = await golaMoves(godownId);
    const mills = [
      ...new Set(moves.filter((x) => x.location === "MILL").map((x) => x.millPartyId ?? "")),
    ];
    const parties = new Map(
      (await db().parties.where("godownId").equals(godownId).toArray()).map(
        (p) => [p._id, p.name] as const,
      ),
    );
    const columns = [
      col(t("rep.c.mill")),
      col(t("stk.opening"), "qty"),
      col(t("stk.dispatched"), "qty"),
      col(t("stk.millReturned"), "qty"),
      col(t("stk.consumed"), "qty"),
      col(t("stk.settled"), "qty"),
      col(t("stk.closing"), "qty"),
    ];
    const rows = mills.map((id) => {
      const days = daysBetween(from, to, 400);
      let disp = 0n;
      let ret = 0n;
      let con = 0n;
      let set = 0n;
      for (const day of days) {
        const md = millDay(moves, day, id || undefined);
        disp += md.dispatchedG;
        ret += md.returnedG;
        con += md.consumedG;
        set += md.settledG;
      }
      return [
        parties.get(id) ?? "",
        q(millDay(moves, from, id || undefined).openingG),
        q(disp),
        q(ret),
        q(con),
        q(set),
        q(millDay(moves, to, id || undefined).closingG),
      ];
    });
    return withTotals(columns, rows, t);
  },
};

const millConversion: ReportDef = {
  id: "mill-conversion",
  section: "mill",
  title: "rep.r.mill-conversion",
  period: "range",
  rice: true,
  async build({ godownId, from, to, t }) {
    const rows = (await conversionRows(godownId))
      .filter(
        (r) =>
          r.doc.status === "active" && r.doc.conversionDate >= from && r.doc.conversionDate <= to,
      )
      .reverse();
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("rep.c.number")),
      col(t("rep.c.mill")),
      col(t("rep.c.variety")),
      col(t("mill.paddyConsumed"), "qty"),
      col(t("rep.c.outputs"), "qty"),
      col(t("mill.loss"), "qty"),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        d(r.doc.conversionDate),
        r.doc.number,
        r.mill?.name ?? "",
        vName(r.variety, t),
        q(r.doc.paddyConsumedG),
        q(r.doc.outputs.reduce((s, o) => s + BigInt(o.qtyG), 0n)),
        q(r.doc.lossG),
      ]),
      t,
    );
  },
};

const secondParty: ReportDef = {
  id: "second-party",
  section: "mill",
  title: "rep.r.second-party",
  period: "none",
  async build({ godownId, t }) {
    const rows = await secondPartySummaries(godownId);
    const columns = [
      col(t("rep.c.party")),
      col(t("rep.c.mobile")),
      col(t("mill.WE_OWE"), "money"),
      col(t("mill.THEY_OWE"), "money"),
      col(t("rep.c.weOwe"), "money"),
      col(t("rep.c.theyOwe"), "money"),
    ];
    return withTotals(
      columns,
      rows.map((r) => [
        r.party.name,
        r.party.phone ?? "",
        m(r.weOwePaise),
        m(r.theyOwePaise),
        m(r.balancePaise < 0n ? -r.balancePaise : 0n),
        m(r.balancePaise > 0n ? r.balancePaise : 0n),
      ]),
      t,
    );
  },
};

// ── Dashboard (business) ─────────────────────────────────────────────────────────────────────

const cashbookReport: ReportDef = {
  id: "cashbook",
  section: "dashboard",
  title: "rep.r.cashbook",
  period: "range",
  option: { kind: "bank", label: "rep.o.account" },
  async build({ godownId, from, to, t, opt }) {
    const account = opt ? `BANK:${opt}` : "CASH";
    const effects = (await golaDocs(godownId))
      .flatMap(cashEffects)
      .filter((e) => e.account === account);
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("cb.opening"), "money"),
      col(t("cb.received"), "money"),
      col(t("cb.paid"), "money"),
      col(t("cb.expenses"), "money"),
      col(t("rep.c.diff"), "money"),
      col(t("rep.c.closing"), "money"),
    ];
    const days = daysBetween(from, to, 400).map((day) =>
      cashbookDayFromEffects(effects, account, day),
    );
    const rows = days.map((x) => [
      d(x.date),
      m(x.openingPaise),
      m(x.receivedPaise + x.openingEntryPaise),
      m(x.paidPaise),
      m(x.expensesPaise),
      m(x.diffPaise),
      m(x.closingPaise),
    ]);
    const first = days[0];
    const last = days[days.length - 1];
    return {
      columns,
      rows,
      ...(first && last
        ? {
            totals: [
              t("rep.total"),
              m(first.openingPaise),
              m(days.reduce((s, x) => s + x.receivedPaise + x.openingEntryPaise, 0n)),
              m(days.reduce((s, x) => s + x.paidPaise, 0n)),
              m(days.reduce((s, x) => s + x.expensesPaise, 0n)),
              m(days.reduce((s, x) => s + x.diffPaise, 0n)),
              m(last.closingPaise),
            ],
          }
        : {}),
    };
  },
};

const dailyStock: ReportDef = {
  id: "daily-stock",
  section: "dashboard",
  title: "rep.r.daily-stock",
  period: "range",
  async build({ godownId, from, to, t }) {
    const moves = await golaMoves(godownId);
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("stk.opening"), "qty"),
      col(t("stk.purchase"), "qty"),
      col(t("stk.returned"), "qty"),
      col(t("stk.sales"), "qty"),
      col(t("stk.dispatch"), "qty"),
      col(t("stk.adjust"), "qty"),
      col(t("stk.expected"), "qty"),
    ];
    const days = daysBetween(from, to, 400).map((day) => ({ day, p: paddyDay(moves, day) }));
    const rows = days.map(({ day, p }) => [
      d(day),
      q(p.openingG),
      q(p.purchaseG),
      q(p.returnedFromMillG),
      q(p.salesG),
      q(p.dispatchG),
      q(p.adjustmentsG),
      q(p.closingG),
    ]);
    const tot = (k: keyof (typeof days)[number]["p"]) => q(days.reduce((s, x) => s + x.p[k], 0n));
    return {
      columns,
      rows,
      ...(days.length
        ? {
            totals: [
              t("rep.total"),
              q(days[0]!.p.openingG),
              tot("purchaseG"),
              tot("returnedFromMillG"),
              tot("salesG"),
              tot("dispatchG"),
              tot("adjustmentsG"),
              q(days[days.length - 1]!.p.closingG),
            ],
          }
        : {}),
    };
  },
};

const paddyStock: ReportDef = {
  id: "paddy-stock",
  section: "dashboard",
  title: "rep.r.paddy-stock",
  period: "date",
  async build({ godownId, to, t }) {
    const moves = await golaMoves(godownId);
    const varieties = await db().varieties.where("godownId").equals(godownId).toArray();
    const columns = [
      col(t("rep.c.variety")),
      col(t("rep.c.warehouse"), "qty"),
      col(t("rep.c.atMill"), "qty"),
      col(t("rep.c.value"), "money"),
    ];
    const rows = varieties
      .filter((v) => v.product === "PADDY")
      .map((v) => {
        const wh = qtyAt(moves, { product: "PADDY", location: "WAREHOUSE", varietyId: v._id }, to);
        const mill = qtyAt(moves, { product: "PADDY", location: "MILL", varietyId: v._id }, to);
        const val = valueAt(
          moves,
          { product: "PADDY", location: "WAREHOUSE", varietyId: v._id },
          to,
        );
        return { v, wh, mill, val };
      })
      .filter((r) => r.wh !== 0n || r.mill !== 0n)
      .map((r) => [vName(r.v, t), q(r.wh), q(r.mill), m(r.val)]);
    return withTotals(columns, rows, t);
  },
};

const riceStock: ReportDef = {
  id: "rice-stock",
  section: "dashboard",
  title: "rep.r.rice-stock",
  period: "range",
  rice: true,
  async build({ godownId, from, to, t }) {
    const moves = await golaMoves(godownId);
    const columns = [
      col(t("rep.c.product")),
      col(t("stk.opening"), "qty"),
      col(t("stk.riceReturned"), "qty"),
      col(t("stk.riceSales"), "qty"),
      col(t("stk.adjust"), "qty"),
      col(t("stk.closing"), "qty"),
    ];
    const others = [
      ...new Set(moves.filter((x) => x.product === "OTHER").map((x) => x.otherProductName ?? "")),
    ];
    const products: Array<{ label: string; p: "RICE" | "OTHER"; name?: string }> = [
      { label: t("sl.RICE"), p: "RICE" },
      ...others.map((o) => ({ label: o, p: "OTHER" as const, name: o })),
    ];
    const rows = products.map(({ label, p, name }) => {
      const days = daysBetween(from, to, 400).map((day) => productDay(moves, day, p, name));
      return [
        label,
        q(days[0]?.openingG ?? 0n),
        q(days.reduce((s, x) => s + x.returnedFromMillG, 0n)),
        q(days.reduce((s, x) => s + x.salesG, 0n)),
        q(days.reduce((s, x) => s + x.adjustmentsG, 0n)),
        q(days[days.length - 1]?.closingG ?? 0n),
      ];
    });
    return { columns, rows, note: t("mill.riceOnly") };
  },
};

const dailyOverview: ReportDef = {
  id: "daily-overview",
  section: "dashboard",
  title: "rep.r.daily-overview",
  period: "range",
  async build({ godownId, from, to, t }) {
    const rows = await dailyRows(godownId, from, to);
    const columns = [
      col(t("rep.c.date"), "date"),
      col(t("dly.received"), "money"),
      col(t("dly.paid"), "money"),
      col(t("dly.expenses"), "money"),
      col(t("dly.purchase"), "money"),
      col(t("dly.sales"), "money"),
      col(t("dly.stockIn"), "qty"),
      col(t("dly.stockOut"), "qty"),
      col(t("dly.closingCash"), "money"),
      col(t("dly.closingPaddy"), "qty"),
      riceCol(t("dly.closingRice")),
    ];
    const out = rows.map((r) => [
      d(r.date),
      m(r.receivedPaise),
      m(r.paidPaise),
      m(r.expensesPaise),
      m(r.purchasePaise),
      m(r.salesPaise),
      q(r.stockInG),
      q(r.stockOutG),
      m(r.closingCashPaise),
      q(r.closingPaddyG),
      q(r.closingRiceG),
    ]);
    const last = rows[rows.length - 1];
    const totals = out.length ? autoTotals(columns, out, t("rep.total")) : undefined;
    if (totals && last) {
      totals[8] = m(last.closingCashPaise);
      totals[9] = q(last.closingPaddyG);
      totals[10] = q(last.closingRiceG);
    }
    return { columns, rows: out, ...(totals ? { totals } : {}) };
  },
};

/**
 * Gross profit in a range = SALES + MILL_SALES − MILL_DEDUCTION − COGS (ledger lines, v2.1).
 * Paddy delivered to mills is income; a mill's final-settlement cut reduces it.
 */
async function grossProfit(godownId: string, from: string, to: string): Promise<bigint> {
  const credit = async (account: string) =>
    (
      await db()
        .ledgerLines.where("[godownId+account+date]")
        .between([godownId, account, from], [godownId, account, to], true, true)
        .toArray()
    ).reduce((s, l) => s + BigInt(l.creditPaise) - BigInt(l.debitPaise), 0n);
  // MILL_DEDUCTION is a debit (it reduces income), so its credit-minus-debit is negative.
  return (
    (await credit("SALES")) +
    (await credit("MILL_SALES")) +
    (await credit("MILL_DEDUCTION")) +
    (await credit("COGS"))
  );
}

function monthsOf(from: string, to: string): Array<{ key: string; from: string; to: string }> {
  const out: Array<{ key: string; from: string; to: string }> = [];
  let y = Number(from.slice(0, 4)); // float-ok: calendar year
  let mo = Number(from.slice(5, 7)); // float-ok: calendar month
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(mo).padStart(2, "0")}`;
    if (key > last || out.length >= 36) break;
    const ny = mo === 12 ? y + 1 : y;
    const nm = mo === 12 ? 1 : mo + 1;
    const end = addDays(`${ny}-${String(nm).padStart(2, "0")}-01`, -1);
    const start = `${key}-01`;
    out.push({ key, from: start < from ? from : start, to: end > to ? to : end });
    y = ny;
    mo = nm;
  }
  return out;
}
const monthlySummary: ReportDef = {
  id: "monthly-summary",
  section: "dashboard",
  title: "rep.r.monthly-summary",
  period: "range",
  async build({ godownId, from, to, t }) {
    const columns = [
      col(t("rep.c.month")),
      col(t("rep.c.purchase"), "money"),
      col(t("rep.c.sales"), "money"),
      col(t("rep.c.expenses"), "money"),
      col(t("rep.c.grossProfit"), "money"),
      col(t("rep.c.cashIn"), "money"),
      col(t("rep.c.cashOut"), "money"),
      col(t("rep.c.paddyEnd"), "qty"),
      riceCol(t("rep.c.riceEnd")),
    ];
    const rows: CellValue[][] = [];
    for (const mo of monthsOf(from, to)) {
      const o = await golaOverview(godownId, mo.from, mo.to);
      rows.push([
        mo.key,
        m(o.purchasePaise),
        m(o.salesPaise),
        m(o.expensesPaise),
        m(await grossProfit(godownId, mo.from, mo.to)),
        m(o.cashInPaise),
        m(o.cashOutPaise),
        q(o.paddyG),
        q(o.riceG),
      ]);
    }
    const totals = rows.length ? autoTotals(columns, rows, t("rep.total")) : undefined;
    if (totals && rows.length) {
      totals[7] = rows[rows.length - 1]![7]!;
      totals[8] = rows[rows.length - 1]![8]!;
    }
    return { columns, rows, ...(totals ? { totals } : {}), note: t("rep.grossNote") };
  },
};

function summaryRows(
  o: Awaited<ReturnType<typeof golaOverview>>,
  gross: bigint,
  t: T,
  rice = true,
): CellValue[][] {
  return [
    [t("rep.c.purchase"), m(o.purchasePaise), q(o.purchaseG)],
    [t("rep.c.sales"), m(o.salesPaise), q(o.salesG)],
    [t("rep.c.expenses"), m(o.expensesPaise), null],
    [t("rep.c.grossProfit"), m(gross), null],
    [t("rep.c.cashIn"), m(o.cashInPaise), null],
    [t("rep.c.cashOut"), m(o.cashOutPaise), null],
    [t("dsh.cash"), m(o.cashPaise), null],
    [t("dsh.bank"), m(o.bankPaise), null],
    [t("rep.c.paddyEnd"), null, q(o.paddyG)],
    ...(rice ? [[t("rep.c.riceEnd"), null, q(o.riceG)]] : []),
    [t("rep.c.atMill"), null, q(o.millPaddyG)],
    [t("rep.c.receivable"), m(o.receivablePaise), null],
    [t("rep.c.payable"), m(o.farmerPayablePaise), null],
    [t("dues.cat.mill"), m(o.millReceivablePaise), null],
    [t("mill.refundDue"), m(o.millRefundPaise), null],
    [t("rep.c.vehicleIncome"), m(o.vehicleIncomePaise), null],
  ];
}

const rangeSummary: ReportDef = {
  id: "range-summary",
  section: "dashboard",
  title: "rep.r.range-summary",
  period: "range",
  async build({ godownId, from, to, t, rice }) {
    const o = await golaOverview(godownId, from, to);
    return {
      columns: [col(t("rep.c.item")), col(t("rep.c.amount"), "money"), col(t("rep.c.qty"), "qty")],
      rows: summaryRows(o, await grossProfit(godownId, from, to), t, rice),
      note: t("rep.balanceNote"),
    };
  },
};

const golaWise: ReportDef = {
  id: "gola-wise",
  section: "dashboard",
  title: "rep.r.gola-wise",
  period: "range",
  business: true,
  async build({ godownIds, golaName, from, to, t }) {
    const columns = [
      col(t("rep.c.gola")),
      col(t("rep.c.purchase"), "money"),
      col(t("rep.c.sales"), "money"),
      col(t("rep.c.expenses"), "money"),
      col(t("rep.c.grossProfit"), "money"),
      col(t("dsh.cash"), "money"),
      col(t("dsh.bank"), "money"),
      col(t("rep.c.paddyEnd"), "qty"),
      riceCol(t("rep.c.riceEnd")),
      col(t("rep.c.receivable"), "money"),
      col(t("rep.c.payable"), "money"),
    ];
    const rows: CellValue[][] = [];
    for (const g of godownIds) {
      const o = await golaOverview(g, from, to);
      rows.push([
        golaName(g),
        m(o.purchasePaise),
        m(o.salesPaise),
        m(o.expensesPaise),
        m(await grossProfit(g, from, to)),
        m(o.cashPaise),
        m(o.bankPaise),
        q(o.paddyG),
        q(o.riceG),
        m(o.receivablePaise),
        m(o.farmerPayablePaise),
      ]);
    }
    return {
      columns,
      rows,
      totals: autoTotals(columns, rows, t("rep.combined")),
      note: t("rep.combinedNote"),
    };
  },
};

const combined: ReportDef = {
  id: "combined",
  section: "dashboard",
  title: "rep.r.combined",
  period: "range",
  business: true,
  async build({ godownIds, from, to, t, rice }) {
    const list = await Promise.all(godownIds.map((g) => golaOverview(g, from, to)));
    const gross = (await Promise.all(godownIds.map((g) => grossProfit(g, from, to)))).reduce(
      (s, x) => s + x,
      0n,
    );
    const { sumOverviews } = await import("../queries/consolidated/dashboard");
    return {
      columns: [col(t("rep.c.item")), col(t("rep.c.amount"), "money"), col(t("rep.c.qty"), "qty")],
      rows: summaryRows(sumOverviews(list), gross, t, rice),
      note: t("rep.combinedNote"),
    };
  },
};

export const REPORTS: readonly ReportDef[] = [
  purchaseDaily,
  purchaseRegister,
  farmerLedger,
  vehicleFareRegister,
  vehicleFareMonths,
  vehicleOwnersReport,
  salesDaily,
  salesRegister,
  customerLedger,
  deliveryStatus,
  expenseDaily,
  expenseCategory,
  expenseMonths,
  expenseUnpaid,
  loadRegister,
  dueAdvance,
  dueAging,
  remindersReport,
  partyLedgerReport,
  vehicleIncome,
  vehicleProfit,
  millDispatch,
  millReturn,
  millStock,
  millConversion,
  secondParty,
  rangeSummary,
  monthlySummary,
  golaWise,
  combined,
  dailyOverview,
  cashbookReport,
  dailyStock,
  paddyStock,
  riceStock,
];

/** A section's reports; `rice = false` leaves out the rice-only ones (business profile). */
export function reportsOf(section: ReportSection, rice = true): ReportDef[] {
  return REPORTS.filter((r) => r.section === section && (rice || !r.rice));
}

export function reportById(id: string): ReportDef | undefined {
  return REPORTS.find((r) => r.id === id);
}

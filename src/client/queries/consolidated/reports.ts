/**
 * Owner / consolidated reports (spec §9.14): godown comparison, variety × godown stock, cash &
 * bank per godown. Read-only; each godown is computed with its own per-godown queries and the
 * total is a plain sum (no elimination of inter-godown balances, [CONFIRM] #19).
 */
import { ACC } from "@/domain/posting/accounts";
import type { TKey } from "@/i18n/translate";
import { db } from "../../db/dexie";
import { pnlFigures, type ReportCtx } from "../../reports/defs";
import type { CellValue, ReportModel } from "../../reports/model";
import { sumCol } from "../../reports/model";
import { dashboardData } from "../dashboard";

/** account → balance as of `to` from the dailyAgg cache (same source as the dashboard). */
async function balancesAt(godownId: string, to: string): Promise<Map<string, bigint>> {
  const rows = await db()
    .dailyAgg.where("[godownId+date]")
    .between([godownId, ""], [godownId, to], true, true)
    .toArray();
  const m = new Map<string, bigint>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.accounts)) {
      m.set(k, (m.get(k) ?? 0n) + BigInt(v.dr) - BigInt(v.cr));
    }
  }
  return m;
}

function bankTotal(b: Map<string, bigint>): bigint {
  let s = 0n;
  for (const [k, v] of b) if (k.startsWith("BANK:")) s += v;
  return s;
}

/** Side by side per godown for the period, plus a total column. */
export async function godownComparison(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const metrics: Array<{ label: TKey; kind: "money" | "qty" }> = [
    { label: "reports.col.purchaseAmount", kind: "money" },
    { label: "reports.col.saleAmount", kind: "money" },
    { label: "reports.col.expenses", kind: "money" },
    { label: "reports.col.profit", kind: "money" },
    { label: "reports.col.cash", kind: "money" },
    { label: "reports.col.bank", kind: "money" },
    { label: "reports.col.stock", kind: "qty" },
    { label: "reports.col.receivable", kind: "money" },
    { label: "reports.col.payable", kind: "money" },
  ];
  const cols: bigint[][] = [];
  for (const g of c.godownIds) {
    const [pnl, end, bal] = await Promise.all([
      pnlFigures(g, c.from, c.to),
      dashboardData(g, c.to),
      balancesAt(g, c.to),
    ]);
    const vs = await db()
      .vouchers.where("[godownId+date]")
      .between([g, c.from], [g, c.to], true, true)
      .filter((v) => v.status === "active")
      .toArray();
    let purchase = 0n;
    let sale = 0n;
    let expense = 0n;
    for (const v of vs) {
      if (v.type === "PURCHASE") purchase += BigInt(v.totalPaise);
      else if (v.type === "SALE") sale += BigInt(v.totalPaise);
      else if (v.type === "EXPENSE") expense += BigInt(v.amountPaise);
      else if (v.type === "TRIP") for (const e of v.expenses) expense += BigInt(e.amountPaise);
    }
    cols.push([
      purchase,
      sale,
      expense,
      pnl.netProfit,
      bal.get(ACC.CASH) ?? 0n,
      bankTotal(bal),
      end.stockQtyG,
      end.receivablePaise,
      end.payablePaise,
    ]);
  }
  const rows: CellValue[][] = metrics.map((m, i) => {
    const vals = cols.map((col) => col[i]!);
    return [l.t(m.label), ...vals, vals.reduce((s, x) => s + x, 0n)];
  });
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.item"), kind: "text" },
          ...c.godownIds.map((g) => ({ label: l.godown(g), kind: "money" as const })),
          { label: l.t("reports.col.total"), kind: "money" },
        ],
        rows,
        rowKinds: metrics.map((m) => m.kind),
      },
    ],
  };
}

/** Variety × godown stock matrix as of `to` (varieties grouped by their shown name). */
export async function allGodownsStock(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const matrix = new Map<string, bigint[]>();
  for (let gi = 0; gi < c.godownIds.length; gi++) {
    const g = c.godownIds[gi]!;
    const [moves, varieties] = await Promise.all([
      db()
        .stockMoves.where("[godownId+date]")
        .between([g, ""], [g, c.to], true, true)
        .filter((m) => m.location === "STORE")
        .toArray(),
      db().varieties.where("godownId").equals(g).toArray(),
    ]);
    const name = new Map(
      varieties.map((v) => [
        v._id,
        v.systemKey && !v.renamed ? l.t(`variety.${v.systemKey}` as TKey) : v.name,
      ]),
    );
    for (const m of moves) {
      const key = name.get(m.varietyId) ?? m.varietyId;
      const row = matrix.get(key) ?? c.godownIds.map(() => 0n);
      row[gi] = row[gi]! + BigInt(m.qtyG);
      matrix.set(key, row);
    }
  }
  const rows: CellValue[][] = [...matrix]
    .filter(([, r]) => r.some((x) => x !== 0n))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, r]) => [k, ...r, r.reduce((s, x) => s + x, 0n)]);
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.variety"), kind: "text" },
          ...c.godownIds.map((g) => ({ label: l.godown(g), kind: "qty" as const })),
          { label: l.t("reports.col.total"), kind: "qty" },
        ],
        rows,
        totals: [
          l.t("reports.col.total"),
          ...c.godownIds.map((_, i) => sumCol(rows, i + 1)),
          sumCol(rows, c.godownIds.length + 1),
        ],
      },
    ],
  };
}

/** Cash and bank balances per godown as of `to`, plus a total row. */
export async function allGodownsCash(c: ReportCtx): Promise<ReportModel> {
  const l = c.labels;
  const rows: CellValue[][] = [];
  for (const g of c.godownIds) {
    const b = await balancesAt(g, c.to);
    const cash = b.get(ACC.CASH) ?? 0n;
    const bank = bankTotal(b);
    const cheques = b.get(ACC.CHEQUE_IN_HAND) ?? 0n;
    rows.push([l.godown(g), cash, bank, cheques, cash + bank + cheques]);
  }
  return {
    tables: [
      {
        columns: [
          { label: l.t("reports.col.godown"), kind: "text" },
          { label: l.t("reports.col.cash"), kind: "money" },
          { label: l.t("reports.col.bank"), kind: "money" },
          { label: l.t("reports.col.cheques"), kind: "money" },
          { label: l.t("reports.col.total"), kind: "money" },
        ],
        rows,
        totals: [l.t("reports.col.total"), ...[1, 2, 3, 4].map((i) => sumCol(rows, i))],
      },
    ],
  };
}

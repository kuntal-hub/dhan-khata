/**
 * Read-only "All godowns" views (spec §1.4 rule 4, §9.1, §9.15). The ONLY module that combines
 * godowns: it runs the per-godown query for each godown and adds a total. Totals are a plain sum of
 * the independent books (no elimination of inter-godown balances, which are shown separately,
 * [CONFIRM] #19). Never writes.
 */
import { ACC } from "@/domain/posting/accounts";
import { db } from "../../db/dexie";
import { dashboardData, type DashboardData } from "../dashboard";
import { accountBalance, godownReceivablePayable } from "../ledger";
import { partyBalances } from "../parties";
import { searchGodown, type SearchResults } from "../search";
import { stockByVariety } from "../stock";

export interface GodownTotals {
  godownId: string;
  cashPaise: bigint;
  receivablePaise: bigint;
  payablePaise: bigint;
  stockQtyG: bigint;
  stockValuePaise: bigint;
}

export interface ConsolidatedTotals {
  rows: GodownTotals[];
  total: Omit<GodownTotals, "godownId">;
}

export async function godownTotals(godownId: string): Promise<GodownTotals> {
  const [cashPaise, rp, stock] = await Promise.all([
    accountBalance(godownId, ACC.CASH),
    godownReceivablePayable(godownId),
    stockByVariety(godownId),
  ]);
  let stockQtyG = 0n;
  let stockValuePaise = 0n;
  for (const s of stock) {
    stockQtyG += s.qtyG;
    stockValuePaise += s.valuePaise;
  }
  return {
    godownId,
    cashPaise,
    receivablePaise: rp.receivable,
    payablePaise: rp.payable,
    stockQtyG,
    stockValuePaise,
  };
}

export async function allGodownsTotals(godownIds: readonly string[]): Promise<ConsolidatedTotals> {
  const rows: GodownTotals[] = [];
  for (const g of godownIds) rows.push(await godownTotals(g));
  const total = {
    cashPaise: 0n,
    receivablePaise: 0n,
    payablePaise: 0n,
    stockQtyG: 0n,
    stockValuePaise: 0n,
  };
  for (const r of rows) {
    total.cashPaise += r.cashPaise;
    total.receivablePaise += r.receivablePaise;
    total.payablePaise += r.payablePaise;
    total.stockQtyG += r.stockQtyG;
    total.stockValuePaise += r.stockValuePaise;
  }
  return { rows, total };
}

// ── Dashboard "সব গোডাউন" table ──────────────────────────────────────────────

/** The figures the All-godowns table shows per godown (a subset of the dashboard cards). */
export interface DashboardColumn {
  godownId: string;
  cashPaise: bigint;
  stockQtyG: bigint;
  purchaseQtyG: bigint;
  purchaseAmountPaise: bigint;
  saleQtyG: bigint;
  saleAmountPaise: bigint;
  expensePaise: bigint;
  receivablePaise: bigint;
  payablePaise: bigint;
  /**
   * Net balance with the OTHER godowns' parties (role "godown") in this godown's books:
   * > 0 the other godowns owe this one.
   */
  interGodownPaise: bigint;
}

export interface ConsolidatedDashboard {
  columns: DashboardColumn[];
  total: Omit<DashboardColumn, "godownId">;
}

const SUM_KEYS = [
  "cashPaise",
  "stockQtyG",
  "purchaseQtyG",
  "purchaseAmountPaise",
  "saleQtyG",
  "saleAmountPaise",
  "expensePaise",
  "receivablePaise",
  "payablePaise",
  "interGodownPaise",
] as const;

async function interGodownBalance(godownId: string): Promise<bigint> {
  const [parties, balances] = await Promise.all([
    db().parties.where("godownId").equals(godownId).toArray(),
    partyBalances(godownId),
  ]);
  let net = 0n;
  for (const p of parties) if (p.roles.includes("godown")) net += balances.get(p._id) ?? 0n;
  return net;
}

export function columnOf(d: DashboardData, godownId: string, inter: bigint): DashboardColumn {
  return {
    godownId,
    cashPaise: d.expectedClosingCashPaise,
    stockQtyG: d.stockQtyG,
    purchaseQtyG: d.purchaseQtyG,
    purchaseAmountPaise: d.purchaseAmountPaise,
    saleQtyG: d.saleQtyG,
    saleAmountPaise: d.saleAmountPaise,
    expensePaise: d.expensePaise,
    receivablePaise: d.receivablePaise,
    payablePaise: d.payablePaise,
    interGodownPaise: inter,
  };
}

export async function consolidatedDashboard(
  godownIds: readonly string[],
  date: string,
): Promise<ConsolidatedDashboard> {
  const columns: DashboardColumn[] = [];
  for (const g of godownIds) {
    const [d, inter] = await Promise.all([dashboardData(g, date), interGodownBalance(g)]);
    columns.push(columnOf(d, g, inter));
  }
  const total = Object.fromEntries(SUM_KEYS.map((k) => [k, 0n])) as Omit<
    DashboardColumn,
    "godownId"
  >;
  for (const c of columns) for (const k of SUM_KEYS) total[k] += c[k];
  return { columns, total };
}

// ── Search all godowns (owner) ───────────────────────────────────────────────

export async function searchAllGodowns(
  godownIds: readonly string[],
  query: string,
): Promise<Array<{ godownId: string; results: SearchResults }>> {
  const out: Array<{ godownId: string; results: SearchResults }> = [];
  for (const g of godownIds) {
    const results = await searchGodown(g, query, 15);
    if (results.parties.length + results.vehicles.length + results.vouchers.length > 0) {
      out.push({ godownId: g, results });
    }
  }
  return out;
}

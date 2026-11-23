/**
 * Read-only "All godowns" views (spec §1.4 rule 4). The ONLY module that combines godowns:
 * it runs the per-godown query for each godown and adds a total row. Never writes.
 */
import { ACC } from "@/domain/posting/accounts";
import { accountBalance, godownReceivablePayable } from "../ledger";
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

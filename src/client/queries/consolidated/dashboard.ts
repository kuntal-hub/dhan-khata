/**
 * "সব গোলা একসাথে" dashboard (requirement_v2 §2.3, §12.1): the per-Gola overview of every Gola
 * plus their sum. Read-only; each Gola is computed from its own books only.
 */
import {
  dailyRows,
  dueAlerts,
  emptyOverview,
  golaMoves,
  golaOverview,
  lowStockAlerts,
  recentEntries,
  type DailyRow,
  type DueAlert,
  type FlowSummary,
  type LowStockAlert,
  type OverviewData,
  type RecentItem,
} from "../dashboard";

const sumFlow = (a: FlowSummary, b: FlowSummary): FlowSummary => ({
  openingPaise: a.openingPaise + b.openingPaise,
  receivedPaise: a.receivedPaise + b.receivedPaise,
  paidPaise: a.paidPaise + b.paidPaise,
  expensesPaise: a.expensesPaise + b.expensesPaise,
  otherPaise: a.otherPaise + b.otherPaise,
  closingPaise: a.closingPaise + b.closingPaise,
});

const SUM_KEYS = [
  "purchasePaise",
  "purchaseG",
  "salesPaise",
  "salesG",
  "expensesPaise",
  "vehicleCostPaise",
  "cashPaise",
  "bankPaise",
  "paddyG",
  "riceG",
  "millPaddyG",
  "receivablePaise",
  "farmerPayablePaise",
  "millPayablePaise",
  "vehicleIncomePaise",
  "cashInPaise",
  "cashOutPaise",
] as const;

export function sumOverviews(list: readonly OverviewData[]): OverviewData {
  const out = emptyOverview();
  for (const o of list) {
    for (const k of SUM_KEYS) out[k] += o[k];
    out.banks.push(...o.banks);
    out.mills.push(...o.mills);
    out.paddyByVariety.push(...o.paddyByVariety);
    out.cashflow = {
      cash: sumFlow(out.cashflow.cash, o.cashflow.cash),
      bank: sumFlow(out.cashflow.bank, o.cashflow.bank),
    };
  }
  const series = new Map<string, { purchasePaise: bigint; salesPaise: bigint }>();
  for (const o of list) {
    for (const s of o.series) {
      const e = series.get(s.date) ?? { purchasePaise: 0n, salesPaise: 0n };
      e.purchasePaise += s.purchasePaise;
      e.salesPaise += s.salesPaise;
      series.set(s.date, e);
    }
  }
  out.series = [...series.entries()].map(([date, v]) => ({ date, ...v }));
  return out;
}

export async function overviewFor(
  godownIds: readonly string[],
  from: string,
  to: string,
): Promise<{ perGola: Array<{ godownId: string; data: OverviewData }>; total: OverviewData }> {
  const perGola = await Promise.all(
    godownIds.map(async (godownId) => ({ godownId, data: await golaOverview(godownId, from, to) })),
  );
  return {
    perGola,
    total: perGola.length === 1 ? perGola[0]!.data : sumOverviews(perGola.map((p) => p.data)),
  };
}

export async function recentFor(godownIds: readonly string[], n = 10): Promise<RecentItem[]> {
  const all = (await Promise.all(godownIds.map((g) => recentEntries(g, n)))).flat();
  return all.sort((a, b) => (a.doc.createdAt < b.doc.createdAt ? 1 : -1)).slice(0, n);
}

export async function alertsFor(
  godownIds: readonly string[],
): Promise<{ dues: DueAlert[]; lowStock: LowStockAlert[] }> {
  const [dues, low] = await Promise.all([
    Promise.all(godownIds.map((g) => dueAlerts(g))),
    Promise.all(godownIds.map((g) => lowStockAlerts(g))),
  ]);
  return {
    dues: dues.flat().sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0)),
    lowStock: low.flat(),
  };
}

/** Daily overview rows summed over Golas (closings are sums of each Gola's closing). */
export async function dailyRowsFor(
  godownIds: readonly string[],
  from: string,
  to: string,
): Promise<DailyRow[]> {
  const lists = await Promise.all(godownIds.map((g) => dailyRows(g, from, to)));
  if (lists.length === 1) return lists[0]!;
  return lists[0]!.map((r, i) => {
    const out = { ...r };
    for (const l of lists.slice(1)) {
      const x = l[i]!;
      for (const k of Object.keys(out) as Array<keyof DailyRow>) {
        if (k === "date") continue;
        (out[k] as bigint) += x[k] as bigint;
      }
    }
    return out;
  });
}

/** Stock moves of the given Golas (each Gola's own moves, side by side; read-only). */
export async function movesFor(godownIds: readonly string[]) {
  return (await Promise.all(godownIds.map((g) => golaMoves(g)))).flat();
}

/**
 * `dailyAgg`: per (Gola, day) sums of ledger lines by account and stock moves by position
 * (`stockKeyId`: product|location|variety|other|mill|transit group). Maintained incrementally by the write path (delta of old → new derived rows)
 * and rebuildable from scratch at any time (`rebuildDailyAgg`).
 */
import type { LedgerLine, StockMove } from "@/domain/schemas";
import { moveKey } from "@/domain/v2/derive";
import { stockKeyId } from "@/domain/v2/post";
import { db, type DailyAggRow } from "../db/dexie";

type Acc = Map<string, { dr: bigint; cr: bigint }>;
type Stk = Map<string, { qtyG: bigint; valuePaise: bigint }>;

interface DayDelta {
  godownId: string;
  date: string;
  accounts: Acc;
  stock: Stk;
}

function dayKey(godownId: string, date: string) {
  return `${godownId}\u0000${date}`;
}

export function stockAggKey(m: StockMove): string {
  return stockKeyId(moveKey(m));
}

function collect(
  out: Map<string, DayDelta>,
  lines: readonly LedgerLine[],
  moves: readonly StockMove[],
  sign: 1n | -1n,
) {
  const get = (godownId: string, date: string) => {
    const k = dayKey(godownId, date);
    let d = out.get(k);
    if (!d) {
      d = { godownId, date, accounts: new Map(), stock: new Map() };
      out.set(k, d);
    }
    return d;
  };
  for (const l of lines) {
    const d = get(l.godownId, l.date);
    const a = d.accounts.get(l.account) ?? { dr: 0n, cr: 0n };
    a.dr += sign * BigInt(l.debitPaise);
    a.cr += sign * BigInt(l.creditPaise);
    d.accounts.set(l.account, a);
  }
  for (const m of moves) {
    const d = get(m.godownId, m.date);
    const k = stockAggKey(m);
    const s = d.stock.get(k) ?? { qtyG: 0n, valuePaise: 0n };
    s.qtyG += sign * BigInt(m.qtyG);
    s.valuePaise += sign * BigInt(m.valuePaise);
    d.stock.set(k, s);
  }
}

function isEmpty(row: DailyAggRow): boolean {
  return Object.keys(row.accounts).length === 0 && Object.keys(row.stock).length === 0;
}

/** Apply (after − before) to the stored daily aggregates. Call inside a write transaction. */
export async function applyAggDelta(
  before: { lines: readonly LedgerLine[]; moves: readonly StockMove[] },
  after: { lines: readonly LedgerLine[]; moves: readonly StockMove[] },
): Promise<void> {
  const deltas = new Map<string, DayDelta>();
  collect(deltas, before.lines, before.moves, -1n);
  collect(deltas, after.lines, after.moves, 1n);
  const d = db();
  for (const delta of deltas.values()) {
    const row: DailyAggRow = (await d.dailyAgg.get([delta.godownId, delta.date])) ?? {
      godownId: delta.godownId,
      date: delta.date,
      accounts: {},
      stock: {},
    };
    for (const [acc, v] of delta.accounts) {
      const cur = row.accounts[acc];
      const dr = BigInt(cur?.dr ?? "0") + v.dr;
      const cr = BigInt(cur?.cr ?? "0") + v.cr;
      if (dr === 0n && cr === 0n) delete row.accounts[acc];
      else row.accounts[acc] = { dr: dr.toString(), cr: cr.toString() };
    }
    for (const [k, v] of delta.stock) {
      const cur = row.stock[k];
      const q = BigInt(cur?.qtyG ?? "0") + v.qtyG;
      const val = BigInt(cur?.valuePaise ?? "0") + v.valuePaise;
      if (q === 0n && val === 0n) delete row.stock[k];
      else row.stock[k] = { qtyG: q.toString(), valuePaise: val.toString() };
    }
    if (isEmpty(row)) await d.dailyAgg.delete([delta.godownId, delta.date]);
    else await d.dailyAgg.put(row);
  }
}

/** Rebuild one godown's daily aggregates from scratch (ledger lines + stock moves). */
export async function rebuildDailyAgg(godownId: string): Promise<number> {
  const d = db();
  return d.transaction("rw", [d.dailyAgg, d.ledgerLines, d.stockMoves], async () => {
    const lines = await d.ledgerLines
      .where("[godownId+date]")
      .between([godownId, ""], [godownId, "￿"])
      .toArray();
    const moves = await d.stockMoves
      .where("[godownId+date]")
      .between([godownId, ""], [godownId, "￿"])
      .toArray();
    const existing = await d.dailyAgg
      .where("[godownId+date]")
      .between([godownId, ""], [godownId, "￿"])
      .primaryKeys();
    await d.dailyAgg.bulkDelete(existing);
    await applyAggDelta({ lines: [], moves: [] }, { lines, moves });
    return d.dailyAgg.where("[godownId+date]").between([godownId, ""], [godownId, "￿"]).count();
  });
}

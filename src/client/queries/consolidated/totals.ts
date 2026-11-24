/**
 * Read-only "সব গোলা একসাথে / All Golas combined" totals (requirement_v2 §2.3). The ONLY place
 * that reads several Golas at once; it shows each Gola side by side plus their sum and never
 * writes. Balances are at the end of `upTo` (inclusive; all dates when omitted).
 */
import { db } from "../../db/dexie";

export interface GolaTotals {
  godownId: string;
  cashPaise: bigint;
  bankPaise: bigint;
  /** Σ positive party balances (they owe us). */
  receivablePaise: bigint;
  /** Σ negative party balances, as a positive number (we owe them). */
  payablePaise: bigint;
  /** Warehouse paddy (g). */
  paddyG: bigint;
  /** Paddy at mills (g). */
  millPaddyG: bigint;
  /** Rice in the warehouse (g). */
  riceG: bigint;
}

export async function golaTotals(godownId: string, upTo?: string): Promise<GolaTotals> {
  const hi = upTo ?? "￿";
  const lines = await db()
    .ledgerLines.where("[godownId+date]")
    .between([godownId, ""], [godownId, hi], true, true)
    .toArray();
  const party = new Map<string, bigint>();
  let cash = 0n;
  let bank = 0n;
  for (const l of lines) {
    const v = BigInt(l.debitPaise) - BigInt(l.creditPaise);
    if (l.account === "CASH") cash += v;
    else if (l.account.startsWith("BANK:")) bank += v;
    else if (l.account.startsWith("PARTY:")) party.set(l.account, (party.get(l.account) ?? 0n) + v);
  }
  let receivable = 0n;
  let payable = 0n;
  for (const v of party.values()) {
    if (v > 0n) receivable += v;
    else payable -= v;
  }
  const moves = await db()
    .stockMoves.where("[godownId+date]")
    .between([godownId, ""], [godownId, hi], true, true)
    .toArray();
  let paddy = 0n;
  let mill = 0n;
  let rice = 0n;
  for (const m of moves) {
    const q = BigInt(m.qtyG);
    if (m.product === "PADDY" && m.location === "WAREHOUSE") paddy += q;
    else if (m.product === "PADDY" && m.location === "MILL") mill += q;
    else if (m.product === "RICE") rice += q;
  }
  return {
    godownId,
    cashPaise: cash,
    bankPaise: bank,
    receivablePaise: receivable,
    payablePaise: payable,
    paddyG: paddy,
    millPaddyG: mill,
    riceG: rice,
  };
}

/** Each Gola plus the sum (side by side, read-only). */
export async function combinedTotals(
  godownIds: readonly string[],
  upTo?: string,
): Promise<{ perGola: GolaTotals[]; total: Omit<GolaTotals, "godownId"> }> {
  const perGola = await Promise.all(godownIds.map((g) => golaTotals(g, upTo)));
  const keys = [
    "cashPaise",
    "bankPaise",
    "receivablePaise",
    "payablePaise",
    "paddyG",
    "millPaddyG",
    "riceG",
  ] as const;
  const total = Object.fromEntries(
    keys.map((k) => [k, perGola.reduce((s, x) => s + x[k], 0n)]),
  ) as Omit<GolaTotals, "godownId">;
  return { perGola, total };
}

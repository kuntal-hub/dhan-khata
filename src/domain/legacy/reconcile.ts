/**
 * Migration reconciliation (v1 → v2): every party balance, cash, each bank and paddy stock per
 * variety/location must be identical before (v1 stored ledger lines / stock moves) and after
 * (v2 documents re-posted from scratch). The only allowed difference is the one v2 changes on
 * purpose (listed in docs/MIGRATION_V2.md):
 *   - a cheque still in hand in v1 (CHEQUE_IN_HAND) counts as received into the bank in v2.
 */
import { qtyAt, valueAt } from "../v2/stock";
import { deriveAll } from "../v2/replay";
import type { Doc } from "../v2/schemas";
import type { MigrationNote } from "./migrateV1";

export interface V1LineLike {
  godownId: string;
  account: string;
  debitPaise: string | bigint | number;
  creditPaise: string | bigint | number;
}

export interface V1MoveLike {
  godownId: string;
  varietyId: string;
  location: string;
  qtyG: string | bigint | number;
  valuePaise: string | bigint | number;
}

export interface ReconDiff {
  godownId: string;
  what: string;
  beforePaiseOrG: string;
  afterPaiseOrG: string;
  allowed: boolean;
  reason?: string;
}

export interface ReconReport {
  ok: boolean;
  checked: number;
  diffs: ReconDiff[];
}

const big = (v: string | bigint | number) => BigInt(v);

function balances(lines: readonly V1LineLike[]): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const l of lines) {
    const k = `${l.godownId}#${l.account}`;
    m.set(k, (m.get(k) ?? 0n) + big(l.debitPaise) - big(l.creditPaise));
  }
  return m;
}

const tracked = (account: string) =>
  account === "CASH" || account.startsWith("BANK:") || account.startsWith("PARTY:");

export function reconcile(
  v1Lines: readonly V1LineLike[],
  v1Moves: readonly V1MoveLike[],
  v2Docs: readonly Doc[],
  notes: readonly MigrationNote[],
): ReconReport {
  const after = deriveAll(v2Docs);
  const before = balances(v1Lines);
  const now = balances(after.lines);

  // Pending cheques: v1 CHEQUE_IN_HAND → v2 bank (per Gola + bank).
  const chequeToBank = new Map<string, bigint>();
  for (const n of notes) {
    if (n.kind !== "CHEQUE_IN_HAND_TO_BANK" || !n.amountPaise) continue;
    const k = `${n.godownId}#${n.bankAccountId ? `BANK:${n.bankAccountId}` : "CASH"}`;
    chequeToBank.set(k, (chequeToBank.get(k) ?? 0n) + BigInt(n.amountPaise));
  }

  const diffs: ReconDiff[] = [];
  let checked = 0;
  const keys = new Set([...before.keys(), ...now.keys()]);
  for (const k of [...keys].sort()) {
    const [godownId, account] = k.split("#") as [string, string];
    if (!tracked(account)) continue;
    checked++;
    const b = before.get(k) ?? 0n;
    const a = now.get(k) ?? 0n;
    if (a === b) continue;
    const expectedShift = chequeToBank.get(k) ?? 0n;
    const allowed = expectedShift !== 0n && a - b === expectedShift;
    diffs.push({
      godownId,
      what: account,
      beforePaiseOrG: b.toString(),
      afterPaiseOrG: a.toString(),
      allowed,
      ...(allowed ? { reason: "CHEQUE_IN_HAND_TO_BANK" } : {}),
    });
  }
  // v1 cheques in hand disappear (they moved to the bank above).
  for (const [k, v] of before) {
    const [godownId, account] = k.split("#") as [string, string];
    if (account !== "CHEQUE_IN_HAND" || v === 0n) continue;
    const moved = [...chequeToBank]
      .filter(([x]) => x.startsWith(`${godownId}#`))
      .reduce((s, [, n]) => s + n, 0n);
    diffs.push({
      godownId,
      what: "CHEQUE_IN_HAND",
      beforePaiseOrG: v.toString(),
      afterPaiseOrG: "0",
      allowed: moved === v,
      ...(moved === v ? { reason: "CHEQUE_IN_HAND_TO_BANK" } : {}),
    });
  }

  // Paddy stock per Gola, variety and location (v1 STORE = v2 WAREHOUSE).
  const stockKeys = new Set<string>();
  for (const m of v1Moves)
    stockKeys.add(
      `${m.godownId}#${m.varietyId}#${m.location === "STORE" ? "WAREHOUSE" : m.location}`,
    );
  for (const m of after.moves)
    if (m.product === "PADDY" && m.varietyId)
      stockKeys.add(`${m.godownId}#${m.varietyId}#${m.location}`);
  for (const k of [...stockKeys].sort()) {
    const [godownId, varietyId, location] = k.split("#") as [string, string, string];
    checked++;
    const v1 = v1Moves.filter(
      (m) =>
        m.godownId === godownId &&
        m.varietyId === varietyId &&
        (m.location === "STORE" ? "WAREHOUSE" : m.location) === location,
    );
    const bq = v1.reduce((s, m) => s + big(m.qtyG), 0n);
    const bv = v1.reduce((s, m) => s + big(m.valuePaise), 0n);
    const mine = after.moves.filter((m) => m.godownId === godownId);
    const f = {
      product: "PADDY" as const,
      varietyId,
      location: location as "WAREHOUSE" | "TRANSIT" | "MILL",
    };
    const aq = qtyAt(mine, f);
    const av = valueAt(mine, f);
    if (aq !== bq) {
      diffs.push({
        godownId,
        what: `STOCK_QTY:${varietyId}:${location}`,
        beforePaiseOrG: bq.toString(),
        afterPaiseOrG: aq.toString(),
        allowed: false,
      });
    }
    if (av !== bv) {
      diffs.push({
        godownId,
        what: `STOCK_VALUE:${varietyId}:${location}`,
        beforePaiseOrG: bv.toString(),
        afterPaiseOrG: av.toString(),
        allowed: false,
      });
    }
  }
  return { ok: diffs.every((d) => d.allowed), checked, diffs };
}

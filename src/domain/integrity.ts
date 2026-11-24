/**
 * Integrity checks (spec §6.6), pure and shared by the device and the server:
 *  1. trial balance (Σ debits == Σ credits, to the paisa);
 *  2. every voucher re-posted (in canonical order) must give exactly its stored lines;
 *  3. per-account totals compared between the device and the server.
 */
import { replayDocs } from "./v2/replay";
import type { Doc, LedgerLineV2 as LedgerLine } from "./v2/schemas";

export interface LineLike {
  account: string;
  debitPaise: string | bigint;
  creditPaise: string | bigint;
  voucherId?: string;
}

const big = (v: string | bigint) => (typeof v === "bigint" ? v : BigInt(v));

export interface TrialResult {
  debitPaise: bigint;
  creditPaise: bigint;
  balanced: boolean;
}

export function trialOf(lines: Iterable<LineLike>): TrialResult {
  let dr = 0n;
  let cr = 0n;
  for (const l of lines) {
    dr += big(l.debitPaise);
    cr += big(l.creditPaise);
  }
  return { debitPaise: dr, creditPaise: cr, balanced: dr === cr };
}

/** account → Σdebit − Σcredit (as decimal strings, for transport). */
export function accountTotals(lines: Iterable<LineLike>): Record<string, string> {
  const m = new Map<string, bigint>();
  for (const l of lines) {
    m.set(l.account, (m.get(l.account) ?? 0n) + big(l.debitPaise) - big(l.creditPaise));
  }
  const out: Record<string, string> = {};
  for (const [k, v] of [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (v !== 0n) out[k] = v.toString();
  }
  return out;
}

export interface AccountDiff {
  account: string;
  devicePaise: bigint;
  serverPaise: bigint;
}

/** Accounts whose totals differ between two sides (missing = 0). */
export function diffAccountTotals(
  device: Record<string, string>,
  server: Record<string, string>,
): AccountDiff[] {
  const keys = [...new Set([...Object.keys(device), ...Object.keys(server)])].sort();
  const out: AccountDiff[] = [];
  for (const k of keys) {
    const d = BigInt(device[k] ?? "0");
    const s = BigInt(server[k] ?? "0");
    if (d !== s) out.push({ account: k, devicePaise: d, serverPaise: s });
  }
  return out;
}

function canon(lines: Iterable<{ account: string; debit: bigint; credit: bigint }>): string {
  return [...lines]
    .map((l) => `${l.account}|${l.debit}|${l.credit}`)
    .sort()
    .join(";");
}

/**
 * Re-post every voucher of ONE godown (canonical order, positions from the replay itself) and
 * return the ids whose stored lines differ from the re-posting.
 */
export function repostMismatches(
  vouchers: readonly Doc[],
  stored: readonly Pick<LedgerLine, "voucherId" | "account" | "debitPaise" | "creditPaise">[],
): string[] {
  const byVoucher = new Map<string, Array<{ account: string; debit: bigint; credit: bigint }>>();
  for (const l of stored) {
    const list = byVoucher.get(l.voucherId) ?? [];
    list.push({ account: l.account, debit: BigInt(l.debitPaise), credit: BigInt(l.creditPaise) });
    byVoucher.set(l.voucherId, list);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of replayDocs(vouchers).results) {
    seen.add(r.doc._id);
    if (canon(r.lines) !== canon(byVoucher.get(r.doc._id) ?? [])) out.push(r.doc._id);
  }
  // Stored lines of vouchers that no longer exist are mismatches too.
  for (const id of byVoucher.keys()) if (!seen.has(id)) out.push(id);
  return out;
}

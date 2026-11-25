/**
 * Integrity checks (spec §6.6), pure and shared by the device and the server:
 *  1. trial balance (Σ debits == Σ credits, to the paisa);
 *  2. every voucher re-posted (in canonical order) must give exactly its stored lines;
 *  3. per-account totals compared between the device and the server.
 */
import { replayDocs } from "./v2/replay";
import { stockKeyId } from "./v2/post";
import type { Doc, LedgerLineV2 as LedgerLine, StockMoveV2 } from "./v2/schemas";

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

export interface NegativePosition {
  /** `stockKeyId` of the position (product | location | variety | other | mill | group). */
  key: string;
  product: StockMoveV2["product"];
  location: StockMoveV2["location"];
  varietyId?: string;
  millPartyId?: string;
  otherProductName?: string;
  /** The lowest running quantity (g, < 0) and the first date it was reached. */
  minG: bigint;
  onDate: string;
  /** Quantity now (all dates). */
  nowG: bigint;
}

/**
 * Stock positions that went below zero on some date (§9.3: never silent; offline entries on two
 * devices can do this). Running sum per position in date order (same-day moves summed first).
 */
export function negativePositions(moves: readonly StockMoveV2[]): NegativePosition[] {
  const byKey = new Map<string, StockMoveV2[]>();
  for (const m of moves) {
    const k = stockKeyId({
      product: m.product,
      location: m.location,
      ...(m.varietyId ? { varietyId: m.varietyId } : {}),
      ...(m.otherProductName ? { otherProductName: m.otherProductName } : {}),
      ...(m.millPartyId ? { millPartyId: m.millPartyId } : {}),
      ...(m.groupId ? { groupId: m.groupId } : {}),
    });
    byKey.set(k, [...(byKey.get(k) ?? []), m]);
  }
  const out: NegativePosition[] = [];
  for (const [key, list] of byKey) {
    const perDay = new Map<string, bigint>();
    for (const m of list) perDay.set(m.date, (perDay.get(m.date) ?? 0n) + BigInt(m.qtyG));
    let run = 0n;
    let min = 0n;
    let onDate = "";
    for (const day of [...perDay.keys()].sort()) {
      run += perDay.get(day)!;
      if (run < min) {
        min = run;
        onDate = day;
      }
    }
    if (min < 0n) {
      const m = list[0]!;
      out.push({
        key,
        product: m.product,
        location: m.location,
        ...(m.varietyId ? { varietyId: m.varietyId } : {}),
        ...(m.millPartyId ? { millPartyId: m.millPartyId } : {}),
        ...(m.otherProductName ? { otherProductName: m.otherProductName } : {}),
        minG: min,
        onDate,
        nowG: run,
      });
    }
  }
  return out.sort((a, b) => (a.onDate < b.onDate ? -1 : 1));
}

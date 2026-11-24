/**
 * Ledger reads (one Gola at a time; never mixes Golas).
 * Account balance = Σdebit − Σcredit. Party: > 0 they owe us (পাওনা), < 0 we owe them (দেনা).
 */
import { db } from "../db/dexie";

/** Every non-zero account balance of a Gola (optionally up to and including `upTo`). */
export async function godownBalances(
  godownId: string,
  upTo?: string,
): Promise<Map<string, bigint>> {
  const lines = await db()
    .ledgerLines.where("[godownId+date]")
    .between([godownId, ""], [godownId, upTo ?? "￿"], true, true)
    .toArray();
  const m = new Map<string, bigint>();
  for (const l of lines) {
    m.set(l.account, (m.get(l.account) ?? 0n) + BigInt(l.debitPaise) - BigInt(l.creditPaise));
  }
  for (const [k, v] of m) if (v === 0n) m.delete(k);
  return m;
}

/** Balance of one account of a Gola up to and including `upTo`. */
export async function accountBalance(
  godownId: string,
  account: string,
  upTo?: string,
): Promise<bigint> {
  const lines = await db()
    .ledgerLines.where("[godownId+account+date]")
    .between([godownId, account, ""], [godownId, account, upTo ?? "￿"], true, true)
    .toArray();
  let b = 0n;
  for (const l of lines) b += BigInt(l.debitPaise) - BigInt(l.creditPaise);
  return b;
}

/** A party's balance (> 0 they owe us). */
export function partyBalance(godownId: string, partyId: string, upTo?: string): Promise<bigint> {
  return accountBalance(godownId, `PARTY:${partyId}`, upTo);
}

/** Trial balance of a Gola: Σ debits == Σ credits (to the paisa). */
export async function godownTrialBalance(
  godownId: string,
): Promise<{ debitPaise: bigint; creditPaise: bigint; balanced: boolean }> {
  const lines = await db()
    .ledgerLines.where("[godownId+date]")
    .between([godownId, ""], [godownId, "￿"], true, true)
    .toArray();
  let dr = 0n;
  let cr = 0n;
  for (const l of lines) {
    dr += BigInt(l.debitPaise);
    cr += BigInt(l.creditPaise);
  }
  return { debitPaise: dr, creditPaise: cr, balanced: dr === cr };
}

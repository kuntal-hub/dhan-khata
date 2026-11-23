/**
 * Ledger queries. Every function takes `godownId` (godown isolation, spec §5 principle 6).
 * Balances are always sums of stored ledger lines.
 */
import { partyAccountKey } from "@/domain/posting/accounts";
import { balancesByAccount, receivablePayable, trialBalance } from "@/domain/posting/balances";
import type { LedgerLine } from "@/domain/schemas";
import { db } from "../db/dexie";

const MIN = "";
const MAX = "￿";

/** Lines of one account in a godown, optionally up to and including `toDate`. */
export function accountLines(
  godownId: string,
  account: string,
  range: { from?: string; to?: string } = {},
): Promise<LedgerLine[]> {
  return db()
    .ledgerLines.where("[godownId+account+date]")
    .between(
      [godownId, account, range.from ?? MIN],
      [godownId, account, range.to ?? MAX],
      true,
      true,
    )
    .toArray();
}

/** Σdebit − Σcredit of one account in one godown. */
export async function accountBalance(
  godownId: string,
  account: string,
  range: { from?: string; to?: string } = {},
): Promise<bigint> {
  let bal = 0n;
  for (const l of await accountLines(godownId, account, range)) {
    bal += BigInt(l.debitPaise) - BigInt(l.creditPaise);
  }
  return bal;
}

/** Party balance: > 0 = they owe us (পাওনা), < 0 = we owe them (দেনা). */
export function partyBalance(godownId: string, partyId: string, toDate?: string): Promise<bigint> {
  return accountBalance(godownId, partyAccountKey(partyId), toDate ? { to: toDate } : {});
}

export function godownLines(godownId: string): Promise<LedgerLine[]> {
  return db()
    .ledgerLines.where("[godownId+date]")
    .between([godownId, MIN], [godownId, MAX], true, true)
    .toArray();
}

export async function godownBalances(godownId: string): Promise<Map<string, bigint>> {
  return balancesByAccount(await godownLines(godownId));
}

export async function godownTrialBalance(godownId: string) {
  return trialBalance(await godownLines(godownId));
}

export async function godownReceivablePayable(godownId: string) {
  return receivablePayable(await godownLines(godownId));
}

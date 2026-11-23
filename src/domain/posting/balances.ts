/**
 * Balances are ALWAYS sums of ledger lines (spec §5 principle 3). These helpers work on either
 * posted lines (bigint) or stored LedgerLine docs (strings), and every one is per godown.
 */
import type { LedgerLine } from "../schemas/system";
import type { PostedLine } from "./post";

type AnyLine = PostedLine | LedgerLine;

function dr(l: AnyLine): bigint {
  return "debit" in l ? l.debit : BigInt(l.debitPaise);
}
function cr(l: AnyLine): bigint {
  return "credit" in l ? l.credit : BigInt(l.creditPaise);
}

/** Σdebit − Σcredit for one account. */
export function accountBalance(lines: Iterable<AnyLine>, account: string): bigint {
  let bal = 0n;
  for (const l of lines) if (l.account === account) bal += dr(l) - cr(l);
  return bal;
}

/** Party balance: > 0 = they owe us (পাওনা), < 0 = we owe them (দেনা). */
export function partyBalance(lines: Iterable<AnyLine>, partyId: string): bigint {
  return accountBalance(lines, `PARTY:${partyId}`);
}

export function balancesByAccount(lines: Iterable<AnyLine>): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const l of lines) m.set(l.account, (m.get(l.account) ?? 0n) + dr(l) - cr(l));
  return m;
}

export interface TrialBalance {
  totalDebit: bigint;
  totalCredit: bigint;
  balanced: boolean;
}

export function trialBalance(lines: Iterable<AnyLine>): TrialBalance {
  let totalDebit = 0n;
  let totalCredit = 0n;
  for (const l of lines) {
    totalDebit += dr(l);
    totalCredit += cr(l);
  }
  return { totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/** Σ positive party balances (পাওনা) and Σ |negative| party balances (দেনা). */
export function receivablePayable(lines: Iterable<AnyLine>): {
  receivable: bigint;
  payable: bigint;
} {
  let receivable = 0n;
  let payable = 0n;
  for (const [account, bal] of balancesByAccount(lines)) {
    if (!account.startsWith("PARTY:")) continue;
    if (bal > 0n) receivable += bal;
    else payable -= bal;
  }
  return { receivable, payable };
}

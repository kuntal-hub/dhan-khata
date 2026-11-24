/**
 * Cashbook classifier (requirement_v2 §7.3, §12.1B). Pure functions over documents.
 *
 *   Cash received = IN payments (+ bank→cash withdrawals, capital brought in as cash)
 *   Cash paid     = OUT payments that are not expenses (+ cash→bank deposits, owner drawings)
 *   Cash expenses = OUT payments whose source is EXPENSE or VEHICLE_COST
 *   Expected closing = Opening + Received − Paid − Expenses
 *   Opening of a day = all effects before that day (previous day-close differences included),
 *   so after a counted close the next opening equals the counted (actual) cash.
 *
 * The same lines are produced per bank account (BANK/UPI payments). Credit purchases and sales
 * are not payments and never appear here.
 */
import { sumBig } from "../rounding";
import { ACC2, bankKey } from "./accounts";
import type { Doc } from "./schemas";

export type CashCategory = "OPENING" | "RECEIVED" | "PAID" | "EXPENSE" | "DIFF";

export interface CashEffect {
  /** "CASH" or "BANK:<id>". */
  account: string;
  date: string;
  category: CashCategory;
  /** Signed effect on the balance. */
  signedPaise: bigint;
  docId: string;
  docType: Doc["type"];
}

/** Every cash/bank effect of one document (none if void). */
export function cashEffects(d: Doc): CashEffect[] {
  if (d.status !== "active") return [];
  const out: CashEffect[] = [];
  const push = (account: string, date: string, category: CashCategory, signed: bigint) => {
    if (signed !== 0n)
      out.push({ account, date, category, signedPaise: signed, docId: d._id, docType: d.type });
  };
  switch (d.type) {
    case "PAYMENT": {
      const acct = d.mode === "CASH" ? ACC2.CASH : bankKey(d.bankAccountId ?? "");
      const amt = BigInt(d.amountPaise);
      if (d.direction === "IN") push(acct, d.paymentDate, "RECEIVED", amt);
      else if (d.source.type === "EXPENSE" || d.source.type === "VEHICLE_COST")
        push(acct, d.paymentDate, "EXPENSE", -amt);
      else push(acct, d.paymentDate, "PAID", -amt);
      break;
    }
    case "CONTRA": {
      const amt = BigInt(d.amountPaise);
      const bank = d.bankAccountId ? bankKey(d.bankAccountId) : undefined;
      const date = d.transactionDate;
      switch (d.kind) {
        case "DEPOSIT":
          push(ACC2.CASH, date, "PAID", -amt);
          if (bank) push(bank, date, "RECEIVED", amt);
          break;
        case "WITHDRAW":
          push(ACC2.CASH, date, "RECEIVED", amt);
          if (bank) push(bank, date, "PAID", -amt);
          break;
        case "TRANSFER":
          if (bank) push(bank, date, "PAID", -amt);
          if (d.toBankAccountId) push(bankKey(d.toBankAccountId), date, "RECEIVED", amt);
          break;
        case "CAPITAL_IN":
          push(bank ?? ACC2.CASH, date, "RECEIVED", amt);
          break;
        case "DRAWINGS":
          push(bank ?? ACC2.CASH, date, "PAID", -amt);
          break;
      }
      break;
    }
    case "DAY_CLOSE":
      push(ACC2.CASH, d.date, "DIFF", BigInt(d.diffPaise));
      break;
    case "OPENING":
      for (const it of d.items) {
        if (it.kind === "CASH")
          push(ACC2.CASH, d.transactionDate, "OPENING", BigInt(it.amountPaise));
        if (it.kind === "BANK" && it.refId)
          push(bankKey(it.refId), d.transactionDate, "OPENING", BigInt(it.amountPaise));
      }
      break;
    default:
      break;
  }
  return out;
}

export interface CashbookDay {
  account: string;
  date: string;
  openingPaise: bigint;
  receivedPaise: bigint;
  paidPaise: bigint;
  expensesPaise: bigint;
  /** Opening entries made on this day (e.g. the go-live opening balance). */
  openingEntryPaise: bigint;
  expectedClosingPaise: bigint;
  /** Day-close difference posted on this day (0 when not closed or no difference). */
  diffPaise: bigint;
  /** expected + diff: the closing that carries to the next day. */
  closingPaise: bigint;
  items: { received: CashEffect[]; paid: CashEffect[]; expenses: CashEffect[] };
}

/** One day of the cash (or one bank) book from all of a Gola's documents. */
export function cashbookDay(docs: readonly Doc[], account: string, date: string): CashbookDay {
  const effects = docs.flatMap(cashEffects).filter((e) => e.account === account);
  return cashbookDayFromEffects(effects, account, date);
}

export function cashbookDayFromEffects(
  effects: readonly CashEffect[],
  account: string,
  date: string,
): CashbookDay {
  const before = effects.filter((e) => e.date < date);
  const day = effects.filter((e) => e.date === date);
  const opening = sumBig(before.map((e) => e.signedPaise));
  const of = (c: CashCategory) => day.filter((e) => e.category === c);
  const sumAbs = (list: CashEffect[]) =>
    sumBig(list.map((e) => (e.signedPaise < 0n ? -e.signedPaise : e.signedPaise)));
  const received = of("RECEIVED");
  const paid = of("PAID");
  const expenses = of("EXPENSE");
  const openingEntry = sumBig(of("OPENING").map((e) => e.signedPaise));
  const receivedPaise = sumAbs(received);
  const paidPaise = sumAbs(paid);
  const expensesPaise = sumAbs(expenses);
  const expected = opening + openingEntry + receivedPaise - paidPaise - expensesPaise;
  const diff = sumBig(of("DIFF").map((e) => e.signedPaise));
  return {
    account,
    date,
    openingPaise: opening,
    receivedPaise,
    paidPaise,
    expensesPaise,
    openingEntryPaise: openingEntry,
    expectedClosingPaise: expected,
    diffPaise: diff,
    closingPaise: expected + diff,
    items: { received, paid, expenses },
  };
}

/** Balance of a cash/bank account at the end of `date` (inclusive). */
export function balanceAt(docs: readonly Doc[], account: string, date: string): bigint {
  return sumBig(
    docs
      .flatMap(cashEffects)
      .filter((e) => e.account === account && e.date <= date)
      .map((e) => e.signedPaise),
  );
}

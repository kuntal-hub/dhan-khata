/**
 * Due dates (DECISIONS D54). A due date is the owner's OPTIONAL reminder of when the remaining due
 * of a deal should be paid (farmer purchase) or collected (mill dispatch, sale). It is a reference
 * only: it never blocks, splits or schedules payments, and it never touches money, stock, ledger
 * lines or the posting revision.
 *
 *  - Only the three deal types carry one. Older records of other types may still hold a `dueDate`
 *    (v2.0 allowed it on expenses, trips and second-party entries): it stays stored, untouched,
 *    and is ignored everywhere.
 *  - Unlike business dates it may be in the future; it may not be before the deal's own date.
 *  - It changes later through its own lightweight op (`setDueDate` / push op `dueDate`):
 *    last writer wins, allowed on closed days. A full edit of the deal keeps the stored value.
 *  - An automatic reminder's stored state (done / snoozed, id `auto:<sourceId>`) belongs to the
 *    due date it was made for: when the due date moves, the reminder opens again at the new date.
 */
import { addDays, diffDays, isValidYmd, parseYmd } from "../dates";
import type { Doc, DocType } from "./schemas";

export const DUE_DATE_TYPES = ["PURCHASE", "SALE", "MILL_DISPATCH"] as const;
export type DueDateDocType = (typeof DUE_DATE_TYPES)[number];

/** Types whose stored `dueDate` is kept as is by a full edit (the deals + v2.0 legacy types). */
export const DUE_DATE_FIELD_TYPES: readonly DocType[] = [
  ...DUE_DATE_TYPES,
  "EXPENSE",
  "TRIP",
  "SECOND_PARTY",
];

export function isDueDateType(type: DocType): type is DueDateDocType {
  return (DUE_DATE_TYPES as readonly string[]).includes(type);
}

/** The deal's date that a due date may not precede. */
export function dealDateOf(d: Doc): string | undefined {
  switch (d.type) {
    case "PURCHASE":
    case "SALE":
      return d.transactionDate;
    case "MILL_DISPATCH":
      return d.dispatchDate;
    default:
      return undefined;
  }
}

/** The due date that counts (only deals have one; legacy values on other types are ignored). */
export function dueDateOf(d: Doc): string | undefined {
  return isDueDateType(d.type) ? (d as { dueDate?: string }).dueDate : undefined;
}

export interface DueDateCheck {
  /** Blocking: before the deal's date (or not a date). */
  error?: "DUE_BEFORE_DEAL" | "VALIDATION_FAILED";
  /** Soft: on/after the deal's date but already in the past ("এই তারিখ পেরিয়ে গেছে"). */
  passed: boolean;
}

/** Validate a due date against the deal's date. Empty = no due date = always fine. */
export function checkDueDate(
  due: string | undefined,
  dealDate: string,
  today: string,
): DueDateCheck {
  if (!due) return { passed: false };
  if (!isValidYmd(due)) return { error: "VALIDATION_FAILED", passed: false };
  if (due < dealDate) return { error: "DUE_BEFORE_DEAL", passed: false };
  return { passed: due < today };
}

/** Days from today to the due date: > 0 still to come, 0 today, < 0 passed. */
export function daysUntil(due: string, today: string): number {
  return diffDays(today, due);
}

/** Same day next month, clamped to the month's last day (31 Jan → 28/29 Feb). */
export function addOneMonth(ymd: string): string {
  const { y, m, d } = parseYmd(ymd);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let day = d; day >= 28; day--) {
    const c = `${ny}-${pad(nm)}-${pad(day)}`;
    if (isValidYmd(c)) return c;
  }
  return `${ny}-${pad(nm)}-${pad(Math.min(d, 28))}`;
}

export type DueChip = "D7" | "D15" | "M1";
export const DUE_CHIPS: readonly DueChip[] = ["D7", "D15", "M1"];

/** Quick picks "+৭ দিন", "+১৫ দিন", "+১ মাস" counted from today (never before the deal date). */
export function dueChipDate(chip: DueChip, today: string, dealDate: string): string {
  const base = dealDate > today ? dealDate : today;
  if (chip === "D7") return addDays(base, 7);
  if (chip === "D15") return addDays(base, 15);
  return addOneMonth(base);
}

export interface ReminderStateLike {
  dueDate: string;
  status: "open" | "done" | "snoozed";
  snoozeUntil?: string;
}

/**
 * The state of an automatic reminder for a bill due on `billDue`. A stored state made for another
 * due date is stale (the due date moved since): the reminder is open again at the new date.
 */
export function autoReminderState(
  billDue: string,
  stored: ReminderStateLike | undefined,
): { status: ReminderStateLike["status"]; snoozeUntil?: string } {
  if (!stored || stored.dueDate !== billDue) return { status: "open" };
  return {
    status: stored.status,
    ...(stored.status === "snoozed" && stored.snoozeUntil
      ? { snoozeUntil: stored.snoozeUntil }
      : {}),
  };
}

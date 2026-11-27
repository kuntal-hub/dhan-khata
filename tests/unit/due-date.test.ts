/**
 * Due dates are references only (DECISIONS D54): which records carry one, the picker rules
 * (future allowed, never before the deal, passed = soft warning), quick chips, the automatic
 * reminder's state following the due date, and the derived status with overdue as a flag.
 */
import { describe, expect, it } from "vitest";
import {
  DUE_DATE_TYPES,
  addOneMonth,
  autoReminderState,
  checkDueDate,
  daysUntil,
  dealDateOf,
  dueChipDate,
  dueDateOf,
  isDueDateType,
} from "@/domain/v2/dueDate";
import { billState, billsOf, displayStatus, matchesPayFilter } from "@/domain/v2/payments";
import { QTL, RS, doc, manual, purchase } from "../helpers/v2";

const D = "2026-11-20";

describe("which records carry a due date", () => {
  it("only purchase, sale and mill dispatch", () => {
    expect([...DUE_DATE_TYPES].sort()).toEqual(["MILL_DISPATCH", "PURCHASE", "SALE"]);
    for (const t of ["EXPENSE", "TRIP", "SECOND_PARTY", "PAYMENT", "MILL_RETURN"] as const) {
      expect(isDueDateType(t)).toBe(false);
    }
  });

  it("a legacy dueDate on an expense / second-party entry is ignored by bills and dueDateOf", () => {
    const ex = doc("EXPENSE", D, {
      title: "diesel",
      categoryCode: "DIESEL",
      amountPaise: "50000",
      expenseDate: D,
      partyId: "P1",
      dueDate: "2026-12-01",
    });
    expect(dueDateOf(ex)).toBeUndefined();
    expect(billsOf(ex)[0]!.dueDate).toBeUndefined();
    const sp = doc("SECOND_PARTY", D, {
      partyId: "P2",
      transactionDate: D,
      kind: "WE_OWE",
      amountPaise: "100000",
      dueDate: "2026-12-01",
    });
    expect(billsOf(sp)[0]!.dueDate).toBeUndefined();
    // …but stays stored on the record, untouched.
    expect(sp.dueDate).toBe("2026-12-01");
  });

  it("deals keep theirs; the deal date is the business date", () => {
    const p = purchase(D, "F1", "V1", QTL, 1000n * RS, {}, { dueDate: "2027-01-15" });
    expect(dueDateOf(p)).toBe("2027-01-15");
    expect(billsOf(p)[0]!.dueDate).toBe("2027-01-15");
    expect(dealDateOf(p)).toBe(D);
    const disp = doc("MILL_DISPATCH", D, {
      dispatchDate: D,
      millPartyId: "M1",
      varietyId: "V1",
      weight: manual(QTL),
      ratePaisePerQtl: (2000n * RS).toString(),
      totalValuePaise: "0",
      dueDate: "2026-12-05",
    } as never);
    expect(dealDateOf(disp)).toBe(D);
    expect(dueDateOf(disp)).toBe("2026-12-05");
  });
});

describe("due date picker rules", () => {
  const today = "2026-11-27";
  it("empty is always fine (fully optional)", () => {
    expect(checkDueDate(undefined, D, today)).toEqual({ passed: false });
  });
  it("today and any future date are allowed (no 'no future dates' rule)", () => {
    expect(checkDueDate(today, D, today)).toEqual({ passed: false });
    expect(checkDueDate("2027-06-30", D, today)).toEqual({ passed: false });
  });
  it("before the deal's date is rejected", () => {
    expect(checkDueDate("2026-11-19", D, today).error).toBe("DUE_BEFORE_DEAL");
  });
  it("on/after the deal but already past is allowed with a soft warning", () => {
    expect(checkDueDate(D, D, today)).toEqual({ passed: true });
    expect(checkDueDate("2026-11-25", D, today)).toEqual({ passed: true });
  });
  it("not a date → validation error", () => {
    expect(checkDueDate("2026-02-30", D, today).error).toBe("VALIDATION_FAILED");
  });
  it("days left / passed", () => {
    expect(daysUntil("2026-12-16", today)).toBe(19);
    expect(daysUntil(today, today)).toBe(0);
    expect(daysUntil("2026-11-22", today)).toBe(-5);
  });
});

describe("quick chips", () => {
  it("+7 / +15 days and +1 month from today", () => {
    expect(dueChipDate("D7", "2026-11-27", D)).toBe("2026-12-04");
    expect(dueChipDate("D15", "2026-11-27", D)).toBe("2026-12-12");
    expect(dueChipDate("M1", "2026-11-27", D)).toBe("2026-12-27");
  });
  it("count from the deal date when the deal is dated later than today", () => {
    expect(dueChipDate("D7", "2026-11-27", "2026-11-30")).toBe("2026-12-07");
  });
  it("+1 month clamps to the month end and rolls the year", () => {
    expect(addOneMonth("2027-01-31")).toBe("2027-02-28");
    expect(addOneMonth("2028-01-31")).toBe("2028-02-29");
    expect(addOneMonth("2026-12-15")).toBe("2027-01-15");
    expect(addOneMonth("2026-03-31")).toBe("2026-04-30");
  });
});

describe("automatic reminder state follows the due date", () => {
  it("a stored done / snooze counts only for the date it was made for", () => {
    expect(autoReminderState("2026-12-01", undefined)).toEqual({ status: "open" });
    const done = { dueDate: "2026-12-01", status: "done" as const };
    expect(autoReminderState("2026-12-01", done)).toEqual({ status: "done" });
    // The due date moved: the reminder is open again at the new date.
    expect(autoReminderState("2026-12-10", done)).toEqual({ status: "open" });
    const snoozed = {
      dueDate: "2026-12-01",
      status: "snoozed" as const,
      snoozeUntil: "2026-12-04",
    };
    expect(autoReminderState("2026-12-01", snoozed)).toEqual({
      status: "snoozed",
      snoozeUntil: "2026-12-04",
    });
  });
});

describe("status filters", () => {
  it("OVERDUE filter matches the flag; a row shows overdue over its status", () => {
    const p = purchase(D, "F1", "V1", QTL, 1000n * RS, {}, { dueDate: "2026-11-22" });
    const s = billState(billsOf(p)[0]!, [], "2026-11-27");
    expect(matchesPayFilter(s, "OVERDUE")).toBe(true);
    expect(matchesPayFilter(s, "UNPAID")).toBe(true);
    expect(matchesPayFilter(s, "PARTIAL")).toBe(false);
    expect(displayStatus(s)).toBe("OVERDUE");
    const notYet = billState(billsOf(p)[0]!, [], "2026-11-21");
    expect(displayStatus(notYet)).toBe("UNPAID");
  });
});

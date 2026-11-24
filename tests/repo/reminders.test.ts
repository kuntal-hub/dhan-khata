/** Reminder centre logic (spec §9.13): snooze, done, manual reminders, auto-close on Settled. */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { dashboardData } from "@/client/queries/dashboard";
import {
  createManualReminder,
  effectiveDue,
  pendingReminders,
  reminderId,
  saveMoney,
  savePurchase,
  setReminderState,
  type VoucherDraft,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import {
  TODAY,
  paymentDraft,
  purchaseDraft,
  setupDevice,
  type LocalGodown,
} from "../helpers/local";

const QTL = 100_000n;
let A: LocalGodown;

beforeEach(async () => {
  A = (await setupDevice("rem-test", { godowns: [{ id: "GA", code: "RP" }] })).GA!;
});

describe("reminders", () => {
  it("snooze moves the due date; done removes it from the lists", async () => {
    const r = await createManualReminder("GA", { title: "Call the mill", dueDate: TODAY });
    expect((await pendingReminders("GA")).map((x) => x._id)).toEqual([r._id]);
    expect((await dashboardData("GA", TODAY)).collectDue.count).toBe(0); // CUSTOM: not a money card

    await setReminderState("GA", r._id, { snoozeUntil: addDays(TODAY, 3) });
    const s = (await db().reminders.get(r._id))!;
    expect(s.status).toBe("snoozed");
    expect(effectiveDue(s)).toBe(addDays(TODAY, 3));
    expect((await pendingReminders("GA")).length).toBe(1);

    await setReminderState("GA", r._id, { done: true });
    expect(await pendingReminders("GA")).toEqual([]);
    // One outbox op per change (synced like masters), the last carrying `snoozeUntil` changes.
    const ops = await db().outbox.where("entityId").equals(r._id).toArray();
    expect(ops.length).toBe(3);
    expect(ops[1]!.fields).toContain("snoozeUntil");
  });

  it("a bill's due reminder closes automatically when the bill becomes Settled", async () => {
    const p = await savePurchase("GA", {
      ...purchaseDraft(A.farmer, A.variety.SWARNA!, 10n * QTL, 200_000n),
      dueDate: addDays(TODAY, 5),
    } as VoucherDraft);
    const id = reminderId(p.primary._id, "PAY_DUE");
    expect((await db().reminders.get(id))?.status).toBe("open");
    await saveMoney("GA", paymentDraft(A.farmer, 500_000n));
    expect((await db().reminders.get(id))?.status).toBe("open"); // partly paid
    await saveMoney("GA", paymentDraft(A.farmer, 1_500_000n));
    expect((await db().reminders.get(id))?.status).toBe("done"); // settled (FIFO)
  });

  it("overdue snoozed reminders count on the dashboard again on their snooze date", async () => {
    const r = await createManualReminder("GA", {
      title: "Collect",
      dueDate: addDays(TODAY, -2),
      kind: "COLLECT_DUE",
      amountPaise: "100000",
    });
    let d = await dashboardData("GA", TODAY);
    expect(d.collectDue).toEqual({ count: 1, amountPaise: 100_000n, overdueCount: 1 });
    await setReminderState("GA", r._id, { snoozeUntil: addDays(TODAY, 1) });
    d = await dashboardData("GA", TODAY);
    expect(d.collectDue.count).toBe(0);
    d = await dashboardData("GA", addDays(TODAY, 1));
    expect(d.collectDue.count).toBe(1);
    await expect(createManualReminder("GA", { title: " ", dueDate: TODAY })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

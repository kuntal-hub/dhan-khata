/** Reminder reads (spec §9.13), kept apart from the write path so screens stay light. */
import type { Reminder } from "@/domain/schemas";
import { db } from "../db/dexie";

/** The date a reminder is due on now: a snoozed reminder comes back on its snooze date. */
export function effectiveDue(r: Pick<Reminder, "status" | "dueDate" | "snoozeUntil">): string {
  return r.status === "snoozed" && r.snoozeUntil ? r.snoozeUntil : r.dueDate;
}

/** Open + snoozed reminders of a godown (both still need attention), soonest first. */
export async function pendingReminders(godownId: string): Promise<Reminder[]> {
  const d = db();
  const [open, snoozed] = await Promise.all([
    d.reminders.where("[godownId+status]").equals([godownId, "open"]).toArray(),
    d.reminders.where("[godownId+status]").equals([godownId, "snoozed"]).toArray(),
  ]);
  return [...open, ...snoozed].sort((a, b) =>
    effectiveDue(a) < effectiveDue(b) ? -1 : effectiveDue(a) > effectiveDue(b) ? 1 : 0,
  );
}

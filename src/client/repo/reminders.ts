/**
 * Reminder records (requirement_v2 §12.6). Due reminders come AUTOMATICALLY from the `dueDate`
 * of open bills (a query, nothing stored). Stored records are only:
 *  - manual reminders (kind CUSTOM / PAY / COLLECT, free title), and
 *  - the owner's state for an automatic one (done / snoozed / edited due date), id `auto:<sourceId>`.
 * They sync like masters (entity "reminder").
 */
import { v7 as uuidv7 } from "uuid";
import { ReminderSchema, type Reminder } from "@/domain/schemas";
import { db, writeTables } from "../db/dexie";
import { enqueueOp, validationError, writeContext, type WriteCtx } from "./context";
import { emitLocalWrite } from "./notify";

export function autoReminderId(sourceId: string): string {
  return `auto:${sourceId}`;
}

async function write(
  ctx: WriteCtx,
  existing: Reminder | undefined,
  next: Reminder,
): Promise<Reminder> {
  const parsed = ReminderSchema.safeParse(next);
  if (!parsed.success) throw validationError(parsed.error);
  await db().reminders.put(parsed.data);
  await enqueueOp(ctx, {
    entity: "reminder",
    entityId: parsed.data._id,
    op: "upsert",
    baseRev: existing?.rev ?? 0,
    payload: parsed.data,
  });
  return parsed.data;
}

export interface ReminderStateInput {
  /** The bill (automatic reminder) or an existing manual reminder id. */
  source?: { type: string; id: string };
  reminderId?: string;
  kind: Reminder["kind"];
  partyId?: string;
  dueDate: string;
  amountPaise?: string;
  title?: string;
}

/** Mark done / snooze / reopen / change the due date of a reminder. */
export async function setReminderState(
  godownId: string,
  input: ReminderStateInput,
  status: Reminder["status"],
  snoozeUntil?: string,
): Promise<Reminder> {
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const id = input.reminderId ?? autoReminderId(input.source?.id ?? uuidv7());
    const existing = await d.reminders.get(id);
    const next: Reminder = {
      _id: id,
      businessId: ctx.businessId,
      godownId,
      kind: input.kind,
      ...(input.partyId ? { partyId: input.partyId } : {}),
      ...(input.source
        ? { source: input.source }
        : existing?.source
          ? { source: existing.source }
          : {}),
      dueDate: input.dueDate,
      ...(input.amountPaise ? { amountPaise: input.amountPaise } : {}),
      title: input.title ?? existing?.title ?? "",
      status,
      ...(status === "snoozed" && snoozeUntil ? { snoozeUntil } : {}),
      rev: (existing?.rev ?? 0) + 1,
      updatedAt: ctx.nowIso,
      createdAt: existing?.createdAt ?? ctx.nowIso,
      createdBy: existing?.createdBy ?? ctx.userId,
      updatedBy: ctx.userId,
    };
    return write(ctx, existing, next);
  });
  emitLocalWrite();
  return out;
}

export interface ManualReminderInput {
  title: string;
  dueDate: string;
  kind?: Reminder["kind"];
  partyId?: string;
  amountPaise?: string;
}

export async function createManualReminder(
  godownId: string,
  input: ManualReminderInput,
): Promise<Reminder> {
  return setReminderState(
    godownId,
    {
      reminderId: uuidv7(),
      kind: input.kind ?? "CUSTOM",
      dueDate: input.dueDate,
      title: input.title,
      ...(input.partyId ? { partyId: input.partyId } : {}),
      ...(input.amountPaise ? { amountPaise: input.amountPaise } : {}),
    },
    "open",
  );
}

/**
 * Reminder RECORDS (spec §9.13), created/updated with the voucher that implies them (purchase
 * due date, sale expected payment date, advance adjustment date, cheque date). The reminder
 * centre UI is Phase 5. Reminders sync like masters (entity "reminder").
 * Ids are deterministic per voucher + kind, so editing a voucher updates its reminder.
 */
import { ReminderSchema, type Reminder } from "@/domain/schemas";
import { db } from "../db/dexie";
import { enqueueOp, validationError, type WriteCtx } from "./context";

export interface ReminderInput {
  _id: string;
  kind: Reminder["kind"];
  partyId?: string;
  voucherId?: string;
  /** undefined = no due date any more → the reminder is closed (status done). */
  dueDate: string | undefined;
  amountPaise?: string;
  /** Free text for manual reminders; "" for automatic ones (rendered from the kind). */
  title: string;
}

export function reminderId(voucherId: string, kind: Reminder["kind"]): string {
  return `${voucherId}:${kind}`;
}

/** Create, update or close a reminder inside the caller's transaction. */
export async function upsertReminderInTx(ctx: WriteCtx, input: ReminderInput): Promise<void> {
  const d = db();
  const existing = await d.reminders.get(input._id);
  if (!input.dueDate) {
    if (!existing || existing.status === "done") return;
    await write(ctx, existing, { ...existing, status: "done" });
    return;
  }
  const next: Reminder = {
    _id: input._id,
    godownId: ctx.godown._id,
    kind: input.kind,
    ...(input.partyId ? { partyId: input.partyId } : {}),
    ...(input.voucherId ? { voucherId: input.voucherId } : {}),
    dueDate: input.dueDate,
    ...(input.amountPaise ? { amountPaise: input.amountPaise } : {}),
    title: input.title,
    status: "open",
    rev: existing ? existing.rev + 1 : 1,
    updatedAt: ctx.nowIso,
    updatedBy: ctx.userId,
    createdAt: existing?.createdAt ?? ctx.nowIso,
    createdBy: existing?.createdBy ?? ctx.userId,
    ...(existing?.serverSeq !== undefined ? { serverSeq: existing.serverSeq } : {}),
  };
  if (existing) {
    const same =
      existing.status === "open" &&
      existing.dueDate === next.dueDate &&
      existing.amountPaise === next.amountPaise &&
      existing.partyId === next.partyId &&
      existing.title === next.title;
    if (same) return;
  }
  await write(ctx, existing, next);
}

async function write(ctx: WriteCtx, existing: Reminder | undefined, raw: Reminder): Promise<void> {
  const parsed = ReminderSchema.safeParse({
    ...raw,
    rev: existing ? existing.rev + 1 : 1,
    updatedAt: ctx.nowIso,
    updatedBy: ctx.userId,
  });
  if (!parsed.success) throw validationError(parsed.error);
  const doc = parsed.data;
  await db().reminders.put(doc);
  const fields = existing
    ? (["status", "dueDate", "amountPaise", "partyId", "title"] as const).filter(
        (f) => existing[f] !== doc[f],
      )
    : undefined;
  await enqueueOp(ctx, {
    entity: "reminder",
    entityId: doc._id,
    op: "upsert",
    baseRev: existing ? existing.rev : 0,
    payload: doc,
    ...(fields ? { fields: [...fields, "updatedAt", "updatedBy"] } : {}),
  });
}

/** Open reminders of a godown (newest due first). */
export function openReminders(godownId: string): Promise<Reminder[]> {
  return db().reminders.where("[godownId+status]").equals([godownId, "open"]).sortBy("dueDate");
}

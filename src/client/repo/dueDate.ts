/**
 * Change (or clear) the due date of a deal later (DECISIONS D54): purchase, sale or mill dispatch.
 *
 * A lightweight field update, NOT an edit: money, stock, ledger lines, payments and the document
 * revision used for postings stay exactly as they are. Allowed on a closed day (no cash effect).
 * One Dexie transaction: the document's `dueDate` + an outbox op `dueDate` (the server applies it
 * last-writer-wins on this field only) + a local audit row "old→new" + the automatic reminder
 * opened again at the new date.
 */
import { can, entryMayChange } from "@/domain/rbac";
import { checkDueDate, dealDateOf, isDueDateType } from "@/domain/v2/dueDate";
import { DocSchema, type Doc } from "@/domain/v2/schemas";
import { db, writeTables } from "../db/dexie";
import { RepoError, auditLocal, enqueueOp, validationError, writeContext } from "./context";
import { emitLocalWrite } from "./notify";
import { reopenAutoReminderInTx } from "./reminders";

export async function setDueDate(
  godownId: string,
  docId: string,
  dueDate: string | null,
): Promise<Doc> {
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const existing = await d.vouchers.get(docId);
    if (!existing) throw new RepoError("NOT_FOUND", docId);
    if (existing.godownId !== godownId) throw new RepoError("GODOWN_IMMUTABLE");
    if (existing.status === "void") throw new RepoError("VOUCHER_VOID");
    if (!isDueDateType(existing.type)) throw new RepoError("TYPE_IMMUTABLE", existing.type);
    if (!can(ctx.session.user, godownId, "voucher.edit", { voucherType: existing.type })) {
      throw new RepoError("FORBIDDEN", existing.type);
    }
    if (
      ctx.role === "entry" &&
      !entryMayChange(existing, ctx.userId, ctx.nowIso, { requireUnsynced: false })
    ) {
      throw new RepoError("EDIT_WINDOW_EXPIRED");
    }
    const next = dueDate ?? undefined;
    const check = checkDueDate(next, dealDateOf(existing)!, ctx.today);
    if (check.error) throw new RepoError(check.error, next);
    const old = (existing as { dueDate?: string }).dueDate;
    if (old === next) return existing;

    const { dueDate: _old, ...rest } = existing as Doc & { dueDate?: string };
    const parsed = DocSchema.safeParse(next ? { ...rest, dueDate: next } : rest);
    if (!parsed.success) throw validationError(parsed.error);
    const doc = parsed.data;
    // Same revision: nothing that posts has changed (ledger lines keep `voucherRev`).
    await d.vouchers.put(doc);
    await enqueueOp(ctx, {
      entity: "voucher",
      entityId: doc._id,
      op: "dueDate",
      baseRev: existing.rev,
      payload: doc,
      fields: ["dueDate"],
    });
    await auditLocal(ctx, {
      entity: "voucher",
      entityId: doc._id,
      action: "dueDate",
      rev: doc.rev,
      detail: `${old ?? ""}→${next ?? ""}`,
    });
    // The reminder state is a master record (owner / manager); the entry role leaves it alone.
    if (next && ctx.role !== "entry") await reopenAutoReminderInTx(ctx, doc._id, next);
    return doc;
  });
  emitLocalWrite();
  return out;
}

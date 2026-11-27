/**
 * One-off data repair for due dates (DECISIONS D54; `pnpm fix:due-dates`).
 *
 * Before D54 the reminders tab's "তারিখ বদলান" stored the new date only in the automatic
 * reminder's state record (`auto:<dealId>`), never on the deal, so the deal, the Due & Advance
 * rows, the dashboard and WhatsApp kept showing the old date. Now the due date lives on the deal
 * only and an automatic reminder always takes its date from there, so those changes would be lost.
 *
 * This copies each such date onto its deal (purchase, sale, mill dispatch), the same way a device's
 * `dueDate` op does: the field only (no revision, ledger or stock change), a changelog entry so
 * every device downloads it, and an audit row "old→new". Nothing else changes: money is never
 * touched. Skipped (reported): a date before the deal's own date, a reversed or missing deal, and
 * records that no longer carry a due date (expenses, trips, second-party entries: ignored, D54).
 *
 * Dry run by default; `apply` writes everything for one Gola in ONE transaction. Idempotent: once
 * applied, the reminder's date equals the deal's and nothing is left to change.
 */
import type { Db } from "mongodb";
import { DomainError } from "@/domain/errors";
import { dealDateOf, dueDateOf, isDueDateType } from "@/domain/v2/dueDate";
import type { Doc } from "@/domain/v2/schemas";
import { audit, logChanges } from "./changelog";
import { cols, getMongoClient } from "./db";

export interface DueDateFix {
  godownId: string;
  docId: string;
  number: string;
  type: string;
  /** The deal's due date now ("" = none). */
  from: string;
  /** The date the owner set on the reminder. */
  to: string;
}

export type DueDateSkipReason = "BEFORE_DEAL" | "NOT_A_DEAL" | "VOID" | "MISSING";

export interface DueDateFixReport {
  apply: boolean;
  changes: DueDateFix[];
  skipped: Array<DueDateFix & { reason: DueDateSkipReason }>;
}

export async function fixDueDates(
  db: Db,
  opts: { apply: boolean; actorId: string; godownIds?: string[] },
): Promise<DueDateFixReport> {
  const k = cols(db);
  const report: DueDateFixReport = { apply: opts.apply, changes: [], skipped: [] };
  const filter = {
    _id: { $regex: "^auto:" },
    ...(opts.godownIds ? { godownId: { $in: opts.godownIds } } : {}),
  };
  const states = await k.reminders.find(filter as never).toArray();
  for (const r of states) {
    const docId = String(r._id).slice("auto:".length);
    const doc = (await k.vouchers.findOne({ _id: docId })) as Doc | null;
    const base = {
      godownId: r.godownId,
      docId,
      number: doc?.number ?? "",
      type: doc?.type ?? "",
      from: (doc && dueDateOf(doc)) ?? "",
      to: r.dueDate,
    };
    if (!doc) {
      report.skipped.push({ ...base, reason: "MISSING" });
      continue;
    }
    if (!isDueDateType(doc.type)) {
      // A legacy expense / trip / second-party state: ignored like their due dates.
      if ((doc as { dueDate?: string }).dueDate !== r.dueDate)
        report.skipped.push({ ...base, reason: "NOT_A_DEAL" });
      continue;
    }
    if (base.from === r.dueDate) continue;
    if (doc.status !== "active") {
      report.skipped.push({ ...base, reason: "VOID" });
      continue;
    }
    if (r.dueDate < dealDateOf(doc)!) {
      report.skipped.push({ ...base, reason: "BEFORE_DEAL" });
      continue;
    }
    report.changes.push(base);
  }
  if (!opts.apply || report.changes.length === 0) return report;

  const byGola = new Map<string, DueDateFix[]>();
  for (const c of report.changes) byGola.set(c.godownId, [...(byGola.get(c.godownId) ?? []), c]);
  const client = await getMongoClient();
  for (const [godownId, changes] of byGola) {
    await client.withSession((session) =>
      session.withTransaction(async () => {
        for (const c of changes) {
          const cur = await k.vouchers.findOne({ _id: c.docId }, { session });
          if (!cur || (dueDateOf(cur as Doc) ?? "") !== c.from) {
            throw new DomainError("VALIDATION_FAILED", `changed meanwhile: ${c.docId}`);
          }
          await k.vouchers.updateOne({ _id: c.docId }, { $set: { dueDate: c.to } }, { session });
          const [serverSeq] = await logChanges(db, session, [
            { godownId, entity: "voucher", entityId: c.docId, rev: cur.rev },
          ]);
          await k.vouchers.updateOne({ _id: c.docId }, { $set: { serverSeq } }, { session });
          await audit(db, session, {
            userId: opts.actorId,
            deviceId: "fix-due-dates",
            godownId,
            entity: "voucher",
            entityId: c.docId,
            action: "due_date",
            rev: cur.rev,
            detail: `${c.from}→${c.to} (reminder)`,
          });
        }
      }),
    );
  }
  return report;
}

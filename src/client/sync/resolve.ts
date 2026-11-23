/**
 * Sync-screen actions (spec §12.5 / §12.9): retry a failed op, resolve a voucher conflict
 * ("Keep server" / "Apply mine as new revision"), and export unsynced data as JSON.
 */
import { applyVoucherDerived } from "@/domain/posting/derive";
import type { LedgerLine, StockMove, Voucher } from "@/domain/schemas";
import { db, writeTables, type OutboxRow } from "../db/dexie";
import { RepoError, auditLocal, enqueueOp, writeContext } from "../repo/context";
import { dexieDerivedStore, replaceDerivedRows } from "../repo/derivedStore";
import { emitLocalWrite } from "../repo/notify";

export interface ConflictPayload {
  doc: Voucher;
  lines: LedgerLine[];
  moves: StockMove[];
  rev?: number;
}

export function conflictOf(op: OutboxRow): ConflictPayload | null {
  const c = op.conflict as ConflictPayload | undefined;
  return c && c.doc ? c : null;
}

/** Put a failed op back in the queue (e.g. after the owner restored access). */
export async function retryOp(seq: number): Promise<void> {
  await db().outbox.update(seq, { status: "pending", lastError: undefined });
  emitLocalWrite();
}

/** Keep the server's version: drop this device's ops for the entity, adopt server doc + lines. */
export async function keepServer(seq: number): Promise<void> {
  const d = db();
  await d.transaction("rw", writeTables(d), async () => {
    const op = await d.outbox.get(seq);
    const c = op && conflictOf(op);
    if (!op || !c) throw new RepoError("NOT_FOUND");
    const ctx = await writeContext(c.doc.godownId);
    const ops = await d.outbox.where("entityId").equals(op.entityId).primaryKeys();
    await d.outbox.bulkDelete(ops);
    const before = await dexieDerivedStore.readDerived(c.doc._id);
    await d.vouchers.put(c.doc);
    await replaceDerivedRows(before, { lines: c.lines, moves: c.moves });
    await auditLocal(ctx, {
      entity: "voucher",
      entityId: c.doc._id,
      action: "resolve",
      rev: c.doc.rev,
      reason: "keep-server",
    });
  });
  emitLocalWrite();
}

/** Re-apply this device's version on top of the server's as a NEW revision (never a void). */
export async function applyMineAsNewRevision(seq: number): Promise<Voucher> {
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const op = await d.outbox.get(seq);
    const c = op && conflictOf(op);
    if (!op || !c) throw new RepoError("NOT_FOUND");
    if (c.doc.status === "void") throw new RepoError("VOUCHER_VOID");
    const mine = await d.vouchers.get(op.entityId);
    if (!mine) throw new RepoError("NOT_FOUND");
    const ctx = await writeContext(mine.godownId);
    const next = {
      ...mine,
      rev: c.doc.rev + 1,
      updatedAt: ctx.nowIso,
      updatedBy: ctx.userId,
      ...(c.doc.serverSeq !== undefined ? { serverSeq: c.doc.serverSeq } : {}),
    } as Voucher;
    const ops = await d.outbox.where("entityId").equals(op.entityId).primaryKeys();
    await d.outbox.bulkDelete(ops);
    await d.vouchers.put(next);
    await applyVoucherDerived(dexieDerivedStore, next, mine);
    await enqueueOp(ctx, {
      entity: "voucher",
      entityId: next._id,
      op: "upsert",
      baseRev: c.doc.rev,
      payload: next,
    });
    await auditLocal(ctx, {
      entity: "voucher",
      entityId: next._id,
      action: "resolve",
      rev: next.rev,
      reason: "apply-mine",
    });
    return next;
  });
  emitLocalWrite();
  return out;
}

/**
 * Discard a FAILED op (rejected by the server). Only offered by the UI after the user has
 * exported unsynced data and confirmed; local changes it carried stay visible until re-pulled.
 */
export async function discardOp(seq: number): Promise<void> {
  const d = db();
  await d.transaction("rw", writeTables(d), async () => {
    const op = await d.outbox.get(seq);
    if (!op) return;
    if (op.status !== "error") throw new RepoError("FORBIDDEN", "only failed ops");
    await d.outbox.delete(seq);
  });
  emitLocalWrite();
}

/** JSON of every outbox op plus the current local copy of each affected document. */
export async function exportUnsynced(): Promise<string> {
  const d = db();
  const ops = await d.outbox.orderBy("seq").toArray();
  const docs: Record<string, unknown> = {};
  for (const op of ops) {
    if (op.entity === "voucher") docs[op.entityId] = await d.vouchers.get(op.entityId);
    else docs[op.entityId] = op.payload;
  }
  return JSON.stringify(
    { kind: "dhan-khata-unsynced", exportedAt: new Date().toISOString(), ops, docs },
    null,
    2,
  );
}

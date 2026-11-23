/**
 * Push (spec §12.3): send pending outbox ops in seq order (≤ 50 per batch). An op leaves the
 * outbox ONLY when the server answers applied/duplicate. Rejected → `error`, conflict →
 * `conflict` (shown on the Sync screen); later ops of the same entity pause until it's resolved.
 */
import {
  MAX_PUSH_BATCH,
  isMasterEntity,
  type PushOp,
  type PushOpResult,
  type PushResponse,
  type Reminder,
  type Voucher,
} from "@/domain/schemas";
import { authedCall } from "../auth/session";
import { db, writeTables, type OutboxRow } from "../db/dexie";
import { godownSettingsKey, getSession, setMeta } from "../db/meta";
import { dexieDerivedStore, replaceDerivedRows } from "../repo/derivedStore";
import { masterTable } from "../repo/masters";

export interface PushSummary {
  sent: number;
  applied: number;
  conflicts: number;
  errors: number;
  /** More sendable ops remain after this batch. */
  more: boolean;
}

/** Ops that can be sent now: pending, not behind an earlier failed/conflicted op of the entity. */
export async function sendableOps(limit = MAX_PUSH_BATCH): Promise<OutboxRow[]> {
  const all = await db().outbox.orderBy("seq").toArray();
  const blocked = new Set<string>();
  const out: OutboxRow[] = [];
  for (const op of all) {
    if (op.status === "error" || op.status === "conflict") {
      blocked.add(op.entityId);
      continue;
    }
    if (blocked.has(op.entityId)) continue;
    out.push(op);
    if (out.length > limit) break;
  }
  return out;
}

function toWire(op: OutboxRow): PushOp {
  return {
    opId: op.opId,
    godownId: op.godownId ?? "",
    entity: op.entity as PushOp["entity"],
    entityId: op.entityId,
    op: op.op,
    baseRev: op.baseRev,
    payload: op.payload,
    createdAt: op.createdAt,
    ...(op.fields ? { fields: op.fields } : {}),
  };
}

/** Ops stuck in `sending` (tab closed mid-push) go back to pending; the server dedupes by opId. */
export async function resetSending(): Promise<void> {
  await db().outbox.where("status").equals("sending").modify({ status: "pending" });
}

export async function pushOnce(): Promise<PushSummary> {
  const d = db();
  const candidates = await sendableOps(MAX_PUSH_BATCH);
  const batch = candidates.slice(0, MAX_PUSH_BATCH);
  const summary: PushSummary = {
    sent: batch.length,
    applied: 0,
    conflicts: 0,
    errors: 0,
    more: candidates.length > MAX_PUSH_BATCH,
  };
  if (batch.length === 0) return summary;
  const session = await getSession();
  if (!session) return { ...summary, sent: 0 };

  const seqs = batch.map((o) => o.seq!);
  await d.outbox.where("seq").anyOf(seqs).modify({ status: "sending" });
  let res: PushResponse;
  try {
    res = await authedCall<PushResponse>("/api/sync/push", {
      body: { deviceId: session.deviceId, ops: batch.map(toWire) },
    });
  } catch (e) {
    // Network/auth problems are not rejections: everything goes back to pending, intact.
    await d.outbox
      .where("seq")
      .anyOf(seqs)
      .modify((o) => {
        o.status = "pending";
        o.attempts += 1;
      });
    throw e;
  }

  const byOp = new Map(res.results.map((r) => [r.opId, r] as const));
  await d.transaction("rw", writeTables(d), async () => {
    for (const op of batch) {
      const r = byOp.get(op.opId);
      if (!r) {
        await d.outbox.update(op.seq!, { status: "pending" });
        continue;
      }
      if (r.result === "applied" || r.result === "duplicate") {
        await d.outbox.delete(op.seq!);
        await acceptServerVersion(op, r);
        summary.applied++;
      } else if (r.result === "conflict") {
        await d.outbox.update(op.seq!, {
          status: "conflict",
          lastError: r.reason ?? "CONFLICT",
          conflict: { doc: r.doc, lines: r.lines ?? [], moves: r.moves ?? [], rev: r.rev },
        });
        summary.conflicts++;
      } else if (r.reason === "DEPENDS_ON_FAILED") {
        await d.outbox.update(op.seq!, { status: "pending" });
      } else {
        await d.outbox.update(op.seq!, {
          status: "error",
          lastError: r.reason ?? "REJECTED",
          attempts: op.attempts + 1,
        });
        summary.errors++;
      }
    }
  });
  return summary;
}

/** After applied/duplicate: adopt the server's document and derived rows unless newer local ops exist. */
async function acceptServerVersion(op: OutboxRow, r: PushOpResult): Promise<void> {
  const d = db();
  const stillPending = (await d.outbox.where("entityId").equals(op.entityId).count()) > 0;

  if (op.entity === "voucher") {
    const local = await d.vouchers.get(op.entityId);
    if (!local) return;
    if (stillPending || !r.doc) {
      if (local.serverSeq === undefined && r.serverSeq !== undefined) {
        await d.vouchers.update(local._id, { serverSeq: r.serverSeq });
      }
      return;
    }
    const doc = r.doc as Voucher;
    await d.vouchers.put(doc);
    if (r.lines && r.moves) {
      const before = await dexieDerivedStore.readDerived(doc._id);
      await replaceDerivedRows(before, { lines: r.lines, moves: r.moves });
    }
    return;
  }
  if (op.entity === "reminder") {
    if (!stillPending && r.doc) await d.reminders.put(r.doc as Reminder);
    return;
  }
  if (op.entity === "godownSettings") {
    if (!stillPending && r.doc) await setMeta(godownSettingsKey(op.entityId), r.doc);
    return;
  }
  if (isMasterEntity(op.entity)) {
    const table = masterTable(op.entity, d) as unknown as {
      get(id: string): Promise<{ serverSeq?: number } | undefined>;
      put(v: unknown): Promise<unknown>;
      update(id: string, changes: object): Promise<number>;
    };
    if (!stillPending && r.doc) await table.put(r.doc);
    else if (r.serverSeq !== undefined) {
      const local = await table.get(op.entityId);
      if (local && local.serverSeq === undefined)
        await table.update(op.entityId, { serverSeq: r.serverSeq });
    }
  }
}

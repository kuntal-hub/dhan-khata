/**
 * Pull (spec §12.4): page through the server feed and upsert into Dexie in one transaction per
 * page — SKIPPING any entity that still has a local outbox op (local intent wins until its push
 * result arrives). The cursor is saved in the same transaction (only after it commits).
 * Access changes: newly granted godowns are bootstrapped from the start; revoked godowns are
 * purged only once they have no ops left in the outbox (nothing unsynced is ever lost).
 */
import {
  MAX_PULL_LIMIT,
  isMasterEntity,
  type DayStatus,
  type Godown,
  type PullChange,
  type PullResponse,
  type User,
  type Voucher,
} from "@/domain/schemas";
import { authedCall } from "../auth/session";
import { db, writeTables } from "../db/dexie";
import {
  META,
  deleteMeta,
  getMeta,
  getSession,
  godownSettingsKey,
  setMeta,
  type AccessMeta,
  type SessionMeta,
} from "../db/meta";
import { dexieDerivedStore, replaceDerivedRows } from "../repo/derivedStore";
import { masterTable } from "../repo/masters";

export interface PullProgress {
  done: number;
  total: number;
}

export interface PullSummary {
  pages: number;
  changes: number;
  skipped: number;
  purged: string[];
  granted: string[];
}

async function applyChange(c: PullChange): Promise<boolean> {
  const d = db();
  if (c.entity !== "user" && c.entity !== "godown") {
    if ((await d.outbox.where("entityId").equals(c.entityId).count()) > 0) return false;
  }
  if (c.doc === null) return true;
  switch (c.entity) {
    case "voucher": {
      const doc = c.doc as Voucher;
      const before = await dexieDerivedStore.readDerived(doc._id);
      await d.vouchers.put(doc);
      await replaceDerivedRows(before, { lines: c.lines ?? [], moves: c.moves ?? [] });
      return true;
    }
    case "godownSettings":
      await setMeta(godownSettingsKey(c.entityId), c.doc);
      return true;
    case "godown":
      await d.godowns.put(c.doc as Godown);
      return true;
    case "dayStatus":
      await d.dayStatus.put(c.doc as DayStatus);
      return true;
    case "user": {
      const session = await getMeta<SessionMeta>(META.session);
      if (session && session.user._id === c.entityId) {
        await setMeta(META.session, { ...session, user: c.doc as User });
      }
      return true;
    }
    default:
      if (isMasterEntity(c.entity)) {
        await (masterTable(c.entity, d) as unknown as { put(v: unknown): Promise<unknown> }).put(
          c.doc,
        );
      }
      return true;
  }
}

async function applyPage(res: PullResponse, saveCursor: boolean): Promise<number> {
  const d = db();
  let skipped = 0;
  await d.transaction("rw", writeTables(d), async () => {
    for (const c of res.changes) if (!(await applyChange(c))) skipped++;
    if (saveCursor) {
      await setMeta(META.cursor, res.nextSince);
      await setMeta(META.lastSyncAt, res.serverTime);
    }
  });
  return skipped;
}

/** Pull until caught up. `onProgress` reports changes downloaded vs. total (bootstrap bar). */
export async function pullAll(onProgress?: (p: PullProgress) => void): Promise<PullSummary> {
  const summary: PullSummary = { pages: 0, changes: 0, skipped: 0, purged: [], granted: [] };
  let total = 0;
  let last: PullResponse | null = null;
  for (;;) {
    const since = (await getMeta<number>(META.cursor)) ?? 0;
    const access = await getMeta<AccessMeta>(META.access);
    const q = new URLSearchParams({ since: String(since), limit: String(MAX_PULL_LIMIT) });
    if (access) q.set("av", String(access.accessVersion));
    if (summary.pages === 0) q.set("count", "1");
    const res = await authedCall<PullResponse>(`/api/sync/pull?${q.toString()}`);
    if (summary.pages === 0) total = res.changes.length + (res.remaining ?? 0);
    summary.skipped += await applyPage(res, true);
    summary.pages++;
    summary.changes += res.changes.length;
    onProgress?.({ done: summary.changes, total: Math.max(total, summary.changes) });
    last = res;
    if (!res.hasMore) break;
  }
  if (last) {
    const r = await reconcileAccess(last, onProgress);
    summary.granted = r.granted;
  }
  summary.purged = await purgeRevoked();
  return summary;
}

/** Compare the server's accessible godowns with what this device knows. */
async function reconcileAccess(
  res: PullResponse,
  onProgress?: (p: PullProgress) => void,
): Promise<{ granted: string[] }> {
  const known = await getMeta<AccessMeta>(META.access);
  const next: AccessMeta = { accessVersion: res.accessVersion, godownIds: [...res.godownIds] };
  if (!known) {
    await setMeta(META.access, next);
    return { granted: [] };
  }
  const granted = res.godownIds.filter((g) => !known.godownIds.includes(g));
  const revoked = known.godownIds.filter((g) => !res.godownIds.includes(g));
  for (const g of granted) await bootstrapGodown(g, onProgress);
  if (revoked.length) {
    const pending = new Set([...((await getMeta<string[]>(META.pendingPurge)) ?? []), ...revoked]);
    await setMeta(META.pendingPurge, [...pending]);
  }
  await setMeta(META.access, next);
  return { granted };
}

/** Download a newly granted godown's full feed (its own cursor; the main cursor is untouched). */
export async function bootstrapGodown(
  godownId: string,
  onProgress?: (p: PullProgress) => void,
): Promise<void> {
  let since = 0;
  let done = 0;
  for (;;) {
    const q = new URLSearchParams({
      since: String(since),
      limit: String(MAX_PULL_LIMIT),
      godownId,
      count: "1",
    });
    const res = await authedCall<PullResponse>(`/api/sync/pull?${q.toString()}`);
    await applyPage(res, false);
    done += res.changes.length;
    onProgress?.({ done, total: done + (res.remaining ?? 0) });
    since = res.nextSince;
    if (!res.hasMore) break;
  }
}

/** Purge revoked godowns that have no ops left in the outbox. Returns the purged ids. */
export async function purgeRevoked(): Promise<string[]> {
  const pending = (await getMeta<string[]>(META.pendingPurge)) ?? [];
  if (pending.length === 0) return [];
  const purged: string[] = [];
  const remaining: string[] = [];
  for (const g of pending) {
    const ops = await db().outbox.where("godownId").equals(g).count();
    if (ops > 0) remaining.push(g);
    else {
      await purgeGodown(g);
      purged.push(g);
    }
  }
  if (remaining.length) await setMeta(META.pendingPurge, remaining);
  else await deleteMeta(META.pendingPurge);
  return purged;
}

/** Remove every local row of one godown (only called once its outbox is empty). */
export async function purgeGodown(godownId: string): Promise<void> {
  const d = db();
  const range = <T>(
    t: { where(i: string): { between(a: unknown, b: unknown, x: boolean, y: boolean): T } },
    idx: string,
  ) => t.where(idx).between([godownId, ""], [godownId, "￿"], true, true);
  await d.transaction("rw", writeTables(d), async () => {
    for (const t of [
      d.parties,
      d.varieties,
      d.bankAccounts,
      d.vehicles,
      d.places,
      d.expenseCategories,
      d.vouchers,
    ]) {
      await (
        t as unknown as { where(i: string): { equals(v: string): { delete(): Promise<number> } } }
      )
        .where("godownId")
        .equals(godownId)
        .delete();
    }
    await range<{ delete(): Promise<number> }>(d.ledgerLines, "[godownId+date]").delete();
    await range<{ delete(): Promise<number> }>(d.stockMoves, "[godownId+date]").delete();
    await range<{ delete(): Promise<number> }>(d.dailyAgg, "[godownId+date]").delete();
    await range<{ delete(): Promise<number> }>(d.dayStatus, "[godownId+date]").delete();
    await d.reminders.filter((r) => r.godownId === godownId).delete();
    await d.godowns.delete(godownId);
    await deleteMeta(godownSettingsKey(godownId));
    if ((await getMeta<string>(META.activeGodownId)) === godownId) {
      await deleteMeta(META.activeGodownId);
    }
    await d.auditLocal.add({
      at: new Date().toISOString(),
      godownId,
      userId: (await getSession())?.user._id ?? "",
      deviceId: (await getSession())?.deviceId ?? "",
      entity: "godown",
      entityId: godownId,
      action: "pull-purge",
    });
  });
}

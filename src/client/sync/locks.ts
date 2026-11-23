/**
 * Single-flight sync across tabs (spec §12.6/§12.10): Web Locks API when available, otherwise
 * a lease in Dexie `meta` (expires so a crashed tab can't block sync forever).
 * Returns undefined (without running `fn`) when another tab holds the lock.
 */
import { v7 as uuidv7 } from "uuid";
import { currentDbName, db } from "../db/dexie";
import { META } from "../db/meta";

const LEASE_MS = 60_000;
const tabId = uuidv7();

interface Lease {
  owner: string;
  until: number;
}

export async function withSyncLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return locks.request(`dk-sync:${currentDbName()}`, { ifAvailable: true }, async (lock) =>
      lock ? fn() : undefined,
    );
  }
  return withMetaLock(fn);
}

export async function withMetaLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
  const d = db();
  const acquired = await d.transaction("rw", d.meta, async () => {
    const row = await d.meta.get(META.syncLock);
    const lease = row?.value as Lease | undefined;
    if (lease && lease.owner !== tabId && lease.until > Date.now()) return false;
    await d.meta.put({ key: META.syncLock, value: { owner: tabId, until: Date.now() + LEASE_MS } });
    return true;
  });
  if (!acquired) return undefined;
  try {
    return await fn();
  } finally {
    await d.transaction("rw", d.meta, async () => {
      const lease = (await d.meta.get(META.syncLock))?.value as Lease | undefined;
      if (lease?.owner === tabId) await d.meta.delete(META.syncLock);
    });
  }
}

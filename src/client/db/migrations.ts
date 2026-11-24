/**
 * Dexie schema versions. RULE (spec §3.4): migrations are ADDITIVE ONLY.
 *  - Never delete a table (no `null` store), never rename one.
 *  - Never remove or change an existing index; only append new indexes or new tables.
 *  - Data transforms go in an `upgrade` callback and must never drop user data.
 * `assertAdditive` enforces this for every consecutive pair of versions (tested).
 */
import type Dexie from "dexie";

export type StoreSpec = Record<string, string>;

export interface SchemaVersion {
  version: number;
  stores: StoreSpec;
  upgrade?: Parameters<ReturnType<Dexie["version"]>["upgrade"]>[0];
}

/** Schema v1, exactly as spec §8.6. */
export const SCHEMA_V1: StoreSpec = {
  godowns: "_id, code, status",
  parties:
    "_id, godownId, [godownId+name], [godownId+phone], [godownId+searchKey], *roles, serverSeq",
  varieties: "_id, godownId",
  bankAccounts: "_id, godownId",
  vehicles: "_id, godownId, [godownId+number]",
  places: "_id, godownId",
  expenseCategories: "_id, godownId, [godownId+code]",
  vouchers:
    "_id, godownId, [godownId+type+date], [godownId+date], [godownId+partyId+date], number, [godownId+groupId], [godownId+loadId], status, serverSeq",
  ledgerLines: "_id, voucherId, [godownId+account+date], [godownId+partyId+date], [godownId+date]",
  stockMoves: "_id, voucherId, [godownId+varietyId+location], [godownId+date]",
  dailyAgg: "[godownId+date]",
  reminders: "_id, [godownId+dueDate], [godownId+status], partyId",
  dayStatus: "_id, [godownId+date]",
  outbox: "++seq, opId, status, godownId, entity, entityId",
  meta: "key",
  auditLocal: "++id, at, godownId",
};

/** v2 (Phase 4): pending inter-godown receipts pulled from the server (additive). */
export const SCHEMA_V2: StoreSpec = {
  transfers: "_id, godownId, [godownId+status]",
};

/** v3 (Phase 5): client error reports waiting to be uploaded (spec §16). */
export const SCHEMA_V3: StoreSpec = {
  clientErrors: "++id, at",
};

export const SCHEMA_VERSIONS: readonly SchemaVersion[] = [
  { version: 1, stores: SCHEMA_V1 },
  { version: 2, stores: SCHEMA_V2 },
  { version: 3, stores: SCHEMA_V3 },
];

function indexList(spec: string): string[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Throws if `next` drops/renames a table or removes/changes an index of `prev`. */
export function assertAdditive(prev: StoreSpec, next: StoreSpec): void {
  for (const [table, spec] of Object.entries(prev)) {
    const nextSpec = next[table];
    if (nextSpec === undefined) continue; // omitted = unchanged in Dexie
    if (nextSpec === null) throw new Error(`Migration deletes table "${table}"`);
    const a = indexList(spec);
    const b = indexList(nextSpec);
    if (a[0] !== b[0]) throw new Error(`Migration changes primary key of "${table}"`);
    for (const idx of a) {
      if (!b.includes(idx)) throw new Error(`Migration removes index "${idx}" from "${table}"`);
    }
  }
}

export function applyVersions(db: Dexie, versions: readonly SchemaVersion[] = SCHEMA_VERSIONS) {
  let prev: StoreSpec | null = null;
  for (const v of versions) {
    if (prev) assertAdditive(prev, v.stores);
    const ver = db.version(v.version).stores(v.stores);
    if (v.upgrade) ver.upgrade(v.upgrade);
    prev = { ...(prev ?? {}), ...v.stores };
  }
}

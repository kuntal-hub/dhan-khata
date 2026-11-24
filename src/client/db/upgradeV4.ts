/**
 * Dexie v3 → v4 upgrade (requirement_v2). Runs once, inside Dexie's versionchange transaction.
 *
 * The server is migrated first (`scripts/migrate-v2.ts`) and is the source of truth, so the
 * device does NOT convert synced data itself: it re-downloads everything (cursor → 0).
 * Unsynced work is never dropped: every pending v1 outbox op — together with ALL local v1
 * documents, which the converter needs as context (FIFO, linked groups, cheques) — is moved to
 * the `legacyV1` meta record. After the first v2 pull (when the business id is known),
 * `replayLegacyV1` (src/client/sync/legacy.ts) converts those ops with the shared converter and
 * queues them again as v2 operations.
 */
import type { Transaction } from "dexie";

export const LEGACY_V1_KEY = "legacyV1";

export interface LegacyV1Hold {
  heldAt: string;
  /** Pending v1 outbox ops (any entity), in seq order. */
  ops: unknown[];
  /** Every local v1 voucher (conversion context). */
  vouchers: unknown[];
  /** v1 master documents that have pending ops (converted with `migrateParty` etc.). */
  masters: Record<string, unknown[]>;
}

const BUSINESS_TABLES = [
  "vouchers",
  "ledgerLines",
  "stockMoves",
  "dailyAgg",
  "reminders",
  "transfers",
  "parties",
  "varieties",
  "bankAccounts",
  "vehicles",
  "places",
  "expenseCategories",
  "godowns",
  "dayStatus",
] as const;

export async function upgradeToV4(tx: Transaction): Promise<void> {
  const outbox = await tx.table("outbox").orderBy("seq").toArray();
  if (outbox.length > 0) {
    const vouchers = await tx.table("vouchers").toArray();
    const masters: Record<string, unknown[]> = {};
    const tableOf: Record<string, string> = {
      party: "parties",
      variety: "varieties",
      bankAccount: "bankAccounts",
      vehicle: "vehicles",
      place: "places",
      expenseCategory: "expenseCategories",
    };
    for (const op of outbox as Array<{ entity: string; entityId: string }>) {
      const table = tableOf[op.entity];
      if (!table) continue;
      const doc = await tx.table(table).get(op.entityId);
      if (doc) masters[op.entity] = [...(masters[op.entity] ?? []), doc];
    }
    const hold: LegacyV1Hold = { heldAt: new Date().toISOString(), ops: outbox, vouchers, masters };
    await tx.table("meta").put({ key: LEGACY_V1_KEY, value: hold });
    await tx.table("outbox").clear();
  }
  for (const t of BUSINESS_TABLES) await tx.table(t).clear();
  // Full re-download of the migrated server data; godown settings come back with it.
  await tx.table("meta").put({ key: "cursor", value: 0 });
  const metaKeys = (await tx.table("meta").toCollection().primaryKeys()) as string[];
  for (const k of metaKeys) {
    if (
      k.startsWith("godownSettings:") ||
      k.startsWith("formDraft:") ||
      k.startsWith("lastUsed:")
    ) {
      await tx.table("meta").delete(k);
    }
  }
  await tx.table("meta").delete("access");
  await tx.table("meta").delete("pendingPurge");
}

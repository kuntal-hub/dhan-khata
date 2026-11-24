/**
 * Replay unsynced v1 work held by the Dexie v4 upgrade (see db/upgradeV4.ts).
 *
 * Runs after a pull, once the session knows the business id. The held v1 documents are
 * converted with the same pure converter the server migration used (so ids and revs match),
 * and each pending v1 op becomes ops for the v2 documents made from it, in ONE transaction.
 * Pending reminder / settings ops are not replayed (they are re-entered in v2; listed in
 * docs/MIGRATION_V2.md). The hold is deleted only after the transaction commits.
 */
import { v7 as uuidv7 } from "uuid";
import {
  migrateParty,
  migrateV1Vouchers,
  migrateVariety,
  withBusiness,
} from "@/domain/legacy/migrateV1";
import type { Voucher as V1Voucher } from "@/domain/legacy/v1Vouchers";
import { applyDocDerived } from "@/domain/v2/derive";
import { db, writeTables } from "../db/dexie";
import { META, deleteMeta, getMeta, getSession } from "../db/meta";
import { LEGACY_V1_KEY, type LegacyV1Hold } from "../db/upgradeV4";
import { masterTable } from "../repo/masters";
import { dexieDerivedStore } from "../repo/derivedStore";
import { emitLocalWrite } from "../repo/notify";
import type { MasterEntity } from "@/domain/schemas";

interface HeldOp {
  opId: string;
  godownId: string | null;
  entity: string;
  entityId: string;
  op: "upsert" | "void";
  baseRev: number;
  createdAt: string;
  fields?: string[];
}

export async function replayLegacyV1(): Promise<{ ops: number } | null> {
  const hold = await getMeta<LegacyV1Hold>(LEGACY_V1_KEY);
  const session = await getSession();
  if (!hold || !session?.user.businessId) return null;
  const businessId = session.user.businessId;
  const d = db();
  const ops = hold.ops as HeldOp[];
  const banks = await d.bankAccounts.toArray();
  const parties = await d.parties.toArray();
  const converted = migrateV1Vouchers(hold.vouchers as V1Voucher[], {
    businessId,
    defaultBankOf: (g) => banks.find((b) => b.godownId === g && b.status === "active")?._id,
    partyName: (id) => parties.find((p) => p._id === id)?.name,
  });
  const byId = new Map(converted.docs.map((x) => [x._id, x] as const));
  let written = 0;
  await d.transaction("rw", writeTables(d), async () => {
    const opGroup = uuidv7();
    const now = new Date().toISOString();
    for (const op of ops) {
      if (op.entity === "voucher") {
        for (const id of converted.produced.get(op.entityId) ?? []) {
          const doc = byId.get(id);
          if (!doc) continue;
          const prev = await d.vouchers.get(id);
          await d.vouchers.put(doc);
          await applyDocDerived(dexieDerivedStore, doc, prev);
          await d.outbox.add({
            opId: uuidv7(),
            godownId: doc.godownId,
            entity: "voucher",
            entityId: id,
            op: doc.status === "void" ? "void" : "upsert",
            baseRev: op.baseRev,
            payload: doc,
            createdAt: now,
            attempts: 0,
            status: "pending",
            opGroup,
          });
          written++;
        }
      } else if (
        ["party", "variety", "bankAccount", "vehicle", "place", "expenseCategory"].includes(
          op.entity,
        )
      ) {
        const raw = (hold.masters[op.entity] ?? []).find(
          (m) => (m as { _id: string })._id === op.entityId,
        ) as Record<string, unknown> | undefined;
        if (!raw) continue;
        const next =
          op.entity === "party"
            ? migrateParty(raw, businessId)
            : op.entity === "variety"
              ? migrateVariety(raw, businessId)
              : withBusiness(raw, businessId);
        await (
          masterTable(op.entity as MasterEntity, d) as unknown as {
            put(v: unknown): Promise<unknown>;
          }
        ).put(next);
        await d.outbox.add({
          opId: uuidv7(),
          godownId: op.godownId,
          entity: op.entity,
          entityId: op.entityId,
          op: "upsert",
          baseRev: op.baseRev,
          payload: next,
          createdAt: now,
          attempts: 0,
          status: "pending",
          ...(op.fields ? { fields: op.fields } : {}),
        });
        written++;
      }
    }
    await deleteMeta(META.legacyV1);
  });
  emitLocalWrite();
  return { ops: written };
}

/**
 * Server data migration v1 → v2 (requirement_v2), used by `scripts/migrate-v2.ts`.
 *
 *  plan:  read everything, convert with the shared pure converter (`domain/legacy/migrateV1`),
 *         re-post the v2 documents and RECONCILE against the stored v1 ledger lines / stock moves
 *         (every party, cash, bank and paddy stock figure must match; only the listed v2
 *         semantic changes may differ).
 *  apply: write the converted data in ONE transaction and append changelog entries so every
 *         device re-downloads. Idempotent: a `migrations` marker stops a second run.
 */
import type { Db } from "mongodb";
import { v7 as uuidv7 } from "uuid";
import { DomainError } from "@/domain/errors";
import {
  migrateParty,
  migrateV1Vouchers,
  migrateVariety,
  withBusiness,
  type MigrationNote,
} from "@/domain/legacy/migrateV1";
import { reconcile, type ReconReport } from "@/domain/legacy/reconcile";
import type { Voucher as V1Voucher } from "@/domain/legacy/v1Vouchers";
import {
  BankAccountSchema,
  ExpenseCategorySchema,
  PartySchema,
  PlaceSchema,
  ReminderSchema,
  VarietySchema,
  VehicleSchema,
  type Business,
  type Doc,
} from "@/domain/schemas";
import { EXPENSE_CATEGORY_CODES_V2 } from "@/domain/v2/accounts";
import { deriveAll } from "@/domain/v2/replay";
import { DEFAULT_MON_KG } from "@/domain/units";
import { logChanges, type ChangeEntry } from "./changelog";
import { publicDoc, toDbLine, toDbMove } from "./convert";
import { cols, getMongoClient } from "./db";

export const MIGRATION_ID = "v2";

type Raw = Record<string, unknown> & { _id: string };

const MASTER_COLLECTIONS = {
  parties: { entity: "party", schema: PartySchema },
  varieties: { entity: "variety", schema: VarietySchema },
  bankAccounts: { entity: "bankAccount", schema: BankAccountSchema },
  vehicles: { entity: "vehicle", schema: VehicleSchema },
  places: { entity: "place", schema: PlaceSchema },
  expenseCategories: { entity: "expenseCategory", schema: ExpenseCategorySchema },
} as const;
type MasterCollection = keyof typeof MASTER_COLLECTIONS;

export interface MigrationPlan {
  alreadyDone: boolean;
  business: Business;
  businessIsNew: boolean;
  godownIds: string[];
  docs: Doc[];
  masters: Record<MasterCollection, Raw[]>;
  reminders: Raw[];
  /** v1 reminder ids that are dropped (automatic ones; v2 derives them from due dates). */
  droppedReminders: string[];
  notes: MigrationNote[];
  counts: Record<string, number>;
  recon: ReconReport;
}

function stripMeta(d: Raw): Raw {
  const { _m: _meta, serverSeq: _seq, ...rest } = d as Raw & { _m?: unknown; serverSeq?: unknown };
  return rest as Raw;
}

export async function planMigration(db: Db): Promise<MigrationPlan> {
  const k = cols(db);
  const marker = await db.collection<{ _id: string }>("migrations").findOne({ _id: MIGRATION_ID });
  const owners = await k.users.find({ isOwner: true }).toArray();
  if (owners.length !== 1)
    throw new DomainError("VALIDATION_FAILED", `expected one owner, found ${owners.length}`);
  const owner = owners[0]!;
  const godowns = await k.godowns.find({}).toArray();
  const existingBusiness = owner.businessId
    ? await k.businesses.findOne({ _id: owner.businessId })
    : null;
  const vouchers = (await k.vouchers.find({}).toArray()) as unknown as V1Voucher[];
  const deductionsUsed = vouchers.some(
    (v) =>
      "lines" in v &&
      Array.isArray(v.lines) &&
      v.lines.some(
        (l) => "grossG" in l && (l.tarePerBagG || l.dhaltaMode || l.moistureBps || l.otherDedG),
      ),
  );
  const now = new Date().toISOString();
  const business: Business = existingBusiness ?? {
    _id: uuidv7(),
    name: (godowns[0]?.firmName ?? owner.name).trim(),
    ...(godowns[0]?.address ? { address: godowns[0].address } : {}),
    mobile: owner.phone,
    ownerUserId: owner._id,
    monKg: DEFAULT_MON_KG,
    settings: { deductionsEnabled: deductionsUsed },
    rev: 1,
    createdAt: now,
    updatedAt: now,
  };
  const businessId = business._id;

  // Masters.
  const masters = {} as Record<MasterCollection, Raw[]>;
  for (const c of Object.keys(MASTER_COLLECTIONS) as MasterCollection[]) {
    const docs = (await db.collection<Raw>(c).find({}).toArray()) as Raw[];
    masters[c] = docs.map((d) => {
      if (c === "parties") return migrateParty(d, businessId) as Raw;
      if (c === "varieties") return migrateVariety(d, businessId) as Raw;
      return withBusiness(d, businessId);
    });
  }
  // v2 system expense categories missing in a Gola.
  for (const g of godowns) {
    const have = new Set(
      masters.expenseCategories.filter((c) => c.godownId === g._id).map((c) => c.code),
    );
    for (const code of EXPENSE_CATEGORY_CODES_V2) {
      if (have.has(code)) continue;
      masters.expenseCategories.push({
        _id: uuidv7(),
        businessId,
        godownId: g._id,
        code,
        isSystem: true,
        enabled: true,
        rev: 1,
        createdAt: now,
        createdBy: owner._id,
        deviceId: "server",
        updatedAt: now,
        updatedBy: owner._id,
        status: "active",
      });
    }
  }
  for (const c of Object.keys(MASTER_COLLECTIONS) as MasterCollection[]) {
    for (const d of masters[c]) {
      const r = MASTER_COLLECTIONS[c].schema.safeParse(stripMeta(d));
      if (!r.success) {
        throw new DomainError(
          "VALIDATION_FAILED",
          `${c}:${d._id}: ${r.error.issues[0]?.path.join(".")}`,
        );
      }
    }
  }

  // Reminders: manual ones are kept; automatic ones are derived from due dates in v2.
  const reminders: Raw[] = [];
  const droppedReminders: string[] = [];
  for (const r of (await db.collection<Raw>("reminders").find({}).toArray()) as Raw[]) {
    if (r.kind !== "CUSTOM") {
      droppedReminders.push(r._id);
      continue;
    }
    const { voucherId: _v, ...rest } = stripMeta(r) as Raw & { voucherId?: unknown };
    const next = { ...rest, businessId, kind: "CUSTOM" } as Raw;
    const ok = ReminderSchema.safeParse(next);
    if (!ok.success) throw new DomainError("VALIDATION_FAILED", `reminder:${r._id}`);
    reminders.push(next);
  }

  // Documents.
  const banks = masters.bankAccounts.filter((b) => b.status === "active");
  const partyNames = new Map(masters.parties.map((p) => [p._id, String(p.name)] as const));
  const plan = marker
    ? { docs: (await k.vouchers.find({}).toArray()) as Doc[], notes: [], counts: {} }
    : migrateV1Vouchers(vouchers, {
        businessId,
        defaultBankOf: (g) => banks.find((b) => b.godownId === g)?._id,
        partyName: (id) => partyNames.get(id),
      });

  const v1Lines = marker ? [] : await k.ledgerLines.find({}).toArray();
  const v1Moves = marker
    ? []
    : ((await k.stockMoves.find({}).toArray()) as unknown as Array<{
        godownId: string;
        varietyId: string;
        location: string;
        qtyG: bigint;
        valuePaise: bigint;
      }>);
  const recon = marker
    ? { ok: true, checked: 0, diffs: [] }
    : reconcile(v1Lines, v1Moves, plan.docs, plan.notes);

  return {
    alreadyDone: !!marker,
    business,
    businessIsNew: !existingBusiness,
    godownIds: godowns.map((g) => g._id),
    docs: plan.docs,
    masters,
    reminders,
    droppedReminders,
    notes: plan.notes,
    counts: plan.counts,
    recon,
  };
}

/** Write a reconciled plan. Throws when the plan did not reconcile or was already applied. */
export async function applyMigration(db: Db, plan: MigrationPlan): Promise<{ changelog: number }> {
  if (plan.alreadyDone) throw new DomainError("VALIDATION_FAILED", "already migrated");
  if (!plan.recon.ok) throw new DomainError("VALIDATION_FAILED", "reconciliation failed");
  const k = cols(db);
  const businessId = plan.business._id;
  const derived = deriveAll(plan.docs);
  const client = await getMongoClient();
  let changes = 0;
  await client.withSession((session) =>
    session.withTransaction(async () => {
      if (plan.businessIsNew) await k.businesses.insertOne(plan.business, { session });
      await k.users.updateMany({}, { $set: { businessId } }, { session });
      await k.godowns.updateMany({}, { $set: { businessId } }, { session });
      const colours = ["green", "gold", "teal", "rose", "indigo", "amber"];
      const godowns = await k.godowns.find({}, { session }).sort({ createdAt: 1 }).toArray();
      for (let i = 0; i < godowns.length; i++) {
        if (!godowns[i]!.colour) {
          await k.godowns.updateOne(
            { _id: godowns[i]!._id },
            { $set: { colour: colours[i % colours.length]! } },
            { session },
          );
        }
      }

      const entries: ChangeEntry[] = [
        { godownId: null, entity: "business", entityId: businessId, rev: plan.business.rev },
        ...godowns.map((g) => ({ godownId: null, entity: "godown", entityId: g._id, rev: g.rev })),
        ...(await k.users.find({}, { session }).toArray()).map((u) => ({
          godownId: null,
          entity: "user",
          entityId: u._id,
          rev: u.rev ?? 1,
        })),
      ];

      for (const c of Object.keys(MASTER_COLLECTIONS) as MasterCollection[]) {
        const coll = db.collection<Raw>(c);
        for (const d of plan.masters[c]) {
          await coll.replaceOne({ _id: d._id }, d, { upsert: true, session });
          entries.push({
            godownId: String(d.godownId),
            entity: MASTER_COLLECTIONS[c].entity,
            entityId: d._id,
            rev: Number(d.rev ?? 1),
          });
        }
      }
      const remColl = db.collection<Raw>("reminders");
      if (plan.droppedReminders.length)
        await remColl.deleteMany({ _id: { $in: plan.droppedReminders } }, { session });
      for (const r of plan.reminders) {
        await remColl.replaceOne({ _id: r._id }, r, { upsert: true, session });
        entries.push({
          godownId: String(r.godownId),
          entity: "reminder",
          entityId: r._id,
          rev: Number(r.rev ?? 1),
        });
      }

      await k.vouchers.deleteMany({}, { session });
      if (plan.docs.length) await k.vouchers.insertMany(plan.docs, { session });
      for (const d of plan.docs)
        entries.push({ godownId: d.godownId, entity: "voucher", entityId: d._id, rev: d.rev });
      await k.ledgerLines.deleteMany({}, { session });
      await k.stockMoves.deleteMany({}, { session });
      if (derived.lines.length)
        await k.ledgerLines.insertMany(derived.lines.map(toDbLine), { session });
      if (derived.moves.length)
        await k.stockMoves.insertMany(derived.moves.map(toDbMove), { session });

      await k.transfers.deleteMany({}, { session });
      await k.dayStatus.updateMany({}, { $unset: { lateEntry: "" } }, { session });
      for (const s of await k.godownSettings.find({}, { session }).toArray()) {
        entries.push({
          godownId: s.godownId,
          entity: "godownSettings",
          entityId: s._id,
          rev: s.rev,
        });
      }
      for (const s of await k.dayStatus.find({}, { session }).toArray()) {
        entries.push({ godownId: s.godownId, entity: "dayStatus", entityId: s._id, rev: 1 });
      }

      for (let i = 0; i < entries.length; i += 1000) {
        const chunk = entries.slice(i, i + 1000);
        const seqs = await logChanges(db, session, chunk);
        for (let j = 0; j < chunk.length; j++) {
          const e = chunk[j]!;
          const coll = COLLECTION_OF[e.entity];
          if (coll) {
            await db
              .collection<Raw>(coll)
              .updateOne({ _id: e.entityId }, { $set: { serverSeq: seqs[j]! } }, { session });
          }
        }
      }
      changes = entries.length;
      await db.collection<Raw>("migrations").insertOne(
        {
          _id: MIGRATION_ID,
          at: new Date().toISOString(),
          counts: plan.counts,
          notes: plan.notes.length,
          diffs: plan.recon.diffs,
        },
        { session },
      );
    }),
  );
  return { changelog: changes };
}

const COLLECTION_OF: Record<string, string> = {
  business: "businesses",
  godown: "godowns",
  user: "users",
  party: "parties",
  variety: "varieties",
  bankAccount: "bankAccounts",
  vehicle: "vehicles",
  place: "places",
  expenseCategory: "expenseCategories",
  voucher: "vouchers",
  reminder: "reminders",
  godownSettings: "godownSettings",
};

/** Human summary of a plan (printed by the script). */
export function summarizePlan(plan: MigrationPlan): string {
  const lines: string[] = [];
  lines.push(plan.alreadyDone ? "Already migrated (marker present)." : "Migration plan (v1 → v2):");
  lines.push(
    `  business: ${plan.business.name} (${plan.businessIsNew ? "new" : "existing"}) ${plan.business._id}`,
  );
  lines.push(`  golas: ${plan.godownIds.length}`);
  lines.push(`  v1 vouchers by type: ${JSON.stringify(plan.counts)}`);
  const byType: Record<string, number> = {};
  for (const d of plan.docs) byType[d.type] = (byType[d.type] ?? 0) + 1;
  lines.push(`  v2 documents by type: ${JSON.stringify(byType)}`);
  const noteKinds: Record<string, number> = {};
  for (const n of plan.notes) noteKinds[n.kind] = (noteKinds[n.kind] ?? 0) + 1;
  lines.push(`  conversion notes: ${JSON.stringify(noteKinds)}`);
  lines.push(
    `  reminders kept: ${plan.reminders.length}, automatic dropped: ${plan.droppedReminders.length}`,
  );
  lines.push(
    `  reconciliation: ${plan.recon.ok ? "OK" : "FAILED"} (${plan.recon.checked} figures checked)`,
  );
  for (const d of plan.recon.diffs) {
    lines.push(
      `    ${d.allowed ? "allowed" : "DIFF   "} ${d.godownId} ${d.what}: ${d.beforePaiseOrG} → ${d.afterPaiseOrG}${d.reason ? ` (${d.reason})` : ""}`,
    );
  }
  return lines.join("\n");
}

export { publicDoc };

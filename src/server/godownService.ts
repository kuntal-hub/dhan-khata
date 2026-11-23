/**
 * Godown lifecycle (spec §1.4 rule 7): owner-only and online. Creating a godown writes the
 * godown, its unique code, the seeded chart of accounts, the TRANSIT location, seeded varieties
 * and expense categories (§24) and default GodownSettings — all in one transaction.
 * A godown can be archived (read-only) but never deleted.
 */
import { MongoServerError, type Db } from "mongodb";
import { v7 as uuidv7 } from "uuid";
import {
  OPTIONAL_EXPENSE_CODES,
  SEED_VARIETY_KEYS,
  SYSTEM_EXPENSE_CODES,
  seedChartOfAccounts,
} from "@/domain/posting/accounts";
import {
  CreateGodownRequestSchema,
  defaultGodownSettings,
  type CreateGodownRequest,
  type ExpenseCategory,
  type Godown,
  type Variety,
} from "@/domain/schemas";
import { audit, logChanges, type ChangeEntry } from "./changelog";
import { cols, getMongoClient, type UserDoc } from "./db";
import { ApiError } from "./http";

export const SERVER_DEVICE_ID = "server";

function assertOwner(user: UserDoc): void {
  if (!user.isOwner || !user.active) throw new ApiError(403, "FORBIDDEN");
}

export async function createGodown(
  db: Db,
  owner: UserDoc,
  input: CreateGodownRequest,
  deviceId: string = SERVER_DEVICE_ID,
): Promise<Godown> {
  assertOwner(owner);
  const req = CreateGodownRequestSchema.parse(input);
  const now = new Date().toISOString();
  const godownId = uuidv7();
  const godown: Godown = {
    _id: godownId,
    rev: 1,
    createdAt: now,
    updatedAt: now,
    code: req.code,
    name: req.name,
    ...(req.nameAlt ? { nameAlt: req.nameAlt } : {}),
    ...(req.firmName ? { firmName: req.firmName } : {}),
    ...(req.address ? { address: req.address } : {}),
    ...(req.phone ? { phone: req.phone } : {}),
    receiptLanguage: req.receiptLanguage ?? "bn",
    status: "active",
  };
  const base = {
    godownId,
    rev: 1,
    createdAt: now,
    createdBy: owner._id,
    deviceId: SERVER_DEVICE_ID,
    updatedAt: now,
    updatedBy: owner._id,
    status: "active" as const,
  };
  const varieties: Variety[] = SEED_VARIETY_KEYS.map((key) => ({
    ...base,
    _id: uuidv7(),
    name: "",
    systemKey: key,
  }));
  const categories: ExpenseCategory[] = [...SYSTEM_EXPENSE_CODES, ...OPTIONAL_EXPENSE_CODES].map(
    (code) => ({ ...base, _id: uuidv7(), code, isSystem: true, enabled: true }),
  );
  const settings = defaultGodownSettings(godownId, now);

  const client = await getMongoClient();
  try {
    await client.withSession((session) =>
      session.withTransaction(async () => {
        const k = cols(db);
        await k.godowns.insertOne(godown, { session });
        await k.accounts.insertMany(
          seedChartOfAccounts(godownId).map((a) => ({ _id: `${godownId}:${a.key}`, ...a })),
          { session },
        );
        await k.locations.insertOne(
          {
            _id: `${godownId}:TRANSIT`,
            godownId,
            code: "TRANSIT",
            system: true,
            i18nKey: "stock.transit",
          },
          { session },
        );
        await k.varieties.insertMany(varieties, { session });
        await k.expenseCategories.insertMany(categories, { session });
        await k.godownSettings.insertOne(settings, { session });
        const entries: ChangeEntry[] = [
          { godownId: null, entity: "godown", entityId: godownId, rev: 1 },
          ...varieties.map((v) => ({ godownId, entity: "variety", entityId: v._id, rev: 1 })),
          ...categories.map((c) => ({
            godownId,
            entity: "expenseCategory",
            entityId: c._id,
            rev: 1,
          })),
          { godownId, entity: "godownSettings", entityId: godownId, rev: 1 },
        ];
        const seqs = await logChanges(db, session, entries);
        await k.godowns.updateOne({ _id: godownId }, { $set: { serverSeq: seqs[0] } }, { session });
        await audit(db, session, {
          userId: owner._id,
          deviceId,
          godownId,
          entity: "godown",
          entityId: godownId,
          action: "create",
        });
      }),
    );
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) {
      throw new ApiError(409, "GODOWN_CODE_TAKEN");
    }
    throw e;
  }
  return godown;
}

/** Archive a godown: it becomes read-only everywhere (the server rejects writes to it). */
export async function archiveGodown(
  db: Db,
  owner: UserDoc,
  godownId: string,
  deviceId: string = SERVER_DEVICE_ID,
): Promise<void> {
  assertOwner(owner);
  const client = await getMongoClient();
  await client.withSession((session) =>
    session.withTransaction(async () => {
      const k = cols(db);
      const g = await k.godowns.findOne({ _id: godownId }, { session });
      if (!g) throw new ApiError(404, "NOT_FOUND");
      if (g.status === "archived") return;
      const rev = g.rev + 1;
      const [seq] = await logChanges(db, session, [
        { godownId: null, entity: "godown", entityId: godownId, rev },
      ]);
      await k.godowns.updateOne(
        { _id: godownId },
        { $set: { status: "archived", rev, updatedAt: new Date().toISOString(), serverSeq: seq } },
        { session },
      );
      await audit(db, session, {
        userId: owner._id,
        deviceId,
        godownId,
        entity: "godown",
        entityId: godownId,
        action: "archive",
      });
    }),
  );
}

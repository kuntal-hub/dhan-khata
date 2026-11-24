/**
 * Owner/admin services (spec §6.6, §9.16, §16, §17): integrity, storage usage, users & devices,
 * app settings, preferences, password, client error reports, backup / restore, year close.
 * Every godown-scoped read checks the caller's access (godown isolation on the server).
 */
import type { Db } from "mongodb";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { todayIST } from "@/domain/dates";
import { accountTotals, repostMismatches, trialOf } from "@/domain/integrity";
import { serializeDerived } from "@/domain/posting/derive";
import { replay } from "@/domain/posting/replay";
import { roleIn } from "@/domain/rbac";
import { GodownRoleSchema, type Voucher } from "@/domain/schemas";
import { hashPassword, publicUser, verifyPassword } from "./auth";
import { audit, logChanges, type ChangeEntry } from "./changelog";
import { fromDbLine, publicDoc, toDbLine, toDbMove } from "./convert";
import { cols, getMongoClient, type UserDoc } from "./db";
import { ApiError } from "./http";
import { getAppSettings } from "./push";
import { godownIdsFor } from "./rbac";
import { createUser, revokeDevice, setGodownAccess } from "./users";

export function assertOwner(user: UserDoc): void {
  if (!user.isOwner || !user.active) throw new ApiError(403, "FORBIDDEN");
}

async function assertGodownAccess(db: Db, user: UserDoc, godownId: string): Promise<void> {
  if (!roleIn(user, godownId)) throw new ApiError(403, "FORBIDDEN");
  const g = await cols(db).godowns.findOne({ _id: godownId });
  if (!g) throw new ApiError(404, "NOT_FOUND");
}

// ── Integrity (§6.6) ─────────────────────────────────────────────────────────

export interface ServerIntegrity {
  godownId: string;
  accounts: Record<string, string>;
  debitPaise: string;
  creditPaise: string;
  balanced: boolean;
  voucherCount: number;
  /** Vouchers whose stored lines differ from a fresh re-posting on the server. */
  repostMismatches: string[];
}

/** Owner only (spec §6.6.4): the server's per-account totals + its own checks for one godown. */
export async function serverIntegrity(
  db: Db,
  user: UserDoc,
  godownId: string,
): Promise<ServerIntegrity> {
  assertOwner(user);
  await assertGodownAccess(db, user, godownId);
  const k = cols(db);
  const [lines, vouchers] = await Promise.all([
    k.ledgerLines.find({ godownId }).toArray(),
    k.vouchers.find({ godownId }).toArray(),
  ]);
  const wire = lines.map(fromDbLine);
  const tb = trialOf(wire);
  return {
    godownId,
    accounts: accountTotals(wire),
    debitPaise: tb.debitPaise.toString(),
    creditPaise: tb.creditPaise.toString(),
    balanced: tb.balanced,
    voucherCount: vouchers.filter((v) => v.status === "active").length,
    repostMismatches: repostMismatches(vouchers as Voucher[], wire),
  };
}

/** Cron: refresh every godown's integrity summary (trial balance + counts). */
export async function recomputeIntegritySummaries(db: Db): Promise<number> {
  const k = cols(db);
  let n = 0;
  for (const g of await k.godowns.find({}).toArray()) {
    const [agg] = await k.ledgerLines
      .aggregate<{ dr: bigint | number; cr: bigint | number }>([
        { $match: { godownId: g._id } },
        { $group: { _id: null, dr: { $sum: "$debitPaise" }, cr: { $sum: "$creditPaise" } } },
      ])
      .toArray();
    const dr = BigInt(agg?.dr ?? 0);
    const cr = BigInt(agg?.cr ?? 0);
    await k.integritySummary.replaceOne(
      { _id: g._id },
      {
        at: new Date().toISOString(),
        balanced: dr === cr,
        totalDebitPaise: dr,
        totalCreditPaise: cr,
        voucherCount: await k.vouchers.countDocuments({ godownId: g._id, status: "active" }),
      },
      { upsert: true },
    );
    n++;
  }
  return n;
}

// ── Storage usage (§9.16, §17.3) ─────────────────────────────────────────────

const GODOWN_COLLECTIONS = [
  "vouchers",
  "ledgerLines",
  "stockMoves",
  "parties",
  "reminders",
  "changelog",
] as const;

export interface StorageUsage {
  totalBytes: number;
  limitBytes: number;
  godowns: Array<{ godownId: string; docs: number; approxBytes: number }>;
}

/** Owner: database size and an approximate per-godown share (documents × average size). */
export async function storageUsage(db: Db, user: UserDoc): Promise<StorageUsage> {
  assertOwner(user);
  const stats = (await db.command({ dbStats: 1 })) as { dataSize?: number; indexSize?: number };
  const k = cols(db);
  const avg: Record<string, number> = {};
  for (const c of GODOWN_COLLECTIONS) {
    const count = await db.collection(c).estimatedDocumentCount();
    const [s] = await db
      .collection(c)
      .aggregate<{ size: number }>([
        { $sample: { size: 50 } },
        { $group: { _id: null, size: { $avg: { $bsonSize: "$$ROOT" } } } },
      ])
      .toArray();
    avg[c] = count > 0 ? (s?.size ?? 0) : 0;
  }
  const godowns = [];
  for (const g of await k.godowns.find({}).toArray()) {
    let docs = 0;
    let bytes = 0;
    for (const c of GODOWN_COLLECTIONS) {
      const n = await db.collection(c).countDocuments({ godownId: g._id });
      docs += n;
      bytes += n * (avg[c] ?? 0);
    }
    godowns.push({ godownId: g._id, docs, approxBytes: Math.round(bytes) });
  }
  return {
    totalBytes: (stats.dataSize ?? 0) + (stats.indexSize ?? 0),
    limitBytes: 512 * 1024 * 1024,
    godowns,
  };
}

// ── Users & devices (§9.16 App) ──────────────────────────────────────────────

export const AccessSchema = z.array(
  z.strictObject({
    godownId: z.string().min(1).max(64),
    role: GodownRoleSchema,
    consolidated: z.boolean().optional(),
  }),
);

export const CreateUserSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  phone: z.string().min(10).max(15),
  password: z.string().min(6).max(200),
  language: z.enum(["bn", "en"]).optional(),
  godownAccess: AccessSchema,
});

export async function listUsers(db: Db, owner: UserDoc) {
  assertOwner(owner);
  const k = cols(db);
  const [users, devices] = await Promise.all([
    k.users.find({}).toArray(),
    k.devices.find({}).toArray(),
  ]);
  return {
    users: users.map(publicUser),
    devices: devices.map((d) => publicDoc(d)),
  };
}

export async function addUser(db: Db, owner: UserDoc, input: z.infer<typeof CreateUserSchema>) {
  assertOwner(owner);
  const settings = await getAppSettings(db);
  const existing = await cols(db).users.findOne({
    phone: input.phone.replace(/\D/g, "").slice(-10),
  });
  if (existing) throw new ApiError(409, "BAD_REQUEST", "phone");
  const u = await createUser(db, {
    name: input.name,
    phone: input.phone,
    password: input.password,
    language: input.language ?? settings.defaultLanguage,
    godownAccess: input.godownAccess,
  });
  await audit(db, undefined, {
    userId: owner._id,
    deviceId: "server",
    entity: "user",
    entityId: u._id,
    action: "create",
  });
  return publicUser(u);
}

export async function updateUserAccess(
  db: Db,
  owner: UserDoc,
  userId: string,
  access: z.infer<typeof AccessSchema>,
  active?: boolean,
) {
  assertOwner(owner);
  const k = cols(db);
  const u = await k.users.findOne({ _id: userId });
  if (!u) throw new ApiError(404, "NOT_FOUND");
  if (u.isOwner) throw new ApiError(400, "BAD_REQUEST", "owner");
  await setGodownAccess(db, userId, access);
  if (active !== undefined && active !== u.active) {
    const client = await getMongoClient();
    await client.withSession((session) =>
      session.withTransaction(async () => {
        const fresh = await k.users.findOne({ _id: userId }, { session });
        const rev = (fresh?.rev ?? 1) + 1;
        await k.users.updateOne(
          { _id: userId },
          { $set: { active, rev, updatedAt: new Date().toISOString() } },
          { session },
        );
        await logChanges(db, session, [{ godownId: null, entity: "user", entityId: userId, rev }]);
      }),
    );
    if (!active) await k.refreshTokens.deleteMany({ userId } as never);
  }
  await audit(db, undefined, {
    userId: owner._id,
    deviceId: "server",
    entity: "user",
    entityId: userId,
    action: "edit",
    detail: "access",
  });
}

export async function resetUserPassword(db: Db, owner: UserDoc, userId: string, password: string) {
  assertOwner(owner);
  if (password.length < 6) throw new ApiError(400, "BAD_REQUEST", "password");
  const r = await cols(db).users.updateOne(
    { _id: userId },
    { $set: { passwordHash: await hashPassword(password) } },
  );
  if (r.matchedCount === 0) throw new ApiError(404, "NOT_FOUND");
  await audit(db, undefined, {
    userId: owner._id,
    deviceId: "server",
    entity: "user",
    entityId: userId,
    action: "edit",
    detail: "password-reset",
  });
}

export async function revokeUserDevice(db: Db, owner: UserDoc, deviceId: string) {
  assertOwner(owner);
  await revokeDevice(db, deviceId, owner._id);
}

// ── Me: preferences + password ───────────────────────────────────────────────

export const PrefsSchema = z.strictObject({
  language: z.enum(["bn", "en"]),
  digits: z.enum(["bn", "en"]),
  name: z.string().trim().min(1).max(80).optional(),
});

/** Language/digits stored on the user record (synced to all their devices, spec §11.4). */
export async function setMyPrefs(db: Db, user: UserDoc, prefs: z.infer<typeof PrefsSchema>) {
  const client = await getMongoClient();
  await client.withSession((session) =>
    session.withTransaction(async () => {
      const k = cols(db);
      const fresh = await k.users.findOne({ _id: user._id }, { session });
      const rev = (fresh?.rev ?? 1) + 1;
      await k.users.updateOne(
        { _id: user._id },
        { $set: { ...prefs, rev, updatedAt: new Date().toISOString() } },
        { session },
      );
      await logChanges(db, session, [{ godownId: null, entity: "user", entityId: user._id, rev }]);
    }),
  );
}

export async function changeMyPassword(
  db: Db,
  user: UserDoc,
  current: string,
  next: string,
): Promise<void> {
  if (next.length < 6) throw new ApiError(400, "BAD_REQUEST", "password");
  if (!(await verifyPassword(user.passwordHash, current))) {
    throw new ApiError(401, "BAD_CREDENTIALS");
  }
  await cols(db).users.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(next) } },
  );
  await audit(db, undefined, {
    userId: user._id,
    deviceId: "server",
    entity: "user",
    entityId: user._id,
    action: "edit",
    detail: "password",
  });
}

export const AppSettingsSchema = z.strictObject({
  digestHour: z.number().int().min(0).max(23),
  defaultLanguage: z.enum(["bn", "en"]),
});

export async function setAppSettings(
  db: Db,
  owner: UserDoc,
  input: z.infer<typeof AppSettingsSchema>,
) {
  assertOwner(owner);
  await cols(db).appSettings.updateOne(
    { _id: "app" },
    { $set: { ...input, updatedAt: new Date().toISOString() } },
    { upsert: true },
  );
}

// ── Client error reports (§16) ───────────────────────────────────────────────

export const ClientErrorsSchema = z.strictObject({
  errors: z
    .array(
      z.strictObject({
        at: z.string().max(40),
        route: z.string().max(200),
        message: z.string().max(1000),
        stack: z.string().max(4000).optional(),
        appVersion: z.string().max(40).optional(),
      }),
    )
    .max(50),
});

export async function recordClientErrors(
  db: Db,
  user: UserDoc,
  deviceId: string,
  input: z.infer<typeof ClientErrorsSchema>,
): Promise<number> {
  if (input.errors.length === 0) return 0;
  await cols(db).clientErrors.insertMany(
    input.errors.map((e) => ({
      _id: uuidv7(),
      at: new Date(e.at),
      userId: user._id,
      deviceId,
      route: e.route,
      message: e.message,
      ...(e.stack ? { stack: e.stack } : {}),
      ...(e.appVersion ? { appVersion: e.appVersion } : {}),
    })),
  );
  return input.errors.length;
}

export async function listClientErrors(db: Db, owner: UserDoc) {
  assertOwner(owner);
  return cols(db).clientErrors.find({}).sort({ at: -1 }).limit(100).toArray();
}

// ── Backup / restore (§17.1–17.2) ────────────────────────────────────────────

export const BACKUP_FORMAT = "dhan-khata-backup";

/** Business collections in a backup; derived rows (lines/moves) are rebuilt on restore. */
const BACKUP_COLLECTIONS = [
  "godowns",
  "godownSettings",
  "accounts",
  "locations",
  "parties",
  "varieties",
  "bankAccounts",
  "vehicles",
  "places",
  "expenseCategories",
  "vouchers",
  "reminders",
  "dayStatus",
  "transfers",
] as const;
type BackupCollection = (typeof BACKUP_COLLECTIONS)[number];

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: string;
  godownIds: string[];
  collections: Record<BackupCollection, unknown[]>;
}

/** Owner: full backup of one godown or all godowns (JSON-safe; amounts stay decimal strings). */
export async function makeBackup(db: Db, owner: UserDoc, godownId?: string): Promise<Backup> {
  assertOwner(owner);
  const ids = godownId ? [godownId] : await godownIdsFor(db, owner);
  if (godownId) await assertGodownAccess(db, owner, godownId);
  const collections = {} as Record<BackupCollection, unknown[]>;
  for (const c of BACKUP_COLLECTIONS) {
    const filter = c === "godowns" ? { _id: { $in: ids } } : { godownId: { $in: ids } };
    const docs = await db
      .collection(c)
      .find(filter as never)
      .toArray();
    collections[c] = docs.map((d) => {
      const { serverSeq: _s, ...rest } = publicDoc(d) as Record<string, unknown>;
      return rest;
    });
  }
  await audit(db, undefined, {
    userId: owner._id,
    deviceId: "server",
    ...(godownId ? { godownId } : {}),
    entity: "backup",
    entityId: godownId ?? "all",
    action: "export",
  });
  return {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    godownIds: ids,
    collections,
  };
}

/**
 * Restore a backup into a database that has NO godowns yet (spec §17.2): inserts every document,
 * rebuilds ledger lines and stock moves by re-posting in canonical order, and writes changelog
 * entries so devices download everything. Returns per-collection counts.
 */
export async function restoreBackup(
  db: Db,
  owner: UserDoc | null,
  backup: Backup,
): Promise<Record<string, number>> {
  if (owner) assertOwner(owner);
  if (backup.format !== BACKUP_FORMAT || backup.version !== 1) {
    throw new ApiError(400, "BAD_REQUEST", "format");
  }
  const k = cols(db);
  if ((await k.godowns.countDocuments({})) > 0) throw new ApiError(409, "BAD_REQUEST", "not-empty");
  const counts: Record<string, number> = {};
  const client = await getMongoClient();
  await client.withSession((session) =>
    session.withTransaction(async () => {
      const entries: ChangeEntry[] = [];
      for (const c of BACKUP_COLLECTIONS) {
        const docs = (backup.collections[c] ?? []) as Array<Record<string, unknown>>;
        counts[c] = docs.length;
        if (docs.length === 0) continue;
        await db.collection(c).insertMany(docs as never[], { session });
        if (c === "accounts" || c === "locations") continue;
        for (const d of docs) {
          entries.push({
            godownId: c === "godowns" ? null : String(d.godownId),
            entity: c === "godowns" ? "godown" : (ENTITY_OF[c] ?? c),
            entityId: String(d._id),
            rev: Number(d.rev ?? 1),
          });
        }
      }
      // Re-post every voucher per godown (canonical order) → ledger lines + stock moves.
      const vouchers = (backup.collections.vouchers ?? []) as Voucher[];
      const byGodown = new Map<string, Voucher[]>();
      for (const v of vouchers) byGodown.set(v.godownId, [...(byGodown.get(v.godownId) ?? []), v]);
      let lines = 0;
      for (const vs of byGodown.values()) {
        for (const r of replay(vs).results) {
          const d = serializeDerived(r.voucher, { lines: r.lines, moves: r.moves });
          if (d.lines.length) await k.ledgerLines.insertMany(d.lines.map(toDbLine), { session });
          if (d.moves.length) await k.stockMoves.insertMany(d.moves.map(toDbMove), { session });
          lines += d.lines.length;
        }
      }
      counts.ledgerLines = lines;
      // Changelog in chunks (pull feed) + serverSeq on the docs.
      for (let i = 0; i < entries.length; i += 1000) {
        const chunk = entries.slice(i, i + 1000);
        const seqs = await logChanges(db, session, chunk);
        for (let j = 0; j < chunk.length; j++) {
          const e = chunk[j]!;
          const coll = e.entity === "godown" ? "godowns" : COLLECTION_OF[e.entity];
          if (coll) {
            await db
              .collection(coll)
              .updateOne(
                { _id: e.entityId } as never,
                { $set: { serverSeq: seqs[j] } },
                { session },
              );
          }
        }
      }
    }),
  );
  if (owner) {
    await audit(db, undefined, {
      userId: owner._id,
      deviceId: "server",
      entity: "backup",
      entityId: "restore",
      action: "edit",
      detail: JSON.stringify(counts),
    });
  }
  return counts;
}

const ENTITY_OF: Record<string, string> = {
  godownSettings: "godownSettings",
  parties: "party",
  varieties: "variety",
  bankAccounts: "bankAccount",
  vehicles: "vehicle",
  places: "place",
  expenseCategories: "expenseCategory",
  vouchers: "voucher",
  reminders: "reminder",
  dayStatus: "dayStatus",
  transfers: "transfer",
};
const COLLECTION_OF: Record<string, string> = Object.fromEntries(
  Object.entries(ENTITY_OF).map(([c, e]) => [e, c]),
);

// ── Year close (§17.4) ───────────────────────────────────────────────────────

/**
 * "বছর বন্ধ": keep only the latest changelog entry per document (devices with any cursor still
 * receive every document's current state) and drop appliedOps older than 30 days. Vouchers and
 * ledger lines are kept. Returns the number of changelog entries removed.
 */
export async function compactSyncLogs(
  db: Db,
  owner: UserDoc,
): Promise<{ changelog: number; appliedOps: number }> {
  assertOwner(owner);
  const k = cols(db);
  const latest = await k.changelog
    .aggregate<{ _id: unknown; keep: number }>([
      { $group: { _id: { e: "$entity", id: "$entityId" }, keep: { $max: "$serverSeq" } } },
    ])
    .toArray();
  const keep = new Set(latest.map((l) => l.keep));
  const all = await k.changelog.find({}, { projection: { serverSeq: 1 } }).toArray();
  const drop = all.filter((c) => !keep.has(c.serverSeq)).map((c) => c.serverSeq);
  let removed = 0;
  for (let i = 0; i < drop.length; i += 5000) {
    removed += (await k.changelog.deleteMany({ serverSeq: { $in: drop.slice(i, i + 5000) } }))
      .deletedCount;
  }
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const ops = (await k.appliedOps.deleteMany({ appliedAt: { $lt: cutoff } })).deletedCount;
  await audit(db, undefined, {
    userId: owner._id,
    deviceId: "server",
    entity: "changelog",
    entityId: todayIST(),
    action: "edit",
    detail: `compact ${removed}/${ops}`,
  });
  return { changelog: removed, appliedOps: ops };
}

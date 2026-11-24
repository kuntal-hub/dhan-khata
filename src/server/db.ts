/**
 * MongoDB access (spec §15): one MongoClient cached on `globalThis` across invocations,
 * `maxPoolSize: 5`, `serverSelectionTimeoutMS: 8000`. Int64 values come back as `bigint`
 * (`useBigInt64`) — derived money/weight fields are stored as Int64 (Long) and summed in Mongo.
 */
import { MongoClient, type ClientSession, type Collection, type Db } from "mongodb";
import type {
  BankAccount,
  Business,
  DayStatus,
  Doc,
  Device,
  ExpenseCategory,
  Godown,
  GodownSettings,
  Party,
  Place,
  PushOpResult,
  Reminder,
  User,
  Variety,
  Vehicle,
} from "@/domain/schemas";
import { serverEnv } from "./env";

/** Server-only bookkeeping kept on master documents (never sent to clients). */
export interface ServerMeta {
  /** field → rev at which it last changed (field-level merge, spec §12.5). */
  fieldRev?: Record<string, number>;
}

type WithMeta<T> = T & { _m?: ServerMeta };

export interface DbLedgerLine {
  _id: string;
  businessId: string;
  godownId: string;
  voucherId: string;
  voucherRev: number;
  voucherType: string;
  date: string;
  account: string;
  debitPaise: bigint;
  creditPaise: bigint;
  partyId?: string;
  varietyId?: string;
  vehicleId?: string;
  fy: string;
}

export interface DbStockMove {
  _id: string;
  businessId: string;
  godownId: string;
  voucherId: string;
  voucherRev: number;
  voucherType: string;
  date: string;
  product: "PADDY" | "RICE" | "OTHER";
  otherProductName?: string;
  varietyId?: string;
  location: "WAREHOUSE" | "MILL" | "TRANSIT";
  millPartyId?: string;
  groupId?: string;
  qtyG: bigint;
  valuePaise: bigint;
  bags?: number;
  ord: string;
}

export interface ChangeLogDoc {
  serverSeq: number;
  godownId: string | null;
  entity: string;
  entityId: string;
  rev: number;
  at: Date;
}

export interface UserDoc extends User {
  passwordHash: string;
  /** Hash of the account recovery code (shown to the owner once). */
  recoveryCodeHash?: string;
}

export interface RefreshTokenDoc {
  _id: string; // HMAC of the token
  userId: string;
  deviceId: string;
  familyId: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date;
}

export interface AppliedOpDoc {
  _id: string; // opId
  deviceId: string;
  userId: string;
  appliedAt: Date;
  result: Pick<PushOpResult, "opId" | "result" | "serverSeq" | "rev">;
}

export interface AuditDoc {
  _id: string;
  at: Date;
  userId: string;
  deviceId: string;
  godownId?: string;
  entity: string;
  entityId: string;
  action:
    | "create"
    | "edit"
    | "void"
    | "unlock"
    | "login"
    | "logout"
    | "export"
    | "archive"
    | "register"
    | "password_reset"
    | "recovery_regenerate"
    | "business_edit";
  opId?: string;
  rev?: number;
  detail?: string;
}

export interface PushSubscriptionDoc {
  /** = the subscription endpoint (unique per browser install). */
  _id: string;
  userId: string;
  deviceId: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
}

/** Deployment-wide settings (owner): one document _id: "app". */
export interface AppSettingsDoc {
  _id: "app";
  /** Hour (IST, 0–23) of the daily reminder digest. */
  digestHour: number;
  defaultLanguage: "bn" | "en";
  /** IST date the last digest went out (the cron is idempotent per day). */
  lastDigestDate?: string;
  updatedAt: string;
}

export interface ClientErrorDoc {
  _id: string;
  at: Date;
  userId: string;
  deviceId: string;
  route: string;
  message: string;
  stack?: string;
  appVersion?: string;
}

export interface IntegritySummaryDoc {
  /** = godownId */
  _id: string;
  at: string;
  balanced: boolean;
  totalDebitPaise: bigint;
  totalCreditPaise: bigint;
  voucherCount: number;
}

export interface ConflictDoc {
  _id: string;
  at: Date;
  godownId: string;
  entity: string;
  entityId: string;
  field: string;
  mine: unknown;
  server: unknown;
  opId: string;
  userId: string;
  deviceId: string;
  resolved: boolean;
}

export interface Collections {
  businesses: Collection<Business>;
  godowns: Collection<WithMeta<Godown>>;
  users: Collection<UserDoc>;
  devices: Collection<Device>;
  vouchers: Collection<Doc>;
  parties: Collection<WithMeta<Party>>;
  varieties: Collection<WithMeta<Variety>>;
  bankAccounts: Collection<WithMeta<BankAccount>>;
  vehicles: Collection<WithMeta<Vehicle>>;
  places: Collection<WithMeta<Place>>;
  expenseCategories: Collection<WithMeta<ExpenseCategory>>;
  godownSettings: Collection<WithMeta<GodownSettings>>;
  dayStatus: Collection<DayStatus>;
  transfers: Collection<{ _id: string; godownId: string }>;
  pushSubscriptions: Collection<PushSubscriptionDoc>;
  appSettings: Collection<AppSettingsDoc>;
  clientErrors: Collection<ClientErrorDoc>;
  integritySummary: Collection<IntegritySummaryDoc>;
  reminders: Collection<WithMeta<Reminder>>;
  ledgerLines: Collection<DbLedgerLine>;
  stockMoves: Collection<DbStockMove>;
  changelog: Collection<ChangeLogDoc>;
  counters: Collection<{ _id: string; value: number | bigint }>;
  appliedOps: Collection<AppliedOpDoc>;
  audit: Collection<AuditDoc>;
  conflicts: Collection<ConflictDoc>;
  refreshTokens: Collection<RefreshTokenDoc>;
  loginAttempts: Collection<{ _id: string; key: string; at: Date; expiresAt: Date }>;
  accounts: Collection<{
    _id: string;
    godownId: string;
    key: string;
    type: string;
    i18nKey: string;
  }>;
  locations: Collection<{
    _id: string;
    godownId: string;
    code: string;
    system: boolean;
    i18nKey: string;
  }>;
}

interface MongoCache {
  uri: string;
  client: MongoClient;
  connecting: Promise<MongoClient>;
  indexes?: Promise<void>;
}

declare global {
  var __dkMongo: MongoCache | undefined;
}

export function mongoClientOptions() {
  return {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 8000,
    useBigInt64: true,
    ignoreUndefined: true,
    appName: "dhan-gola",
  } as const;
}

export async function getMongoClient(): Promise<MongoClient> {
  const { mongoUri } = serverEnv();
  let cache = globalThis.__dkMongo;
  if (!cache || cache.uri !== mongoUri) {
    const client = new MongoClient(mongoUri, mongoClientOptions());
    cache = { uri: mongoUri, client, connecting: client.connect() };
    globalThis.__dkMongo = cache;
  }
  return cache.connecting;
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  const db = client.db(serverEnv().dbName);
  const cache = globalThis.__dkMongo!;
  if (!cache.indexes) {
    cache.indexes = ensureIndexes(db).catch((e) => {
      cache.indexes = undefined;
      throw e;
    });
  }
  await cache.indexes;
  return db;
}

export function cols(db: Db): Collections {
  const c = <T extends object>(name: string) => db.collection<T>(name);
  return {
    businesses: c("businesses"),
    godowns: c("godowns"),
    users: c("users"),
    devices: c("devices"),
    vouchers: c("vouchers"),
    parties: c("parties"),
    varieties: c("varieties"),
    bankAccounts: c("bankAccounts"),
    vehicles: c("vehicles"),
    places: c("places"),
    expenseCategories: c("expenseCategories"),
    godownSettings: c("godownSettings"),
    dayStatus: c("dayStatus"),
    transfers: c("transfers"),
    pushSubscriptions: c("pushSubscriptions"),
    appSettings: c("appSettings"),
    clientErrors: c("clientErrors"),
    integritySummary: c("integritySummary"),
    reminders: c("reminders"),
    ledgerLines: c("ledgerLines"),
    stockMoves: c("stockMoves"),
    changelog: c("changelog"),
    counters: c("counters"),
    appliedOps: c("appliedOps"),
    audit: c("audit"),
    conflicts: c("conflicts"),
    refreshTokens: c("refreshTokens"),
    loginAttempts: c("loginAttempts"),
    accounts: c("accounts"),
    locations: c("locations"),
  };
}

/** Indexes per spec §8.5 (every business index starts with godownId) plus auth/sync helpers. */
export async function ensureIndexes(db: Db): Promise<void> {
  const k = cols(db);
  await Promise.all([
    // Every business index starts with businessId + godownId (requirement_v2 §10).
    k.vouchers.createIndexes([
      { key: { businessId: 1, godownId: 1, type: 1 } },
      { key: { businessId: 1, godownId: 1, partyId: 1 } },
      { key: { businessId: 1, godownId: 1, transactionDate: -1 } },
      { key: { businessId: 1, godownId: 1, paymentDate: -1 } },
      { key: { businessId: 1, godownId: 1, expenseDate: -1 } },
      { key: { businessId: 1, godownId: 1, "source.id": 1 } },
      { key: { businessId: 1, godownId: 1, dispatchId: 1 } },
      { key: { number: 1 }, unique: true },
      { key: { godownId: 1, groupId: 1 } },
      { key: { serverSeq: 1 } },
    ]),
    k.ledgerLines.createIndexes([
      { key: { businessId: 1, godownId: 1, account: 1, date: 1 } },
      { key: { businessId: 1, godownId: 1, partyId: 1, date: 1 } },
      { key: { voucherId: 1 } },
    ]),
    k.stockMoves.createIndexes([
      { key: { businessId: 1, godownId: 1, product: 1, location: 1, date: 1 } },
      { key: { businessId: 1, godownId: 1, product: 1, location: 1, ord: 1 } },
      { key: { voucherId: 1 } },
    ]),
    k.changelog.createIndexes([
      { key: { serverSeq: 1 }, unique: true },
      { key: { godownId: 1, serverSeq: 1 } },
    ]),
    k.appliedOps.createIndexes([{ key: { appliedAt: 1 }, expireAfterSeconds: 180 * 24 * 3600 }]),
    k.parties.createIndexes([
      { key: { godownId: 1, name: 1 } },
      { key: { godownId: 1, phone: 1 } },
      { key: { godownId: 1, roles: 1 } },
      { key: { godownId: 1, searchKey: 1 } },
    ]),
    k.godowns.createIndexes([{ key: { code: 1 }, unique: true }]),
    k.users.createIndexes([{ key: { phone: 1 }, unique: true }, { key: { businessId: 1 } }]),
    k.devices.createIndexes([{ key: { userId: 1 } }]),
    k.varieties.createIndexes([{ key: { godownId: 1 } }]),
    k.bankAccounts.createIndexes([{ key: { godownId: 1 } }]),
    k.vehicles.createIndexes([{ key: { godownId: 1, number: 1 } }]),
    k.places.createIndexes([{ key: { godownId: 1 } }]),
    k.expenseCategories.createIndexes([{ key: { godownId: 1, code: 1 }, unique: true }]),
    k.dayStatus.createIndexes([{ key: { godownId: 1, date: 1 } }]),
    k.transfers.createIndexes([{ key: { godownId: 1, status: 1 } }]),
    k.pushSubscriptions.createIndexes([{ key: { userId: 1 } }]),
    k.clientErrors.createIndexes([
      { key: { at: -1 } },
      { key: { at: 1 }, expireAfterSeconds: 90 * 24 * 3600 },
    ]),
    k.reminders.createIndexes([
      { key: { godownId: 1, dueDate: 1 } },
      { key: { godownId: 1, status: 1 } },
    ]),
    k.audit.createIndexes([{ key: { godownId: 1, at: -1 } }]),
    k.conflicts.createIndexes([{ key: { godownId: 1, at: -1 } }]),
    k.refreshTokens.createIndexes([
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
      { key: { familyId: 1 } },
    ]),
    k.loginAttempts.createIndexes([
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
      { key: { key: 1, at: 1 } },
    ]),
    k.accounts.createIndexes([{ key: { godownId: 1, key: 1 }, unique: true }]),
  ]);
}

/** Allocate `n` consecutive serverSeq values; returns the first. Call inside a transaction. */
export async function nextServerSeq(db: Db, session: ClientSession, n = 1): Promise<number> {
  const doc = await cols(db).counters.findOneAndUpdate(
    { _id: "serverSeq" },
    { $inc: { value: n } },
    { upsert: true, returnDocument: "after", session },
  );
  const last = doc ? doc.value : n;
  // A sequence counter, not money: safe integer conversion.
  return (typeof last === "bigint" ? Number(last) : last) - n + 1;
}

/** Test helper: close the cached client. */
export async function closeMongo(): Promise<void> {
  const cache = globalThis.__dkMongo;
  globalThis.__dkMongo = undefined;
  if (cache) await (await cache.connecting).close();
}

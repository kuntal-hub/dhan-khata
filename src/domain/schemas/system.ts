import { z } from "zod";
import { DeductionDefaultsSchema, Id, IntStr, IsoTimestamp, NonNegIntStr, YmdStr } from "./common";

export {
  LedgerLineV2Schema as LedgerLineSchema,
  StockMoveV2Schema as StockMoveSchema,
  type LedgerLineV2 as LedgerLine,
  type StockMoveV2 as StockMove,
} from "../v2/schemas";

/** Internal per-Gola roles (staff logins are out of scope for v2; only the owner is exposed). */
export const GodownRoleSchema = z.enum(["manager", "entry", "viewer"]);
export type GodownRole = z.infer<typeof GodownRoleSchema>;

export const UserSchema = z.strictObject({
  _id: Id,
  businessId: Id,
  name: z.string().min(1).max(80),
  phone: z.string().min(10).max(15),
  isOwner: z.boolean(),
  godownAccess: z.array(
    z.strictObject({ godownId: Id, role: GodownRoleSchema, consolidated: z.boolean().optional() }),
  ),
  language: z.enum(["bn", "en"]),
  digits: z.enum(["bn", "en"]),
  active: z.boolean(),
  createdAt: IsoTimestamp,
  /** Incremented whenever godownAccess changes (pull reports `accessChanged`). */
  accessVersion: z.number().int().min(0).optional(),
  rev: z.number().int().min(1).optional(),
  updatedAt: IsoTimestamp.optional(),
  serverSeq: z.number().int().min(0).optional(),
});
export type User = z.infer<typeof UserSchema>;

export const DeviceSchema = z.strictObject({
  _id: Id,
  userId: Id,
  code: z.string().regex(/^[A-Z]{1,3}$/),
  label: z.string().max(80),
  lastSeenAt: IsoTimestamp,
  userAgent: z.string().max(400),
  revokedAt: IsoTimestamp.optional(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const OutboxOpSchema = z.strictObject({
  opId: Id,
  seq: z.number().int().optional(),
  godownId: Id.nullable(),
  entity: z.string(),
  entityId: Id,
  op: z.enum(["upsert", "void"]),
  baseRev: z.number().int().min(0),
  payload: z.unknown(),
  createdAt: IsoTimestamp,
  attempts: z.number().int().min(0),
  lastError: z.string().optional(),
  status: z.enum(["pending", "sending", "error", "conflict"]),
  /** Ops written in one local transaction: the server applies them in ONE transaction (§17). */
  opGroup: Id.optional(),
  /** Master edits: the fields this edit changed (server merges them field by field). */
  fields: z.array(z.string()).optional(),
  /** Conflict items: the server's version, shown side by side on the Sync screen. */
  conflict: z.unknown().optional(),
});
export type OutboxOp = z.infer<typeof OutboxOpSchema>;

export const ReminderSchema = z.strictObject({
  _id: Id,
  businessId: Id,
  godownId: Id,
  kind: z.enum(["PAY", "COLLECT", "CUSTOM"]),
  partyId: Id.optional(),
  /** The bill this reminder is about (payment source type + id). */
  source: z.strictObject({ type: z.string().max(30), id: z.string().max(140) }).optional(),
  dueDate: YmdStr,
  amountPaise: NonNegIntStr.optional(),
  title: z.string().max(200),
  status: z.enum(["open", "done", "snoozed"]),
  snoozeUntil: YmdStr.optional(),
  rev: z.number().int().min(1),
  updatedAt: IsoTimestamp,
  createdAt: IsoTimestamp.optional(),
  createdBy: Id.optional(),
  updatedBy: Id.optional(),
  serverSeq: z.number().int().min(0).optional(),
});
export type Reminder = z.infer<typeof ReminderSchema>;

export const SeasonMapSchema = z.strictObject({
  AMAN: z.array(z.number().int().min(1).max(12)),
  BORO: z.array(z.number().int().min(1).max(12)),
  AUS: z.array(z.number().int().min(1).max(12)),
});

export const GodownSettingsSchema = z.strictObject({
  _id: Id,
  godownId: Id,
  defaults: z.strictObject({ deductions: DeductionDefaultsSchema }),
  rounding: z.strictObject({ roundToRupee: z.boolean() }),
  dayCloseRequired: z.boolean(),
  lockAfterDays: z.number().int().min(0).max(365),
  seasonMap: SeasonMapSchema,
  /** Low-stock alerts (§9.3): warehouse paddy thresholds in grams. */
  lowStock: z
    .strictObject({
      totalG: NonNegIntStr.optional(),
      perVariety: z.record(z.string(), NonNegIntStr).optional(),
    })
    .optional(),
  rev: z.number().int().min(1),
  updatedAt: IsoTimestamp,
});
export type GodownSettings = z.infer<typeof GodownSettingsSchema>;

export { defaultGodownSettings } from "../godownSettings";

export const DayStatusSchema = z.strictObject({
  /** `${godownId}:${YYYY-MM-DD}` */
  _id: z.string(),
  godownId: Id,
  date: YmdStr,
  closed: z.boolean(),
  countedCashPaise: IntStr.optional(),
  expectedCashPaise: IntStr.optional(),
  closedBy: Id.optional(),
  closedAt: IsoTimestamp.optional(),
  /** A cash entry was added on/before this day after it was closed: "re-check" (§7.1). */
  lateEntry: z.boolean().optional(),
});
export type DayStatus = z.infer<typeof DayStatusSchema>;

/** v1 pending inter-godown receipt (table kept for additive Dexie migrations; unused in v2). */
export const TransferSchema = z.looseObject({ _id: Id, godownId: Id });
export type Transfer = z.infer<typeof TransferSchema>;

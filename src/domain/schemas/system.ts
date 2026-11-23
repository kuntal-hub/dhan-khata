import { z } from "zod";
import { DEFAULT_SEASON_MAP } from "../dates";
import {
  DeductionDefaultsSchema,
  Id,
  IntStr,
  IsoTimestamp,
  NonNegIntStr,
  StockLocationSchema,
  YmdStr,
} from "./common";
import { VoucherTypeSchema } from "./vouchers";

/** Derived ledger line (spec §8.3). One of debit/credit is "0". */
export const LedgerLineSchema = z.strictObject({
  _id: z.string(),
  godownId: Id,
  voucherId: Id,
  voucherRev: z.number().int().min(1),
  voucherType: VoucherTypeSchema,
  date: YmdStr,
  account: z.string(),
  debitPaise: NonNegIntStr,
  creditPaise: NonNegIntStr,
  partyId: Id.optional(),
  varietyId: Id.optional(),
  vehicleId: Id.optional(),
  loadId: Id.optional(),
  season: z.string().optional(),
  fy: z.string(),
});
export type LedgerLine = z.infer<typeof LedgerLineSchema>;

export const StockMoveSchema = z.strictObject({
  _id: z.string(),
  godownId: Id,
  location: StockLocationSchema,
  voucherId: Id,
  voucherRev: z.number().int().min(1),
  date: YmdStr,
  varietyId: Id,
  /** Signed grams. */
  qtyG: IntStr,
  /** Signed value at cost (paise). */
  valuePaise: IntStr,
  /** Group scope for TRANSIT (specific cost of direct loads). */
  groupId: Id.optional(),
  /**
   * Canonical posting order of the owning voucher (`ordOf`): stock position "before" a voucher
   * is the sum of moves with a smaller `ord`. Set by the local write path and the server.
   */
  ord: z.string().max(160).optional(),
});
export type StockMove = z.infer<typeof StockMoveSchema>;

export const GodownRoleSchema = z.enum(["manager", "entry", "viewer"]);
export type GodownRole = z.infer<typeof GodownRoleSchema>;

export const UserSchema = z.strictObject({
  _id: Id,
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
  /** Master edits: the fields this edit changed (server merges them field by field). */
  fields: z.array(z.string()).optional(),
  /** Conflict items: the server's version, shown side by side on the Sync screen. */
  conflict: z.unknown().optional(),
});
export type OutboxOp = z.infer<typeof OutboxOpSchema>;

export const ReminderSchema = z.strictObject({
  _id: Id,
  godownId: Id,
  kind: z.enum(["PAY_DUE", "COLLECT_DUE", "CHEQUE", "CUSTOM"]),
  partyId: Id.optional(),
  voucherId: Id.optional(),
  dueDate: YmdStr,
  amountPaise: NonNegIntStr.optional(),
  title: z.string().max(200),
  status: z.enum(["open", "done", "snoozed"]),
  snoozeUntil: YmdStr.optional(),
  rev: z.number().int().min(1),
  updatedAt: IsoTimestamp,
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
  rev: z.number().int().min(1),
  updatedAt: IsoTimestamp,
});
export type GodownSettings = z.infer<typeof GodownSettingsSchema>;

export function defaultGodownSettings(godownId: string, now: string): GodownSettings {
  return {
    _id: godownId,
    godownId,
    defaults: { deductions: { tarePerBagG: "0", dhaltaMode: "PER_QUINTAL", dhaltaValueG: "0" } },
    rounding: { roundToRupee: true },
    dayCloseRequired: false,
    lockAfterDays: 7,
    seasonMap: {
      AMAN: [...DEFAULT_SEASON_MAP.AMAN],
      BORO: [...DEFAULT_SEASON_MAP.BORO],
      AUS: [...DEFAULT_SEASON_MAP.AUS],
    },
    rev: 1,
    updatedAt: now,
  };
}

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
  /** Set by the server when an offline-created voucher arrives for an already-closed day. */
  lateEntry: z.boolean().optional(),
});
export type DayStatus = z.infer<typeof DayStatusSchema>;

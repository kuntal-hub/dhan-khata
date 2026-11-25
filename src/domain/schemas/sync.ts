/**
 * Sync wire protocol (spec §12.3 / §12.4), shared by client and server.
 * Errors are codes, never sentences.
 */
import { z } from "zod";
import { Id, IsoTimestamp } from "./common";
import {
  BankAccountSchema,
  ExpenseCategorySchema,
  PartySchema,
  PlaceSchema,
  VarietySchema,
  VehicleSchema,
} from "./masters";
import { GodownSettingsSchema, ReminderSchema, type LedgerLine, type StockMove } from "./system";
import { DocSchema } from "../v2/schemas";

/** Godown-scoped master entities written through the outbox (field-level LWW on conflict). */
export const MASTER_ENTITIES = [
  "party",
  "variety",
  "bankAccount",
  "vehicle",
  "place",
  "expenseCategory",
] as const;
export type MasterEntity = (typeof MASTER_ENTITIES)[number];

/** Everything a device may push. */
export const PUSH_ENTITIES = ["voucher", ...MASTER_ENTITIES, "godownSettings", "reminder"] as const;
export type PushEntity = (typeof PUSH_ENTITIES)[number];

/** Everything a device may receive. `godown`, `user` and `business` are global (godownId = null). */
export const PULL_ENTITIES = [...PUSH_ENTITIES, "godown", "user", "business", "dayStatus"] as const;
export type PullEntity = (typeof PULL_ENTITIES)[number];

export const PUSH_SCHEMAS = {
  voucher: DocSchema,
  party: PartySchema,
  variety: VarietySchema,
  bankAccount: BankAccountSchema,
  vehicle: VehicleSchema,
  place: PlaceSchema,
  expenseCategory: ExpenseCategorySchema,
  godownSettings: GodownSettingsSchema,
  reminder: ReminderSchema,
} as const;

export function isMasterEntity(e: string): e is MasterEntity {
  return (MASTER_ENTITIES as readonly string[]).includes(e);
}

export const MAX_PUSH_BATCH = 50;
export const MAX_PULL_LIMIT = 500;

export const PushOpSchema = z.strictObject({
  opId: Id,
  godownId: Id,
  entity: z.enum(PUSH_ENTITIES),
  entityId: Id,
  op: z.enum(["upsert", "void"]),
  baseRev: z.number().int().min(0),
  payload: z.unknown(),
  createdAt: IsoTimestamp,
  fields: z.array(z.string().max(60)).max(100).optional(),
  /** Ops of one local transaction: applied by the server in ONE transaction, all or nothing. */
  opGroup: Id.optional(),
});
export type PushOp = z.infer<typeof PushOpSchema>;

export const PushRequestSchema = z.strictObject({
  deviceId: Id,
  // A single op group may exceed the client's batch target; never split it.
  ops: z
    .array(PushOpSchema)
    .min(1)
    .max(MAX_PUSH_BATCH * 4),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export type PushResultCode = "applied" | "duplicate" | "conflict" | "rejected";

/** Reasons that are not domain rule codes. */
export type PushRejectReason =
  | "DEPENDS_ON_FAILED"
  | "GROUP_FAILED"
  | "GODOWN_MISMATCH"
  | "ID_MISMATCH"
  | "UNKNOWN_ENTITY"
  | "SERVER_ERROR";

export interface PushOpResult {
  opId: string;
  result: PushResultCode;
  serverSeq?: number;
  rev?: number;
  /** Error code (rejected / conflict). */
  reason?: string;
  detail?: string;
  /** Server's version of the document (applied: as stored, incl. merges; conflict: the winner). */
  doc?: unknown;
  /** Server-derived lines/moves for a voucher (the server is the arbiter of cost). */
  lines?: LedgerLine[];
  moves?: StockMove[];
  /** Field names kept from the server on a master merge (the loser is in `conflicts`). */
  conflictFields?: string[];
}

export interface PushResponse {
  results: PushOpResult[];
  serverTime: string;
}

export interface PullChange {
  serverSeq: number;
  entity: PullEntity;
  entityId: string;
  godownId: string | null;
  /** Current document (null = no longer visible / removed). */
  doc: unknown;
  lines?: LedgerLine[];
  moves?: StockMove[];
}

export interface PullResponse {
  changes: PullChange[];
  nextSince: number;
  hasMore: boolean;
  /** The user's godown access differs from `av` sent by the client. */
  accessChanged: boolean;
  accessVersion: number;
  /** Godowns this user may access right now. */
  godownIds: string[];
  serverTime: string;
  /** Number of changes still to download (only when requested with `count=1`). */
  remaining?: number;
}

/** HTTP-level error codes (body: `{ error: code }`). */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "TOKEN_EXPIRED"
  | "DEVICE_REVOKED"
  | "USER_INACTIVE"
  | "DATA_NOT_MIGRATED"
  | "BAD_CREDENTIALS"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "GODOWN_CODE_TAKEN"
  | "REFRESH_INVALID"
  | "REFRESH_REUSED"
  | "DEVICE_MISMATCH"
  | "REGISTRATION_CLOSED"
  | "RECOVERY_INVALID"
  | "MOBILE_TAKEN"
  | "SERVER_ERROR";

export const LoginRequestSchema = z.strictObject({
  phone: z.string().min(10).max(15),
  password: z.string().min(1).max(200),
  deviceId: Id,
  deviceLabel: z.string().max(80).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const CreateGodownRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  nameAlt: z.string().trim().max(80).optional(),
  code: z.string().regex(/^[A-Z][A-Z0-9]{1,5}$/, { error: "errors.validation.godownCode" }),
  firmName: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(20).optional(),
  receiptLanguage: z.enum(["bn", "en", "both"]).optional(),
  colour: z.string().max(20).optional(),
});
export type CreateGodownRequest = z.infer<typeof CreateGodownRequestSchema>;

/** Owner: edit a godown's profile / letterhead (the code is immutable). */
export const UpdateGodownRequestSchema = z.strictObject({
  godownId: Id,
  name: z.string().trim().min(1).max(80),
  nameAlt: z.string().trim().max(80).optional(),
  firmName: z.string().max(120).optional(),
  proprietor: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(20).optional(),
  gstin: z.string().max(15).optional(),
  receiptLanguage: z.enum(["bn", "en", "both"]),
  colour: z.string().max(20).optional(),
});
export type UpdateGodownRequest = z.infer<typeof UpdateGodownRequestSchema>;

import { z } from "zod";
import { isValidYmd } from "../dates";

/** Serialized signed integer (money/weight in JSON & IndexedDB). */
export const IntStr = z.string().regex(/^-?\d+$/, { error: "errors.validation.integer" });
/** Serialized integer ≥ 0. */
export const NonNegIntStr = z.string().regex(/^\d+$/, { error: "errors.validation.nonNegative" });
/** Serialized integer > 0. */
export const PosIntStr = z.string().regex(/^[1-9]\d*$/, { error: "errors.validation.positive" });

export const Id = z.string().min(1).max(64);
export const YmdStr = z.string().refine(isValidYmd, { error: "errors.validation.date" });
export const IsoTimestamp = z.string().min(10).max(40);

/** v1 payment modes (legacy only; v2 uses CASH / BANK / UPI). */
export const PayModeV1Schema = z.enum(["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "DD", "OTHER"]);
export type PayModeV1 = z.infer<typeof PayModeV1Schema>;

export const SeasonSchema = z.enum(["AMAN", "BORO", "AUS"]);
export const DhaltaModeSchema = z.enum(["PER_QUINTAL", "PER_BAG", "FIXED"]);
export type DhaltaMode = z.infer<typeof DhaltaModeSchema>;
export const StockLocationSchema = z.enum(["STORE", "TRANSIT"]);
export type StockLocation = z.infer<typeof StockLocationSchema>;
export const DocStatusSchema = z.enum(["active", "void"]);

/** v1 base fields (no businessId): used only by the legacy v1 schemas and the migration. */
export const BaseDocShapeV1 = {
  _id: Id,
  godownId: Id,
  rev: z.number().int().min(1),
  createdAt: IsoTimestamp,
  createdBy: Id,
  deviceId: Id,
  updatedAt: IsoTimestamp,
  updatedBy: Id,
  serverSeq: z.number().int().min(0).optional(),
  status: DocStatusSchema,
  voidReason: z.string().max(500).optional(),
};

/**
 * Fields on EVERY synced business record (requirement_v2 §10). `godownId` is required and
 * immutable; `businessId` lets the server check the owner on every read/write (§2.4).
 */
export const BaseDocShape = {
  ...BaseDocShapeV1,
  businessId: Id,
};

export const BaseDocSchema = z.strictObject(BaseDocShape);
export type BaseDoc = z.infer<typeof BaseDocSchema>;

export const DeductionDefaultsSchema = z.strictObject({
  tarePerBagG: NonNegIntStr.optional(),
  dhaltaMode: DhaltaModeSchema.optional(),
  dhaltaValueG: NonNegIntStr.optional(),
  moistureBps: z.number().int().min(0).max(10_000).optional(),
});
export type DeductionDefaults = z.infer<typeof DeductionDefaultsSchema>;

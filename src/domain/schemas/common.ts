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

export const PayModeSchema = z.enum(["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "DD", "OTHER"]);
export type PayMode = z.infer<typeof PayModeSchema>;

export const SeasonSchema = z.enum(["AMAN", "BORO", "AUS"]);
export const DhaltaModeSchema = z.enum(["PER_QUINTAL", "PER_BAG", "FIXED"]);
export type DhaltaMode = z.infer<typeof DhaltaModeSchema>;
export const StockLocationSchema = z.enum(["STORE", "TRANSIT"]);
export type StockLocation = z.infer<typeof StockLocationSchema>;
export const DocStatusSchema = z.enum(["active", "void"]);

/** Fields on EVERY synced business document (spec §8). `godownId` is required and immutable. */
export const BaseDocShape = {
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

export const BaseDocSchema = z.strictObject(BaseDocShape);
export type BaseDoc = z.infer<typeof BaseDocSchema>;

export const DeductionDefaultsSchema = z.strictObject({
  tarePerBagG: NonNegIntStr.optional(),
  dhaltaMode: DhaltaModeSchema.optional(),
  dhaltaValueG: NonNegIntStr.optional(),
  moistureBps: z.number().int().min(0).max(10_000).optional(),
});
export type DeductionDefaults = z.infer<typeof DeductionDefaultsSchema>;

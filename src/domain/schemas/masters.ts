import { z } from "zod";
import {
  BaseDocShape,
  DeductionDefaultsSchema,
  Id,
  IntStr,
  IsoTimestamp,
  NonNegIntStr,
} from "./common";

export const PartyRoleSchema = z.enum([
  "farmer",
  "party",
  "mill",
  "transporter",
  "driver",
  "labour",
  "pump",
  "other",
  /** Auto-created party representing ANOTHER godown (inter-godown deals, spec §1.4 rule 5). */
  "godown",
]);
export type PartyRole = z.infer<typeof PartyRoleSchema>;

const PhoneSchema = z.string().regex(/^(\+91)?[6-9]\d{9}$/, { error: "errors.validation.phone" });

export const PartySchema = z.strictObject({
  ...BaseDocShape,
  name: z.string().trim().min(1).max(120),
  nameAlt: z.string().trim().max(120).optional(),
  searchKey: z.string().max(400),
  roles: z.array(PartyRoleSchema).min(1),
  phone: PhoneSchema.optional(),
  altPhone: PhoneSchema.optional(),
  village: z.string().max(80).optional(),
  postOffice: z.string().max(80).optional(),
  block: z.string().max(80).optional(),
  district: z.string().max(80).optional(),
  millName: z.string().max(120).optional(),
  gstin: z.string().max(15).optional(),
  pan: z.string().max(10).optional(),
  bankDetails: z
    .strictObject({
      holder: z.string().max(120).optional(),
      bank: z.string().max(120).optional(),
      /** Never full account numbers (spec §14). */
      accountLast4: z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
      ifsc: z.string().max(11).optional(),
      upiId: z.string().max(80).optional(),
    })
    .optional(),
  defaultRatePaisePerQtl: NonNegIntStr.optional(),
  defaultDeductions: DeductionDefaultsSchema.optional(),
  openingBalancePaise: IntStr.optional(),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().max(40)).optional(),
  /** Set only for role "godown": the godown this party represents. */
  linkedGodownId: Id.optional(),
});
export type Party = z.infer<typeof PartySchema>;

/** Godown = top-level independent business. NOT scoped by godownId (it IS the scope). */
export const GodownSchema = z.strictObject({
  _id: Id,
  rev: z.number().int().min(1),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  code: z.string().regex(/^[A-Z][A-Z0-9]{1,5}$/, { error: "errors.validation.godownCode" }),
  name: z.string().trim().min(1).max(80),
  nameAlt: z.string().trim().max(80).optional(),
  firmName: z.string().max(120).optional(),
  proprietor: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(20).optional(),
  gstin: z.string().max(15).optional(),
  logoAssetId: z.string().max(64).optional(),
  capacityG: NonNegIntStr.optional(),
  receiptLanguage: z.enum(["bn", "en", "both"]),
  status: z.enum(["active", "archived"]),
  serverSeq: z.number().int().min(0).optional(),
});
export type Godown = z.infer<typeof GodownSchema>;

export const VarietySchema = z.strictObject({
  ...BaseDocShape,
  name: z.string().trim().max(80),
  nameAlt: z.string().trim().max(80).optional(),
  /** Seeded varieties keep their code; rendered via i18n `variety.<systemKey>` unless renamed. */
  systemKey: z.string().max(40).optional(),
  renamed: z.boolean().optional(),
  defaultDeductions: DeductionDefaultsSchema.optional(),
});
export type Variety = z.infer<typeof VarietySchema>;

export const BankAccountSchema = z.strictObject({
  ...BaseDocShape,
  name: z.string().trim().min(1).max(80),
  bank: z.string().trim().min(1).max(80),
  last4: z.string().regex(/^\d{4}$/, { error: "errors.validation.last4" }),
  ifsc: z.string().max(11).optional(),
  isUpiLinked: z.boolean(),
  openingBalancePaise: IntStr,
});
export type BankAccount = z.infer<typeof BankAccountSchema>;

export const VehicleSchema = z.strictObject({
  ...BaseDocShape,
  /** Normalized: uppercase, no spaces (e.g. "WB12AB3456"). */
  number: z.string().regex(/^[A-Z0-9]{2,15}$/, { error: "errors.validation.vehicleNumber" }),
  ownership: z.enum(["own", "external"]),
  ownerPartyId: Id.optional(),
  type: z.enum(["truck", "tractor", "pickup", "other"]).optional(),
  capacityG: NonNegIntStr.optional(),
  driverPartyId: Id.optional(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const PlaceSchema = z.strictObject({
  ...BaseDocShape,
  name: z.string().trim().min(1).max(80),
});
export type Place = z.infer<typeof PlaceSchema>;

export const ExpenseCategorySchema = z.strictObject({
  ...BaseDocShape,
  /** Immutable, unique within the godown. System: LABOUR, TRANSPORT, OTHERS, …; user: "U_xxxx". */
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/),
  isSystem: z.boolean(),
  enabled: z.boolean(),
  /** Only for user-created categories; system ones render via i18n `expenseCategory.<code>`. */
  name: z.string().trim().max(60).optional(),
});
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;

/** "wb 12 ab 3456" → "WB12AB3456" */
export function normalizeVehicleNumber(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "WB12AB3456" → "WB 12 AB 3456" (best-effort Indian format for display). */
export function formatVehicleNumber(normalized: string): string {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(normalized);
  if (!m) return normalized;
  return [m[1], m[2], m[3], m[4]].filter((p) => p && p.length > 0).join(" ");
}

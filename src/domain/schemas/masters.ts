import { z } from "zod";
import {
  BaseDocShape,
  DeductionDefaultsSchema,
  Id,
  IntStr,
  IsoTimestamp,
  NonNegIntStr,
} from "./common";

/** Party roles (requirement_v2 §10). GOLA = auto-created party representing another Gola. */
export const PARTY_ROLES = [
  "FARMER",
  "SUPPLIER",
  "CUSTOMER",
  "MILL",
  "SECOND_PARTY",
  "VEHICLE_CUSTOMER",
  "DRIVER",
  "LABOUR",
  "OTHER",
  "GOLA",
] as const;
export const PartyRoleSchema = z.enum(PARTY_ROLES);
export type PartyRole = z.infer<typeof PartyRoleSchema>;

export const PhoneSchema = z.string().regex(/^(\+91)?[6-9]\d{9}$/, {
  error: "errors.validation.phone",
});

export const PartySchema = z.strictObject({
  ...BaseDocShape,
  name: z.string().trim().min(1).max(120),
  nameAlt: z.string().trim().max(120).optional(),
  searchKey: z.string().max(400),
  roles: z.array(PartyRoleSchema).min(1),
  /** Mobile number (10-digit Indian). */
  phone: PhoneSchema.optional(),
  altPhone: PhoneSchema.optional(),
  address: z.string().max(300).optional(),
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
      /** Never full account numbers (spec §19). */
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
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().max(40)).optional(),
  /** Set only for role GOLA: the Gola this party represents. */
  linkedGodownId: Id.optional(),
  /** Set when the owner merged this duplicate into another party (status becomes void). */
  mergedInto: Id.optional(),
});
export type Party = z.infer<typeof PartySchema>;

/** Gola (godown) = an independent set of books. NOT scoped by godownId (it IS the scope). */
export const GodownSchema = z.strictObject({
  _id: Id,
  businessId: Id,
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
  /** Colour chip in the Gola switcher (palette key). */
  colour: z.string().max(20).optional(),
  receiptLanguage: z.enum(["bn", "en", "both"]),
  status: z.enum(["active", "archived"]),
  serverSeq: z.number().int().min(0).optional(),
});
export type Godown = z.infer<typeof GodownSchema>;

/** The owner's business (one per deployment). Global: not scoped by godownId. */
export const BusinessSchema = z.strictObject({
  _id: Id,
  name: z.string().trim().min(1).max(120),
  address: z.string().max(300).optional(),
  mobile: z.string().max(15).optional(),
  /** Small compressed logo (data URL), shown on receipts, invoices and reports. */
  logoDataUrl: z.string().max(200_000).optional(),
  ownerUserId: Id,
  /** Kilograms in one mon (default 40). */
  monKg: z.number().int().min(1).max(100),
  settings: z.strictObject({
    /** Optional weight deductions (ধলতা etc.), off by default (§6.3). */
    deductionsEnabled: z.boolean(),
  }),
  rev: z.number().int().min(1),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  serverSeq: z.number().int().min(0).optional(),
});
export type Business = z.infer<typeof BusinessSchema>;

export const VARIETY_COMPANIES = ["PAN", "MUNDRA", "TIASA", "GMS", "OTHER"] as const;

export const VarietySchema = z.strictObject({
  ...BaseDocShape,
  name: z.string().trim().max(80),
  nameAlt: z.string().trim().max(80).optional(),
  /** Seeded varieties keep their code; rendered via i18n `variety.<systemKey>` unless renamed. */
  systemKey: z.string().max(40).optional(),
  renamed: z.boolean().optional(),
  company: z.enum(VARIETY_COMPANIES).optional(),
  companyOther: z.string().trim().max(60).optional(),
  product: z.enum(["PADDY", "RICE"]),
  /** lower(trim(name)) + company: unique per Gola (duplicate prevention, §12.2). */
  normalizedKey: z.string().max(200),
  /** Seeded, widely known public variety. */
  verified: z.boolean(),
  lastUsedAt: IsoTimestamp.optional(),
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
  driverName: z.string().max(80).optional(),
  driverMobile: z.string().max(15).optional(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const PlaceSchema = z.strictObject({
  ...BaseDocShape,
  name: z.string().trim().min(1).max(80),
});
export type Place = z.infer<typeof PlaceSchema>;

export const ExpenseCategorySchema = z.strictObject({
  ...BaseDocShape,
  /** Immutable, unique within the Gola. System: LABOUR, TRANSPORT, …; user: "U_xxxx". */
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/),
  isSystem: z.boolean(),
  enabled: z.boolean(),
  /** Only for user-created categories; system ones render via i18n `expenseCategory.<code>`. */
  name: z.string().trim().max(60).optional(),
});
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;

export { formatVehicleNumber, normalizeVehicleNumber } from "../vehicleNumber";

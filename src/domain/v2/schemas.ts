/**
 * v2 business documents (requirement_v2 §10). One store, discriminated by `type` (DECISIONS D1).
 * Amounts are integer strings: paise, grams, paise per quintal, basis points, millilitres.
 * Every document carries only the dates that matter to it (§7.1); `businessDate()` picks the
 * date that drives its ledger lines and stock moves.
 */
import { z } from "zod";
import { Id, IntStr, IsoTimestamp, NonNegIntStr, PosIntStr, YmdStr } from "../schemas/common";

export const PRODUCTS = ["PADDY", "RICE", "OTHER"] as const;
export const ProductSchema = z.enum(PRODUCTS);
export type Product = z.infer<typeof ProductSchema>;

export const LOCATIONS = ["WAREHOUSE", "MILL", "TRANSIT"] as const;
export const LocationSchema = z.enum(LOCATIONS);
export type Location = z.infer<typeof LocationSchema>;

export const PAY_MODES = ["CASH", "BANK", "UPI"] as const;
export const PayModeSchema = z.enum(PAY_MODES);
export type PayMode = z.infer<typeof PayModeSchema>;

export const SEASONS_V2 = ["AMAN", "BORO", "AUS"] as const;

/** Fields on every business document. `godownId` is required and immutable. */
export const DocBaseShape = {
  _id: Id,
  businessId: Id,
  godownId: Id,
  rev: z.number().int().min(1),
  status: z.enum(["active", "void"]),
  voidReason: z.string().max(500).optional(),
  /** Business date the user entered the record (today IST, read-only). */
  entryDate: YmdStr,
  createdAt: IsoTimestamp,
  createdBy: Id,
  updatedAt: IsoTimestamp,
  updatedBy: Id,
  deviceId: Id,
  serverSeq: z.number().int().min(0).optional(),
  /** Per-Gola voucher / bill / invoice number. */
  number: z.string().min(1).max(40),
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  season: z.enum(SEASONS_V2).optional(),
  notes: z.string().max(1000).optional(),
  /** Records created together (split payments, inter-Gola pair, direct delivery purchase+sale). */
  groupId: Id.optional(),
  /** Reason given for the latest edit. */
  editReason: z.string().max(500).optional(),
};

// ─── Weight block ────────────────────────────────────────────────────────────────────────────

export const BagSchema = z.strictObject({
  id: Id,
  seq: z.number().int().min(1),
  weightG: PosIntStr,
});
export type Bag = z.infer<typeof BagSchema>;

export const DeductionsSchema = z.strictObject({
  tareG: NonNegIntStr.optional(),
  dhaltaG: NonNegIntStr.optional(),
  moistureBps: z.number().int().min(0).max(10_000).optional(),
  otherG: NonNegIntStr.optional(),
});
export type Deductions = z.infer<typeof DeductionsSchema>;

export const WeightBlockSchema = z.strictObject({
  mode: z.enum(["BAGS", "MANUAL"]),
  /** BAGS mode: every bag (unlimited). */
  bags: z.array(BagSchema).max(5000).optional(),
  /** MANUAL mode: optional bag count. */
  bagCount: z.number().int().min(0).max(100_000).optional(),
  /** Σ bags or the manual total. */
  totalG: PosIntStr,
  /** Optional deductions (feature off by default). */
  deductions: DeductionsSchema.optional(),
  netG: PosIntStr,
});
export type WeightBlock = z.infer<typeof WeightBlockSchema>;

// ─── Documents ───────────────────────────────────────────────────────────────────────────────

const InterGolaSchema = z.strictObject({
  counterGodownId: Id,
  side: z.enum(["SEND", "RECEIVE"]),
  paired: z.boolean(),
});
export type InterGola = z.infer<typeof InterGolaSchema>;

const BillShape = {
  ratePaisePerQtl: NonNegIntStr,
  /** netG × rate (half-up). */
  amountPaise: NonNegIntStr,
  roundToRupee: z.boolean().optional(),
  roundOffPaise: IntStr,
  /** amount + roundOff. */
  totalPaise: NonNegIntStr,
};

export const PurchaseSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("PURCHASE"),
  transactionDate: YmdStr,
  partyId: Id,
  varietyId: Id,
  storeAt: z.enum(["WAREHOUSE", "TRANSIT"]),
  weight: WeightBlockSchema,
  ...BillShape,
  /**
   * Bill charges carried over from v1 data only (the v2 form has none): total = amount
   * + Σ add − Σ deduct + roundOff. Shown read-only on the detail page.
   */
  legacyCharges: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(60),
        kind: z.enum(["add", "deduct"]),
        amountPaise: NonNegIntStr,
      }),
    )
    .optional(),
  dueDate: YmdStr.optional(),
  linkedLoadId: Id.optional(),
  interGola: InterGolaSchema.optional(),
});
export type Purchase = z.infer<typeof PurchaseSchema>;

export const DELIVERY_STATUSES = ["PENDING", "LOADED", "IN_TRANSIT", "DELIVERED"] as const;

export const SaleSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("SALE"),
  transactionDate: YmdStr,
  partyId: Id,
  product: z.enum(["PADDY", "RICE"]),
  varietyId: Id,
  source: LocationSchema,
  sourceMillId: Id.optional(),
  weight: WeightBlockSchema,
  ...BillShape,
  saleStatus: z.enum(["ORDER", "CONFIRMED"]),
  deliveryStatus: z.enum(DELIVERY_STATUSES),
  deliveryLog: z.array(
    z.strictObject({
      status: z.enum(DELIVERY_STATUSES),
      at: IsoTimestamp,
      note: z.string().max(200).optional(),
    }),
  ),
  vehicleNumber: z.string().max(20).optional(),
  driverName: z.string().max(80).optional(),
  dueDate: YmdStr.optional(),
  /** Informational only (DECISIONS D4). */
  charges: z
    .strictObject({
      loadingPaise: NonNegIntStr.optional(),
      freightPaise: NonNegIntStr.optional(),
      vehicleAdvancePaise: NonNegIntStr.optional(),
    })
    .optional(),
  linkedLoadId: Id.optional(),
  /** Set when this sale settles a CONSIGNMENT dispatch (DECISIONS D5). */
  consignmentDispatchId: Id.optional(),
  interGola: InterGolaSchema.optional(),
});
export type Sale = z.infer<typeof SaleSchema>;

export const PAYMENT_SOURCE_TYPES = [
  "PURCHASE",
  "SALE",
  "EXPENSE",
  "MILL_DISPATCH",
  "MILL_RETURN",
  "VEHICLE_TRIP",
  "VEHICLE_COST",
  "SECOND_PARTY",
  "PARTY_ADVANCE",
  "OPENING_DUE",
] as const;
export type PaymentSourceType = (typeof PAYMENT_SOURCE_TYPES)[number];

export const PaymentSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("PAYMENT"),
  /** OUT = we paid; IN = we received. */
  direction: z.enum(["OUT", "IN"]),
  amountPaise: PosIntStr,
  /** Date the money actually moved (drives the cashbook). */
  paymentDate: YmdStr,
  mode: PayModeSchema,
  bankAccountId: Id.optional(),
  reference: z.string().max(60).optional(),
  personName: z.string().max(80).optional(),
  vehicleNumber: z.string().max(20).optional(),
  partyId: Id.optional(),
  source: z.strictObject({
    type: z.enum(PAYMENT_SOURCE_TYPES),
    /** null only for on-account advances / second-party on-account money. VEHICLE_COST: `${tripId}:${costId}`. */
    id: z.string().min(1).max(140).nullable(),
  }),
  isInitial: z.boolean(),
});
export type Payment = z.infer<typeof PaymentSchema>;

export const ExpenseSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("EXPENSE"),
  title: z.string().trim().min(1).max(200),
  /** Per-Gola category code (posts to EXP:<code>). FARMER_PAYMENT is never an expense. */
  categoryCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/),
  amountPaise: PosIntStr,
  partyId: Id.optional(),
  personText: z.string().max(80).optional(),
  expenseDate: YmdStr,
  dueDate: YmdStr.optional(),
  vehicleId: Id.optional(),
  linkedTripId: Id.optional(),
});
export type Expense = z.infer<typeof ExpenseSchema>;

export const LoadSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("LOAD"),
  transactionDate: YmdStr,
  fromPartyId: Id.optional(),
  destinationMillId: Id.optional(),
  varietyId: Id,
  weight: WeightBlockSchema,
  ratePaisePerQtl: NonNegIntStr,
  totalPaise: NonNegIntStr,
  vehicleNumber: z.string().max(20),
  driverName: z.string().max(80).optional(),
  secondPartyId: Id.optional(),
  /** The one record that moves stock/money for this load (1:1). */
  link: z.strictObject({ type: z.enum(["SALE", "MILL_DISPATCH"]), id: Id }).optional(),
});
export type Load = z.infer<typeof LoadSchema>;

export const MillDispatchSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("MILL_DISPATCH"),
  dispatchType: z.enum(["MILLING", "CONSIGNMENT"]),
  millPartyId: Id,
  dispatchDate: YmdStr,
  varietyId: Id,
  weight: WeightBlockSchema,
  /** MILLING: milling charge per qtl (may be 0); CONSIGNMENT: expected price per qtl. */
  ratePaisePerQtl: NonNegIntStr,
  /** MILLING: charges payable to the mill; CONSIGNMENT: expected value (informational). */
  totalValuePaise: NonNegIntStr,
  vehicleNumber: z.string().max(20).optional(),
  driverName: z.string().max(80).optional(),
  dueDate: YmdStr.optional(),
  linkedLoadId: Id.optional(),
});
export type MillDispatch = z.infer<typeof MillDispatchSchema>;

export const MillReturnSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("MILL_RETURN"),
  dispatchId: Id,
  /** Copied from the dispatch (verified). */
  millPartyId: Id,
  returnDate: YmdStr,
  product: ProductSchema,
  otherProductName: z.string().trim().min(1).max(40).optional(),
  /** Paddy: the dispatch's variety (copied). Rice: optional rice variety. */
  varietyId: Id.optional(),
  weight: WeightBlockSchema,
  ratePaisePerQtl: NonNegIntStr.optional(),
  /** Optional valuation (rice/other: used by the conversion, DECISIONS D6). */
  totalValuePaise: NonNegIntStr.optional(),
  /** Same dispatch + date + product + quantity (duplicate check). */
  dedupeKey: z.string().max(200),
});
export type MillReturn = z.infer<typeof MillReturnSchema>;

export const ConversionSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("CONVERSION"),
  dispatchId: Id,
  /** Copied from the dispatch (verified): which mill stock the paddy leaves. */
  millPartyId: Id,
  varietyId: Id,
  conversionDate: YmdStr,
  paddyConsumedG: PosIntStr,
  outputs: z.array(
    z.strictObject({
      returnId: Id,
      product: z.enum(["RICE", "OTHER"]),
      name: z.string().max(40).optional(),
      varietyId: Id.optional(),
      qtyG: PosIntStr,
      /** Copied valuation of the linked return (optional). */
      valuePaise: NonNegIntStr.optional(),
    }),
  ),
  /** Entered and confirmed by the user; the app shows consumed − Σ outputs. */
  lossG: IntStr,
});
export type Conversion = z.infer<typeof ConversionSchema>;

export const VEHICLE_COST_KINDS = ["DRIVER", "DIESEL", "OTHER"] as const;

export const TripSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("TRIP"),
  transactionDate: YmdStr,
  /** Required when the trip earns income (an own load carried by our own truck earns none). */
  customerPartyId: Id.optional(),
  vehicleId: Id,
  driverName: z.string().max(80).optional(),
  loadingLocation: z.string().max(80),
  destination: z.string().max(80),
  qtyG: NonNegIntStr.optional(),
  rateMode: z.enum(["PER_QTL", "FIXED"]),
  ratePaise: NonNegIntStr,
  totalIncomePaise: NonNegIntStr,
  dueDate: YmdStr.optional(),
  costs: z.array(
    z.strictObject({
      id: Id,
      kind: z.enum(VEHICLE_COST_KINDS),
      amountPaise: PosIntStr,
      litresMl: NonNegIntStr.optional(),
      /** Payee party (driver, pump); otherwise the cost is owed to EXP_PAYABLE (DECISIONS D8). */
      partyId: Id.optional(),
      payeeText: z.string().max(80).optional(),
      note: z.string().max(120).optional(),
    }),
  ),
  /** Reference only: no money effect. */
  linkedSaleId: Id.optional(),
  linkedLoadId: Id.optional(),
});
export type Trip = z.infer<typeof TripSchema>;

export const SecondPartySchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("SECOND_PARTY"),
  partyId: Id,
  transactionDate: YmdStr,
  kind: z.enum(["WE_OWE", "THEY_OWE"]),
  amountPaise: PosIntStr,
  dueDate: YmdStr.optional(),
});
export type SecondParty = z.infer<typeof SecondPartySchema>;

export const STOCK_ADJUST_REASONS_V2 = ["DRYING", "RODENT", "WET", "WEIGHING", "OTHER"] as const;

export const StockAdjustSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("STOCK_ADJUST"),
  transactionDate: YmdStr,
  lines: z
    .array(
      z.strictObject({
        product: ProductSchema,
        varietyId: Id.optional(),
        otherProductName: z.string().max(40).optional(),
        location: LocationSchema,
        millPartyId: Id.optional(),
        /** Signed grams (counted − system). Non-zero. */
        qtyG: IntStr.refine((s) => s !== "0" && s !== "-0", { error: "errors.validation.nonZero" }),
        bags: z.number().int().optional(),
        reason: z.enum(STOCK_ADJUST_REASONS_V2),
        /** Physical verification: system stock and counted stock at the time. */
        systemG: IntStr.optional(),
        countedG: IntStr.optional(),
        note: z.string().max(200).optional(),
      }),
    )
    .min(1),
});
export type StockAdjust = z.infer<typeof StockAdjustSchema>;

export const CONTRA_KINDS_V2 = [
  "DEPOSIT",
  "WITHDRAW",
  "TRANSFER",
  "CAPITAL_IN",
  "DRAWINGS",
] as const;

export const ContraSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("CONTRA"),
  transactionDate: YmdStr,
  kind: z.enum(CONTRA_KINDS_V2),
  /** DEPOSIT/WITHDRAW: the bank; TRANSFER: from; CAPITAL_IN/DRAWINGS: bank (absent = cash). */
  bankAccountId: Id.optional(),
  /** TRANSFER only: destination bank. */
  toBankAccountId: Id.optional(),
  amountPaise: PosIntStr,
  reference: z.string().max(60).optional(),
});
export type Contra = z.infer<typeof ContraSchema>;

export const DayCloseSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("DAY_CLOSE"),
  date: YmdStr,
  expectedClosingPaise: IntStr,
  actualClosingPaise: IntStr,
  /** actual − expected (negative = shortage). */
  diffPaise: IntStr,
  denominations: z.record(z.string(), z.number().int().min(0)).optional(),
});
export type DayClose = z.infer<typeof DayCloseSchema>;

export const OpeningSchema = z.strictObject({
  ...DocBaseShape,
  type: z.literal("OPENING"),
  transactionDate: YmdStr,
  items: z
    .array(
      z.strictObject({
        kind: z.enum(["CASH", "BANK", "PARTY", "STOCK", "CAPITAL"]),
        /** bankAccountId for BANK, partyId for PARTY. */
        refId: Id.optional(),
        product: ProductSchema.optional(),
        varietyId: Id.optional(),
        otherProductName: z.string().max(40).optional(),
        location: LocationSchema.optional(),
        millPartyId: Id.optional(),
        qtyG: NonNegIntStr.optional(),
        /** Signed: + = debit balance (asset / party owes us), − = credit balance. */
        amountPaise: IntStr,
      }),
    )
    .min(1),
});
export type Opening = z.infer<typeof OpeningSchema>;

export const DocSchema = z.discriminatedUnion("type", [
  PurchaseSchema,
  SaleSchema,
  PaymentSchema,
  ExpenseSchema,
  LoadSchema,
  MillDispatchSchema,
  MillReturnSchema,
  ConversionSchema,
  TripSchema,
  SecondPartySchema,
  StockAdjustSchema,
  ContraSchema,
  DayCloseSchema,
  OpeningSchema,
]);
export type Doc = z.infer<typeof DocSchema>;
export type DocType = Doc["type"];
export type DocOf<T extends DocType> = Extract<Doc, { type: T }>;
export const DOC_TYPES = [
  "PURCHASE",
  "SALE",
  "PAYMENT",
  "EXPENSE",
  "LOAD",
  "MILL_DISPATCH",
  "MILL_RETURN",
  "CONVERSION",
  "TRIP",
  "SECOND_PARTY",
  "STOCK_ADJUST",
  "CONTRA",
  "DAY_CLOSE",
  "OPENING",
] as const satisfies readonly DocType[];

/** The date that drives a document's ledger lines and stock moves (§7.1). */
export function businessDate(d: Doc): string {
  switch (d.type) {
    case "EXPENSE":
      return d.expenseDate;
    case "MILL_DISPATCH":
      return d.dispatchDate;
    case "MILL_RETURN":
      return d.returnDate;
    case "CONVERSION":
      return d.conversionDate;
    case "PAYMENT":
      return d.paymentDate;
    case "DAY_CLOSE":
      return d.date;
    default:
      return d.transactionDate;
  }
}

/** Derived ledger line (per Gola). One of debit/credit is "0". */
export const LedgerLineV2Schema = z.strictObject({
  _id: z.string(),
  businessId: Id,
  godownId: Id,
  voucherId: Id,
  voucherRev: z.number().int().min(1),
  voucherType: z.enum(DOC_TYPES),
  date: YmdStr,
  account: z.string(),
  debitPaise: NonNegIntStr,
  creditPaise: NonNegIntStr,
  partyId: Id.optional(),
  varietyId: Id.optional(),
  vehicleId: Id.optional(),
  fy: z.string(),
});
export type LedgerLineV2 = z.infer<typeof LedgerLineV2Schema>;

/** Derived stock move (§9.1). */
export const StockMoveV2Schema = z.strictObject({
  _id: z.string(),
  businessId: Id,
  godownId: Id,
  voucherId: Id,
  voucherRev: z.number().int().min(1),
  voucherType: z.enum(DOC_TYPES),
  date: YmdStr,
  product: ProductSchema,
  otherProductName: z.string().optional(),
  varietyId: z.string().optional(),
  location: LocationSchema,
  millPartyId: Id.optional(),
  /** TRANSIT only: the group whose specific cost applies. */
  groupId: Id.optional(),
  qtyG: IntStr,
  valuePaise: IntStr,
  bags: z.number().int().optional(),
  /** Canonical posting order of the owning document. */
  ord: z.string().max(160).optional(),
});
export type StockMoveV2 = z.infer<typeof StockMoveV2Schema>;

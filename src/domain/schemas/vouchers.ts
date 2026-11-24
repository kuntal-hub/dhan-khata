/**
 * Voucher schemas (spec §8.2). One collection, discriminated by `type`.
 * Amounts/weights are serialized integer strings (paise / grams / paise-per-quintal).
 * Derived fields (netG, amountPaise, totals…) are stored AND re-verified by `recomputeVoucher`.
 */
import { z } from "zod";
import {
  BaseDocShape,
  DhaltaModeSchema,
  Id,
  IntStr,
  NonNegIntStr,
  PayModeSchema,
  PosIntStr,
  SeasonSchema,
  StockLocationSchema,
  YmdStr,
} from "./common";

export const VOUCHER_TYPES = [
  "PURCHASE",
  "SALE",
  "LOAD",
  "PAYMENT",
  "RECEIPT",
  "EXPENSE",
  "TRIP",
  "CONTRA",
  "STOCK_ADJUST",
  "MILL_SETTLEMENT",
  "DAY_CLOSE",
  "OPENING",
  "JOURNAL",
] as const;
export const VoucherTypeSchema = z.enum(VOUCHER_TYPES);
export type VoucherType = z.infer<typeof VoucherTypeSchema>;

const VoucherBaseShape = {
  ...BaseDocShape,
  number: z.string().min(1).max(40),
  date: YmdStr,
  season: SeasonSchema.optional(),
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  notes: z.string().max(1000).optional(),
  /** Links vouchers created together (e.g. LOAD → PURCHASE + SALE; PURCHASE → paid-now PAYMENT). */
  groupId: Id.optional(),
  /** Reason for the latest edit (required by the UI after the voucher has synced). */
  editReason: z.string().max(500).optional(),
};

/** A trade line (purchase or sale): one variety with weight deductions. */
export const TradeLineSchema = z.strictObject({
  varietyId: Id,
  bags: z.number().int().min(0).optional(),
  grossG: PosIntStr,
  tarePerBagG: NonNegIntStr.optional(),
  dhaltaMode: DhaltaModeSchema.optional(),
  dhaltaValueG: NonNegIntStr.optional(),
  moistureBps: z.number().int().min(0).max(10_000).optional(),
  otherDedG: NonNegIntStr.optional(),
  netG: PosIntStr,
  ratePaisePerQtl: PosIntStr,
  amountPaise: NonNegIntStr,
});
export type TradeLine = z.infer<typeof TradeLineSchema>;

export const ChargeSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  kind: z.enum(["add", "deduct"]),
  amountPaise: NonNegIntStr,
});
export type Charge = z.infer<typeof ChargeSchema>;

/**
 * Inter-godown transfer link (spec §1.4 rule 5). The SEND side (SALE / PAYMENT) lives in the
 * sending godown, the RECEIVE side (PURCHASE / RECEIPT) in the receiving godown; both share the
 * voucher `groupId` (= transfer id). `paired` = both sides were written together on one device;
 * otherwise the server publishes a pending receipt to the receiving godown.
 */
export const InterGodownSchema = z.strictObject({
  counterGodownId: Id,
  side: z.enum(["SEND", "RECEIVE"]),
  paired: z.boolean(),
});
export type InterGodown = z.infer<typeof InterGodownSchema>;

const MoneyMovementSchema = z.strictObject({
  amountPaise: PosIntStr,
  mode: PayModeSchema,
  bankAccountId: Id.optional(),
  ref: z.string().max(60).optional(),
});

export const PurchaseVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("PURCHASE"),
  partyId: Id,
  storeAt: StockLocationSchema,
  lines: z.array(TradeLineSchema).min(1),
  charges: z.array(ChargeSchema),
  roundToRupee: z.boolean(),
  roundOffPaise: IntStr,
  totalPaise: NonNegIntStr,
  /** Paid now → a linked PAYMENT voucher in the same group (the PAYMENT is what posts). */
  paidNow: MoneyMovementSchema.optional(),
  dueDate: YmdStr.optional(),
  loadId: Id.optional(),
  interGodown: InterGodownSchema.optional(),
});
export type PurchaseVoucher = z.infer<typeof PurchaseVoucherSchema>;

export const SaleVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("SALE"),
  partyId: Id,
  millPartyId: Id.optional(),
  vehicleId: Id.optional(),
  vehicleNumber: z.string().max(20),
  source: StockLocationSchema,
  lines: z.array(TradeLineSchema).min(1),
  charges: z.array(ChargeSchema),
  roundToRupee: z.boolean(),
  roundOffPaise: IntStr,
  /** Linked EXPENSE (labour) is created by the sale builder. */
  loading: z
    .strictObject({
      ratePaisePerQtl: NonNegIntStr.optional(),
      fixedPaise: NonNegIntStr.optional(),
      amountPaise: NonNegIntStr,
      payTo: z.enum(["CASH_NOW", "LABOUR_PARTY"]),
      labourPartyId: Id.optional(),
    })
    .optional(),
  /** Freight. Posted INSIDE the sale voucher per payer (see postLedger). */
  delivery: z
    .strictObject({
      ratePaisePerQtl: NonNegIntStr.optional(),
      fixedPaise: NonNegIntStr.optional(),
      amountPaise: NonNegIntStr,
      payer: z.enum(["US", "MILL", "BUYER"]),
      transporterPartyId: Id.optional(),
    })
    .optional(),
  /** → linked PAYMENT to the transporter. */
  vehicleAdvance: MoneyMovementSchema.optional(),
  /** → linked RECEIPT from the buyer. */
  advanceReceived: MoneyMovementSchema.extend({ via: z.string().max(80).optional() }).optional(),
  /** Goods value (bill total). */
  totalPaise: NonNegIntStr,
  /** Display only: total − advance received − freight deducted by mill. Truth = ledger. */
  duePaise: IntStr,
  expectedPaymentDate: YmdStr.optional(),
  settlementStatus: z.enum(["PENDING", "SETTLED"]),
  loadId: Id.optional(),
  interGodown: InterGodownSchema.optional(),
});
export type SaleVoucher = z.infer<typeof SaleVoucherSchema>;

export const LoadVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("LOAD"),
  mode: z.enum(["OWN_TRADE", "AGENT"]),
  loadPlaceId: Id.optional(),
  loadPlaceText: z.string().max(80).optional(),
  fromPartyId: Id.optional(),
  fromStore: z.boolean().optional(),
  toMillPartyId: Id,
  secondPartyId: Id.optional(),
  vehicleNumber: z.string().max(20),
  varietyId: Id,
  bags: z.number().int().min(0).optional(),
  grossG: PosIntStr,
  netG: PosIntStr,
  partySellRatePaisePerQtl: NonNegIntStr.optional(),
  millRatePaisePerQtl: NonNegIntStr.optional(),
  totalAmountPaise: NonNegIntStr,
  commission: z
    .strictObject({
      ratePaisePerQtl: NonNegIntStr.optional(),
      amountPaise: NonNegIntStr,
      payer: z.enum(["MILL", "SELLER"]),
    })
    .optional(),
  linkedPurchaseId: Id.optional(),
  linkedSaleId: Id.optional(),
});
export type LoadVoucher = z.infer<typeof LoadVoucherSchema>;

const MoneyVoucherShape = {
  ...VoucherBaseShape,
  partyId: Id,
  amountPaise: PosIntStr,
  mode: PayModeSchema,
  ourBankAccountId: Id.optional(),
  theirBankText: z.string().max(120).optional(),
  utrOrRef: z.string().max(60).optional(),
  chequeNo: z.string().max(20).optional(),
  chequeDate: YmdStr.optional(),
  cashVia: z
    .strictObject({
      vehicleNumber: z.string().max(20).optional(),
      personName: z.string().max(80).optional(),
    })
    .optional(),
  purpose: z.enum(["BILL", "ADVANCE", "OTHER"]),
  allocations: z.array(z.strictObject({ voucherId: Id, amountPaise: PosIntStr })).optional(),
  dueDate: YmdStr.optional(),
  interGodown: InterGodownSchema.optional(),
};

export const PaymentVoucherSchema = z.strictObject({
  ...MoneyVoucherShape,
  type: z.literal("PAYMENT"),
});
export type PaymentVoucher = z.infer<typeof PaymentVoucherSchema>;

export const ReceiptVoucherSchema = z.strictObject({
  ...MoneyVoucherShape,
  type: z.literal("RECEIPT"),
  /** TDS deducted by the mill (recorded only; spec §3.6). */
  tdsPaise: NonNegIntStr.optional(),
});
export type ReceiptVoucher = z.infer<typeof ReceiptVoucherSchema>;

export const ExpenseVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("EXPENSE"),
  /** Immutable per-godown category code (LABOUR, TRANSPORT, OTHERS, U_xxx). Posts to EXP:<code>. */
  categoryCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/),
  amountPaise: PosIntStr,
  mode: PayModeSchema,
  bankAccountId: Id.optional(),
  payeePartyId: Id.optional(),
  payeeText: z.string().max(80).optional(),
  /** true = not paid now; owed to `payeePartyId` (e.g. labour contractor). */
  onCredit: z.boolean().optional(),
  description: z.string().trim().min(1).max(300),
  loadId: Id.optional(),
  vehicleId: Id.optional(),
});
export type ExpenseVoucher = z.infer<typeof ExpenseVoucherSchema>;

export const TRIP_EXPENSE_KINDS = [
  "DIESEL",
  "DRIVER",
  "TOLL",
  "LOADING",
  "UNLOADING",
  "REPAIR",
  "OTHER",
] as const;

export const TripVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("TRIP"),
  vehicleId: Id,
  driverPartyId: Id.optional(),
  hirerPartyId: Id.optional(),
  loadingPlace: z.string().max(80),
  unloadingPlace: z.string().max(80),
  qtyG: NonNegIntStr.optional(),
  rateMode: z.enum(["PER_QUINTAL", "FIXED"]),
  ratePaise: NonNegIntStr,
  freightPaise: NonNegIntStr,
  advanceReceivedPaise: NonNegIntStr.optional(),
  advanceMode: PayModeSchema.optional(),
  advanceBankAccountId: Id.optional(),
  expenses: z.array(
    z.strictObject({
      kind: z.enum(TRIP_EXPENSE_KINDS),
      amountPaise: PosIntStr,
      litresMl: NonNegIntStr.optional(),
      mode: PayModeSchema,
      bankAccountId: Id.optional(),
      /** Bought on credit (e.g. diesel from a pump party). */
      creditPartyId: Id.optional(),
      note: z.string().max(120).optional(),
    }),
  ),
  duePaise: IntStr,
  /** Own vehicle carried our own load: costs only, no freight income (default, [CONFIRM] #7). */
  ownTradeLoadId: Id.optional(),
  odometerStartKm: z.number().int().min(0).optional(),
  odometerEndKm: z.number().int().min(0).optional(),
});
export type TripVoucher = z.infer<typeof TripVoucherSchema>;

export const CONTRA_KINDS = [
  "CASH_DEPOSIT",
  "CASH_WITHDRAWAL",
  "BANK_TRANSFER",
  "CHEQUE_CLEAR",
  "CHEQUE_BOUNCE",
  "CAPITAL_IN",
  "DRAWINGS",
] as const;

export const ContraVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("CONTRA"),
  kind: z.enum(CONTRA_KINDS),
  amountPaise: PosIntStr,
  /** Bank involved (deposit/withdrawal/cheque clear; source for transfer; capital/drawings via bank). */
  bankAccountId: Id.optional(),
  /** Destination bank for BANK_TRANSFER. */
  toBankAccountId: Id.optional(),
  /** Party whose cheque bounced. */
  partyId: Id.optional(),
  /** The RECEIPT voucher of the cheque being cleared/bounced. */
  receiptVoucherId: Id.optional(),
});
export type ContraVoucher = z.infer<typeof ContraVoucherSchema>;

export const STOCK_ADJUST_REASONS = ["DRYING", "RODENT", "WET", "COUNT", "OTHER"] as const;

export const StockAdjustVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("STOCK_ADJUST"),
  lines: z
    .array(
      z.strictObject({
        varietyId: Id,
        /** Signed grams: negative = shortage, positive = excess. Non-zero. */
        qtyG: IntStr.refine((s) => s !== "0" && s !== "-0", { error: "errors.validation.nonZero" }),
        reason: z.enum(STOCK_ADJUST_REASONS),
        note: z.string().max(200).optional(),
      }),
    )
    .min(1),
});
export type StockAdjustVoucher = z.infer<typeof StockAdjustVoucherSchema>;

export const MillSettlementVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("MILL_SETTLEMENT"),
  saleId: Id,
  /** Copied from the sale so the voucher posts on its own; server verifies against the sale. */
  partyId: Id,
  dispatchedNetG: PosIntStr,
  saleTotalPaise: NonNegIntStr,
  millReceivedGrossG: PosIntStr,
  millDeductions: z.array(
    z.strictObject({
      label: z.string().trim().min(1).max(60),
      g: NonNegIntStr.optional(),
      bps: z.number().int().min(0).max(10_000).optional(),
      paise: NonNegIntStr.optional(),
    }),
  ),
  millNetG: PosIntStr,
  finalRatePaisePerQtl: PosIntStr,
  finalAmountPaise: NonNegIntStr,
  /** finalAmount − sale total (negative = cut). */
  differencePaise: IntStr,
  /** dispatched net − mill net (negative = mill found more). */
  shortageG: IntStr,
});
export type MillSettlementVoucher = z.infer<typeof MillSettlementVoucherSchema>;

export const DayCloseVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("DAY_CLOSE"),
  expectedCashPaise: IntStr,
  countedCashPaise: IntStr,
  /** counted − expected. Negative = shortage. */
  differencePaise: IntStr,
  denominations: z.record(z.string(), z.number().int().min(0)).optional(),
});
export type DayCloseVoucher = z.infer<typeof DayCloseVoucherSchema>;

export const OpeningVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("OPENING"),
  items: z
    .array(
      z.strictObject({
        kind: z.enum(["CASH", "BANK", "PARTY", "STOCK", "CAPITAL"]),
        /** bankAccountId for BANK, partyId for PARTY. */
        refId: Id.optional(),
        varietyId: Id.optional(),
        qtyG: NonNegIntStr.optional(),
        /** Signed: + = debit balance (asset / party owes us), − = credit balance. */
        amountPaise: IntStr,
      }),
    )
    .min(1),
});
export type OpeningVoucher = z.infer<typeof OpeningVoucherSchema>;

export const JournalVoucherSchema = z.strictObject({
  ...VoucherBaseShape,
  type: z.literal("JOURNAL"),
  lines: z
    .array(
      z.strictObject({
        account: z.string().min(1).max(120),
        debitPaise: NonNegIntStr,
        creditPaise: NonNegIntStr,
        partyId: Id.optional(),
      }),
    )
    .min(2),
});
export type JournalVoucher = z.infer<typeof JournalVoucherSchema>;

export const VoucherSchema = z.discriminatedUnion("type", [
  PurchaseVoucherSchema,
  SaleVoucherSchema,
  LoadVoucherSchema,
  PaymentVoucherSchema,
  ReceiptVoucherSchema,
  ExpenseVoucherSchema,
  TripVoucherSchema,
  ContraVoucherSchema,
  StockAdjustVoucherSchema,
  MillSettlementVoucherSchema,
  DayCloseVoucherSchema,
  OpeningVoucherSchema,
  JournalVoucherSchema,
]);
export type Voucher = z.infer<typeof VoucherSchema>;
export type VoucherOf<T extends VoucherType> = Extract<Voucher, { type: T }>;

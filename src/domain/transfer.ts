/**
 * Inter-godown transfer (spec §1.4 rule 5, §9.11): a deal between two independent books.
 *   paddy: SALE in the sender (Dr PARTY:godown-B / Cr SALES + COGS) and PURCHASE in the receiver
 *          (Dr STOCK / Cr PARTY:godown-A), same quantity and rate on both sides;
 *   money: PAYMENT in the sender and RECEIPT in the receiver, same amount.
 * Both sides share `groupId` (= transfer id). Pure builders: the repo assigns the bookkeeping.
 */
import { DomainError } from "./errors";
import type { PayMode } from "./schemas/common";
import type {
  InterGodown,
  PaymentVoucher,
  PurchaseVoucher,
  ReceiptVoucher,
  SaleVoucher,
} from "./schemas/vouchers";

export type TransferKind = "PADDY" | "MONEY";

export interface TransferTerms {
  kind: TransferKind;
  date: string;
  /** Paddy: net quantity moved (g) and the transfer rate (paise / quintal). */
  qtyG?: bigint;
  ratePaisePerQtl?: bigint;
  /** Money: amount moved (paise). */
  amountPaise?: bigint;
  notes?: string;
}

export interface TransferSide {
  godownId: string;
  /** The auto-created "গোডাউন: X" party (role godown) in THIS godown's books. */
  partyId: string;
  /** Paddy: this godown's own variety record. */
  varietyId?: string;
  /** Money: how it left / arrived in this godown. */
  mode?: PayMode;
  bankAccountId?: string;
}

type Draft<V> = Omit<
  V,
  | "_id"
  | "godownId"
  | "rev"
  | "createdAt"
  | "createdBy"
  | "deviceId"
  | "updatedAt"
  | "updatedBy"
  | "serverSeq"
  | "status"
  | "voidReason"
  | "number"
  | "fy"
  | "editReason"
>;

export type TransferSendDraft = Draft<SaleVoucher> | Draft<PaymentVoucher>;
export type TransferReceiveDraft = Draft<PurchaseVoucher> | Draft<ReceiptVoucher>;

function paddyLine(varietyId: string | undefined, terms: TransferTerms) {
  if (!varietyId || !terms.qtyG || terms.qtyG <= 0n || !terms.ratePaisePerQtl) {
    throw new DomainError("VALIDATION_FAILED", "paddy transfer needs variety, quantity and rate");
  }
  const qty = terms.qtyG.toString();
  return {
    varietyId,
    grossG: qty,
    netG: qty,
    ratePaisePerQtl: terms.ratePaisePerQtl.toString(),
    amountPaise: "0",
  };
}

function moneyAmount(terms: TransferTerms): string {
  if (!terms.amountPaise || terms.amountPaise <= 0n) {
    throw new DomainError("VALIDATION_FAILED", "money transfer needs an amount");
  }
  return terms.amountPaise.toString();
}

const notesOf = (t: TransferTerms) => (t.notes?.trim() ? { notes: t.notes.trim() } : {});

/** The sending godown's voucher (SALE for paddy, PAYMENT for money). */
export function transferSendDraft(
  terms: TransferTerms,
  side: TransferSide,
  counterGodownId: string,
  groupId: string,
  paired: boolean,
): TransferSendDraft {
  const interGodown: InterGodown = { counterGodownId, side: "SEND", paired };
  if (terms.kind === "PADDY") {
    return {
      type: "SALE",
      date: terms.date,
      groupId,
      partyId: side.partyId,
      vehicleNumber: "",
      source: "STORE",
      lines: [paddyLine(side.varietyId, terms)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      totalPaise: "0",
      duePaise: "0",
      settlementStatus: "SETTLED",
      interGodown,
      ...notesOf(terms),
    };
  }
  const mode = side.mode ?? "CASH";
  return {
    type: "PAYMENT",
    date: terms.date,
    groupId,
    partyId: side.partyId,
    amountPaise: moneyAmount(terms),
    mode,
    ...(mode !== "CASH" && side.bankAccountId ? { ourBankAccountId: side.bankAccountId } : {}),
    purpose: "OTHER",
    interGodown,
    ...notesOf(terms),
  };
}

/** The receiving godown's voucher (PURCHASE for paddy, RECEIPT for money). */
export function transferReceiveDraft(
  terms: TransferTerms,
  side: TransferSide,
  counterGodownId: string,
  groupId: string,
  paired: boolean,
): TransferReceiveDraft {
  const interGodown: InterGodown = { counterGodownId, side: "RECEIVE", paired };
  if (terms.kind === "PADDY") {
    return {
      type: "PURCHASE",
      date: terms.date,
      groupId,
      partyId: side.partyId,
      storeAt: "STORE",
      lines: [paddyLine(side.varietyId, terms)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      totalPaise: "0",
      interGodown,
      ...notesOf(terms),
    };
  }
  const mode = side.mode ?? "CASH";
  return {
    type: "RECEIPT",
    date: terms.date,
    groupId,
    partyId: side.partyId,
    amountPaise: moneyAmount(terms),
    mode,
    ...(mode !== "CASH" && side.bankAccountId ? { ourBankAccountId: side.bankAccountId } : {}),
    purpose: "OTHER",
    interGodown,
    ...notesOf(terms),
  };
}

/** Transfer terms read back from a SEND voucher (to edit, or to publish a pending receipt). */
export function termsOfSendVoucher(
  v: SaleVoucher | PaymentVoucher,
): TransferTerms & { kind: TransferKind } {
  if (v.type === "SALE") {
    const l = v.lines[0]!;
    return {
      kind: "PADDY",
      date: v.date,
      qtyG: BigInt(l.netG),
      ratePaisePerQtl: BigInt(l.ratePaisePerQtl),
      amountPaise: BigInt(v.totalPaise),
      ...(v.notes ? { notes: v.notes } : {}),
    };
  }
  return {
    kind: "MONEY",
    date: v.date,
    amountPaise: BigInt(v.amountPaise),
    ...(v.notes ? { notes: v.notes } : {}),
  };
}

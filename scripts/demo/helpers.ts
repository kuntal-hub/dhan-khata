/**
 * Demo-seed helpers: IST-stamped clock, draft builders and small ledger-aware utilities.
 * Money is handled as integer rupees → BigInt paise only (no floating point anywhere).
 */
import { setClockForTests } from "@/client/clock";
import { accountBalance } from "@/client/queries/ledger";
import { stockOf } from "@/client/queries/stock";
import { saveSimple, type VoucherDraft } from "@/client/repo";
import { addDays, todayIST } from "@/domain/dates";
import { ACC, bankAccountKey } from "@/domain/posting/accounts";

export const TODAY = todayIST();
/** The business date `n` days before today (IST). */
export const day = (back: number): string => addDays(TODAY, -back);

// ── Clock ────────────────────────────────────────────────────────────────────

let stampDate = "";
let stampN = 0;

/** Pretend it is `date`, a few minutes after the previous write of that day (creation times). */
export function at(date: string): void {
  if (date !== stampDate) {
    stampDate = date;
    stampN = 0;
  }
  stampN += 1;
  const minutes = 9 * 60 + stampN * 9;
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  let when = new Date(`${date}T${hh}:${mm}:00+05:30`);
  if (when.getTime() > Date.now()) when = new Date();
  setClockForTests(() => when);
}

/** The evening of `date` (day close). */
export function evening(date: string): void {
  let when = new Date(`${date}T20:30:00+05:30`);
  if (when.getTime() > Date.now()) when = new Date();
  setClockForTests(() => when);
}

// ── Units ────────────────────────────────────────────────────────────────────

/** Whole rupees → paise string. */
export const R = (rupees: number): string => (BigInt(rupees) * 100n).toString();
export const Rb = (rupees: number): bigint => BigInt(rupees) * 100n;
/** Whole kilograms → grams string. */
export const kg = (kilos: number | bigint): string => (BigInt(kilos) * 1000n).toString();
/** Rupees per quintal → paise per quintal string. */
export const rate = (rupeesPerQtl: number): string => (BigInt(rupeesPerQtl) * 100n).toString();

// ── Draft builders ───────────────────────────────────────────────────────────

export interface LineOpts {
  bags?: number;
  /** grams of tare per bag (default 500 when bags are given on a purchase). */
  tareG?: number;
  /** grams of dhalta per quintal. */
  dhaltaG?: number;
  moistBps?: number;
}

/** A trade line; `grossKg` and `rateRs` (₹/quintal) are whole numbers. */
export function tl(varietyId: string, grossKg: number | bigint, rateRs: number, o: LineOpts = {}) {
  return {
    varietyId,
    ...(o.bags ? { bags: o.bags } : {}),
    grossG: kg(grossKg),
    ...(o.tareG ? { tarePerBagG: String(o.tareG) } : {}),
    ...(o.dhaltaG ? { dhaltaMode: "PER_QUINTAL" as const, dhaltaValueG: String(o.dhaltaG) } : {}),
    ...(o.moistBps ? { moistureBps: o.moistBps } : {}),
    netG: "1",
    ratePaisePerQtl: rate(rateRs),
    amountPaise: "0",
  };
}

export interface Pay {
  /** Whole rupees, or exact paise when it comes from a ledger balance. */
  amountRs?: number;
  amountPaise?: bigint;
  mode: "CASH" | "BANK_TRANSFER" | "UPI" | "CHEQUE" | "DD" | "OTHER";
  bankId?: string;
  ref?: string;
}

const payPaise = (p: Pay): string =>
  p.amountPaise !== undefined ? p.amountPaise.toString() : R(p.amountRs ?? 0);

export const movement = (p: Pay) => ({
  amountPaise: payPaise(p),
  mode: p.mode,
  ...(p.bankId ? { bankAccountId: p.bankId } : {}),
  ...(p.ref ? { ref: p.ref } : {}),
});

export function purchaseDraft(a: {
  date: string;
  partyId: string;
  lines: ReturnType<typeof tl>[];
  paid?: Pay;
  dueDate?: string;
  charges?: Array<{ label: string; kind: "add" | "deduct"; amountRs: number }>;
  notes?: string;
}): VoucherDraft {
  return {
    type: "PURCHASE",
    date: a.date,
    partyId: a.partyId,
    storeAt: "STORE",
    lines: a.lines,
    charges: (a.charges ?? []).map((c) => ({ label: c.label, kind: c.kind, amountPaise: R(c.amountRs) })),
    roundToRupee: true,
    roundOffPaise: "0",
    totalPaise: "0",
    ...(a.paid ? { paidNow: movement(a.paid) } : {}),
    ...(a.dueDate ? { dueDate: a.dueDate } : {}),
    ...(a.notes ? { notes: a.notes } : {}),
  } as VoucherDraft;
}

export function saleDraft(a: {
  date: string;
  partyId: string;
  millPartyId?: string;
  vehicleNumber: string;
  vehicleId?: string;
  lines: ReturnType<typeof tl>[];
  loading?: { ratePerQtlRs: number; payTo: "CASH_NOW" | "LABOUR_PARTY"; labourPartyId?: string };
  delivery?: {
    ratePerQtlRs?: number;
    fixedRs?: number;
    payer: "US" | "MILL" | "BUYER";
    transporterPartyId?: string;
  };
  vehicleAdvance?: Pay;
  advance?: Pay & { via?: string };
  expectedPaymentDate?: string;
  notes?: string;
}): VoucherDraft {
  return {
    type: "SALE",
    date: a.date,
    partyId: a.partyId,
    ...(a.millPartyId ? { millPartyId: a.millPartyId } : {}),
    ...(a.vehicleId ? { vehicleId: a.vehicleId } : {}),
    vehicleNumber: a.vehicleNumber,
    source: "STORE",
    lines: a.lines,
    charges: [],
    roundToRupee: true,
    roundOffPaise: "0",
    ...(a.loading
      ? {
          loading: {
            ratePaisePerQtl: rate(a.loading.ratePerQtlRs),
            amountPaise: "0",
            payTo: a.loading.payTo,
            ...(a.loading.labourPartyId ? { labourPartyId: a.loading.labourPartyId } : {}),
          },
        }
      : {}),
    ...(a.delivery
      ? {
          delivery: {
            ...(a.delivery.ratePerQtlRs !== undefined
              ? { ratePaisePerQtl: rate(a.delivery.ratePerQtlRs) }
              : {}),
            ...(a.delivery.fixedRs !== undefined ? { fixedPaise: R(a.delivery.fixedRs) } : {}),
            amountPaise: "0",
            payer: a.delivery.payer,
            ...(a.delivery.transporterPartyId
              ? { transporterPartyId: a.delivery.transporterPartyId }
              : {}),
          },
        }
      : {}),
    ...(a.vehicleAdvance ? { vehicleAdvance: movement(a.vehicleAdvance) } : {}),
    ...(a.advance
      ? { advanceReceived: { ...movement(a.advance), ...(a.advance.via ? { via: a.advance.via } : {}) } }
      : {}),
    ...(a.expectedPaymentDate ? { expectedPaymentDate: a.expectedPaymentDate } : {}),
    ...(a.notes ? { notes: a.notes } : {}),
    totalPaise: "0",
    duePaise: "0",
    settlementStatus: "PENDING",
  } as VoucherDraft;
}

export function moneyDraft(a: {
  type: "PAYMENT" | "RECEIPT";
  date: string;
  partyId: string;
  pay: Pay;
  purpose?: "BILL" | "ADVANCE" | "OTHER";
  dueDate?: string;
  chequeNo?: string;
  chequeDate?: string;
  theirBank?: string;
  notes?: string;
}): VoucherDraft {
  return {
    type: a.type,
    date: a.date,
    partyId: a.partyId,
    amountPaise: payPaise(a.pay),
    mode: a.pay.mode,
    ...(a.pay.bankId ? { ourBankAccountId: a.pay.bankId } : {}),
    ...(a.pay.ref ? { utrOrRef: a.pay.ref } : {}),
    ...(a.chequeNo ? { chequeNo: a.chequeNo } : {}),
    ...(a.chequeDate ? { chequeDate: a.chequeDate } : {}),
    ...(a.theirBank ? { theirBankText: a.theirBank } : {}),
    ...(a.dueDate ? { dueDate: a.dueDate } : {}),
    ...(a.notes ? { notes: a.notes } : {}),
    purpose: a.purpose ?? "BILL",
  } as VoucherDraft;
}

export function expenseDraft(a: {
  date: string;
  code: string;
  amountRs: number;
  description: string;
  mode?: "CASH" | "BANK_TRANSFER" | "UPI" | "CHEQUE" | "OTHER";
  bankId?: string;
  payeePartyId?: string;
  payeeText?: string;
  onCredit?: boolean;
  vehicleId?: string;
}): VoucherDraft {
  return {
    type: "EXPENSE",
    date: a.date,
    categoryCode: a.code,
    amountPaise: R(a.amountRs),
    mode: a.mode ?? "CASH",
    ...(a.bankId ? { bankAccountId: a.bankId } : {}),
    ...(a.payeePartyId ? { payeePartyId: a.payeePartyId } : {}),
    ...(a.payeeText ? { payeeText: a.payeeText } : {}),
    ...(a.onCredit ? { onCredit: true } : {}),
    ...(a.vehicleId ? { vehicleId: a.vehicleId } : {}),
    description: a.description,
  } as VoucherDraft;
}

export function contraDraft(a: {
  date: string;
  kind:
    | "CASH_DEPOSIT"
    | "CASH_WITHDRAWAL"
    | "BANK_TRANSFER"
    | "CHEQUE_CLEAR"
    | "CHEQUE_BOUNCE"
    | "CAPITAL_IN"
    | "DRAWINGS";
  amountRs?: number;
  amountPaise?: bigint;
  bankId?: string;
  toBankId?: string;
  partyId?: string;
  receiptVoucherId?: string;
  notes?: string;
}): VoucherDraft {
  return {
    type: "CONTRA",
    date: a.date,
    kind: a.kind,
    amountPaise: a.amountPaise !== undefined ? a.amountPaise.toString() : R(a.amountRs ?? 0),
    ...(a.bankId ? { bankAccountId: a.bankId } : {}),
    ...(a.toBankId ? { toBankAccountId: a.toBankId } : {}),
    ...(a.partyId ? { partyId: a.partyId } : {}),
    ...(a.receiptVoucherId ? { receiptVoucherId: a.receiptVoucherId } : {}),
    ...(a.notes ? { notes: a.notes } : {}),
  } as VoucherDraft;
}

// ── Ledger-aware utilities ───────────────────────────────────────────────────

export const cashBalance = (godownId: string, to?: string): Promise<bigint> =>
  accountBalance(godownId, ACC.CASH, to ? { to } : {});
export const bankBalance = (godownId: string, bankId: string): Promise<bigint> =>
  accountBalance(godownId, bankAccountKey(bankId));
export const storeStock = async (godownId: string, varietyId: string): Promise<bigint> =>
  (await stockOf(godownId, varietyId, "STORE")).qtyG;

/**
 * Morning top-up: when the cash box runs low the owner withdraws from the bank (in ₹50,000
 * steps), bringing in capital first if the bank itself is short. Keeps every balance positive,
 * the way a real broker's cash flow looks.
 */
export async function topUpCash(
  godownId: string,
  bankId: string,
  date: string,
  floorRs = 100_000,
  targetRs = 300_000,
): Promise<void> {
  const cash = await cashBalance(godownId);
  if (cash >= Rb(floorRs)) return;
  const step = Rb(50_000);
  let withdraw = Rb(targetRs) - cash;
  withdraw = ((withdraw + step - 1n) / step) * step;
  const bank = await bankBalance(godownId, bankId);
  if (bank < withdraw + Rb(50_000)) {
    const bigStep = Rb(500_000);
    const need = withdraw + Rb(150_000) - bank;
    const cap = ((need + bigStep - 1n) / bigStep) * bigStep;
    await saveSimple(
      godownId,
      contraDraft({
        date,
        kind: "CAPITAL_IN",
        amountPaise: cap,
        bankId,
        notes: "Owner brought in working capital",
      }),
    );
  }
  await saveSimple(
    godownId,
    contraDraft({
      date,
      kind: "CASH_WITHDRAWAL",
      amountPaise: withdraw,
      bankId,
      notes: "Cash for paddy purchase",
    }),
  );
}

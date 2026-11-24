/**
 * recomputeVoucher: recompute every derived (stored) field of any voucher from its inputs.
 * verifyVoucher: compare stored derived fields with the recomputation → CALC_MISMATCH paths.
 * validateVoucherRules: cross-field business rules that Zod's structural schema can't express.
 * The server runs all three on every pushed op (spec §12.3 step 3).
 */
import { DomainError, type DomainErrorCode } from "../errors";
import { sumBig } from "../rounding";
import type { Voucher } from "../schemas/vouchers";
import { recomputeLoad } from "./load";
import { recomputePurchase } from "./purchase";
import { recomputeSale } from "./sale";
import { recomputeDayClose, recomputeSettlement } from "./settlement";
import { recomputeTrip } from "./trip";

export function recomputeVoucher<V extends Voucher>(v: V): V {
  switch (v.type) {
    case "PURCHASE":
      return recomputePurchase(v) as V;
    case "SALE":
      return recomputeSale(v) as V;
    case "LOAD":
      return recomputeLoad(v) as V;
    case "TRIP":
      return recomputeTrip(v) as V;
    case "MILL_SETTLEMENT":
      return recomputeSettlement(v) as V;
    case "DAY_CLOSE":
      return recomputeDayClose(v) as V;
    default:
      return v;
  }
}

/** Deep-compare stored vs recomputed; returns the list of differing paths (empty = OK). */
export function verifyVoucher(v: Voucher): string[] {
  let recomputed: Voucher;
  try {
    recomputed = recomputeVoucher(v);
  } catch (e) {
    return [e instanceof DomainError ? e.code : "RECOMPUTE_FAILED"];
  }
  const diffs: string[] = [];
  diffValues(v, recomputed, "", diffs);
  return diffs;
}

function diffValues(a: unknown, b: unknown, path: string, out: string[]): void {
  if (a === b) return;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    if (a !== b) out.push(path || "(root)");
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (av === undefined && bv === undefined) continue;
    diffValues(av, bv, path ? `${path}.${k}` : k, out);
  }
}

const NON_CASH_NEEDS_BANK = new Set(["BANK_TRANSFER", "UPI"]);

/** Business rules beyond the structural schema. Returns error codes (empty = valid). */
export function validateVoucherRules(v: Voucher): DomainErrorCode[] {
  const errs: DomainErrorCode[] = [];
  if ("interGodown" in v && v.interGodown) {
    const ig = v.interGodown;
    const sendType = v.type === "SALE" || v.type === "PAYMENT";
    if (ig.counterGodownId === v.godownId) errs.push("TRANSFER_SAME_GODOWN");
    if ((ig.side === "SEND") !== sendType || !v.groupId) errs.push("INVALID_REFERENCE");
  }
  switch (v.type) {
    case "PAYMENT":
      if (NON_CASH_NEEDS_BANK.has(v.mode) || v.mode === "CHEQUE" || v.mode === "DD") {
        if (!v.ourBankAccountId) errs.push("BANK_ACCOUNT_REQUIRED");
      }
      break;
    case "RECEIPT":
      if (NON_CASH_NEEDS_BANK.has(v.mode) && !v.ourBankAccountId)
        errs.push("BANK_ACCOUNT_REQUIRED");
      break;
    case "EXPENSE":
      if (v.onCredit && !v.payeePartyId) errs.push("PARTY_REQUIRED");
      if (!v.onCredit && v.mode !== "CASH" && v.mode !== "OTHER" && !v.bankAccountId) {
        errs.push("BANK_ACCOUNT_REQUIRED");
      }
      break;
    case "SALE": {
      const freight = BigInt(v.delivery?.amountPaise ?? "0");
      if (v.delivery?.payer === "US" && freight > 0n && !v.delivery.transporterPartyId) {
        errs.push("TRANSPORTER_REQUIRED");
      }
      if (v.vehicleAdvance && !v.delivery?.transporterPartyId) errs.push("TRANSPORTER_REQUIRED");
      if (v.loading?.payTo === "LABOUR_PARTY" && !v.loading.labourPartyId)
        errs.push("PARTY_REQUIRED");
      break;
    }
    case "LOAD":
      if (v.mode === "AGENT" && !v.commission) errs.push("COMMISSION_REQUIRED");
      if (v.mode === "AGENT" && v.commission?.payer === "SELLER" && !v.fromPartyId)
        errs.push("PARTY_REQUIRED");
      if (v.mode === "OWN_TRADE") {
        if (!v.fromStore && !v.fromPartyId) errs.push("PARTY_REQUIRED");
        if (!v.millRatePaisePerQtl || BigInt(v.millRatePaisePerQtl) <= 0n)
          errs.push("RATE_REQUIRED");
        if (
          !v.fromStore &&
          (!v.partySellRatePaisePerQtl || BigInt(v.partySellRatePaisePerQtl) <= 0n)
        ) {
          errs.push("RATE_REQUIRED");
        }
      }
      if (BigInt(v.netG) > BigInt(v.grossG)) errs.push("NET_EXCEEDS_GROSS");
      break;
    case "TRIP":
      if (!v.ownTradeLoadId && BigInt(v.freightPaise) > 0n && !v.hirerPartyId)
        errs.push("HIRER_REQUIRED");
      break;
    case "CONTRA":
      if (
        ["CASH_DEPOSIT", "CASH_WITHDRAWAL", "CHEQUE_CLEAR", "BANK_TRANSFER"].includes(v.kind) &&
        !v.bankAccountId
      ) {
        errs.push("BANK_ACCOUNT_REQUIRED");
      }
      if (v.kind === "BANK_TRANSFER" && !v.toBankAccountId) errs.push("BANK_ACCOUNT_REQUIRED");
      if (v.kind === "CHEQUE_BOUNCE" && !v.partyId) errs.push("PARTY_REQUIRED");
      break;
    case "DAY_CLOSE":
      if (BigInt(v.differencePaise) !== 0n && !v.notes?.trim()) errs.push("NOTE_REQUIRED");
      break;
    case "OPENING":
      for (const it of v.items) {
        if ((it.kind === "BANK" || it.kind === "PARTY") && !it.refId)
          errs.push("INVALID_REFERENCE");
        if (it.kind === "STOCK" && !it.varietyId) errs.push("INVALID_REFERENCE");
      }
      break;
    case "JOURNAL": {
      const dr = sumBig(v.lines.map((l) => BigInt(l.debitPaise)));
      const cr = sumBig(v.lines.map((l) => BigInt(l.creditPaise)));
      if (dr !== cr || dr === 0n) errs.push("JOURNAL_UNBALANCED");
      for (const l of v.lines) {
        const d = BigInt(l.debitPaise);
        const c = BigInt(l.creditPaise);
        if ((d > 0n && c > 0n) || (d === 0n && c === 0n)) errs.push("JOURNAL_LINE_INVALID");
      }
      break;
    }
    default:
      break;
  }
  return [...new Set(errs)];
}

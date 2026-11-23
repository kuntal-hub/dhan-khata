import type { PurchaseVoucher } from "../schemas/vouchers";
import { chargesFromJson, computeBill, recomputeTradeLine } from "./trade";
import type { PaymentDraft } from "./drafts";

type PurchaseLike = Pick<PurchaseVoucher, "lines" | "charges" | "roundToRupee">;

/** Recompute every derived field of a purchase (lines' net/amount, round-off, total). */
export function recomputePurchase<T extends PurchaseLike>(
  v: T,
): T & { roundOffPaise: string; totalPaise: string } {
  const lines = v.lines.map(recomputeTradeLine);
  const bill = computeBill(
    lines.map((l) => BigInt(l.amountPaise)),
    chargesFromJson(v.charges),
    v.roundToRupee,
  );
  return {
    ...v,
    lines,
    roundOffPaise: bill.roundOff.toString(),
    totalPaise: bill.total.toString(),
  };
}

/** "আজ কত টাকা দেওয়া হয়েছে" → linked PAYMENT draft in the same group. */
export function paidNowPaymentDraft(
  p: PurchaseVoucher | (Omit<PurchaseVoucher, "_id"> & { _id?: string }),
): PaymentDraft | null {
  if (!p.paidNow) return null;
  return {
    type: "PAYMENT",
    date: p.date,
    season: p.season,
    groupId: p.groupId,
    partyId: p.partyId,
    amountPaise: p.paidNow.amountPaise,
    mode: p.paidNow.mode,
    ourBankAccountId: p.paidNow.bankAccountId,
    utrOrRef: p.paidNow.ref,
    purpose: "BILL",
    allocations: p._id ? [{ voucherId: p._id, amountPaise: p.paidNow.amountPaise }] : undefined,
  };
}

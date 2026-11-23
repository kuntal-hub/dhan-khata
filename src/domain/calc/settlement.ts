/**
 * Mill settlement (spec §8.2 MILL_SETTLEMENT): mill's received weight and cuts vs our dispatch.
 *   millNetG       = millReceivedGrossG − Σ g − Σ round(gross × bps / 10,000)
 *   finalAmount    = round(millNetG × finalRate / 100,000) − Σ ₹ cuts
 *   difference     = finalAmount − sale total     (negative = cut → SALES_DEDUCTION)
 *   shortageG      = dispatched net − millNetG
 */
import { DomainError } from "../errors";
import { amountForWeight, applyBps } from "../money";
import { sumBig } from "../rounding";
import type { DayCloseVoucher, MillSettlementVoucher } from "../schemas/vouchers";

export function recomputeSettlement(v: MillSettlementVoucher): MillSettlementVoucher {
  const gross = BigInt(v.millReceivedGrossG);
  const gCuts = sumBig(v.millDeductions.map((d) => BigInt(d.g ?? "0")));
  const bpsCuts = sumBig(v.millDeductions.map((d) => applyBps(gross, BigInt(d.bps ?? 0))));
  const paiseCuts = sumBig(v.millDeductions.map((d) => BigInt(d.paise ?? "0")));
  const millNet = gross - gCuts - bpsCuts;
  if (millNet <= 0n) throw new DomainError("NET_NOT_POSITIVE");
  const finalAmount = amountForWeight(millNet, BigInt(v.finalRatePaisePerQtl)) - paiseCuts;
  if (finalAmount < 0n) throw new DomainError("TOTAL_NEGATIVE");
  return {
    ...v,
    millNetG: millNet.toString(),
    finalAmountPaise: finalAmount.toString(),
    differencePaise: (finalAmount - BigInt(v.saleTotalPaise)).toString(),
    shortageG: (BigInt(v.dispatchedNetG) - millNet).toString(),
  };
}

/** Day close: difference = counted − expected (negative = shortage). */
export function recomputeDayClose(v: DayCloseVoucher): DayCloseVoucher {
  return {
    ...v,
    differencePaise: (BigInt(v.countedCashPaise) - BigInt(v.expectedCashPaise)).toString(),
  };
}

/**
 * Denomination helper: { "500": 3, "200": 1, "coinsPaise": 4550 } → paise.
 * Numeric keys are rupee note values with their counts; `coinsPaise` is the loose-coin total in paise.
 */
export function countDenominations(counts: Record<string, number>): bigint {
  let total = 0n;
  for (const [key, count] of Object.entries(counts)) {
    if (!Number.isInteger(count) || count < 0) throw new RangeError("bad count");
    if (key === "coinsPaise") total += BigInt(count);
    else total += BigInt(key) * 100n * BigInt(count);
  }
  return total;
}

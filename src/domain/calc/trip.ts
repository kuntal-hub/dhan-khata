import { amountForWeight } from "../money";
import { sumBig } from "../rounding";
import type { TripVoucher } from "../schemas/vouchers";

/** freight = PER_QUINTAL: round(qtyG × rate / 100,000) | FIXED: rate. due = freight − advance. */
export function recomputeTrip(v: TripVoucher): TripVoucher {
  const rate = BigInt(v.ratePaise);
  const freight =
    v.rateMode === "PER_QUINTAL" ? amountForWeight(BigInt(v.qtyG ?? "0"), rate) : rate;
  const advance = BigInt(v.advanceReceivedPaise ?? "0");
  // Own vehicle carrying our own load: no freight income, nothing due from a hirer ([CONFIRM] #7).
  const due = v.ownTradeLoadId ? 0n : freight - advance;
  return { ...v, freightPaise: freight.toString(), duePaise: due.toString() };
}

export function tripExpensesTotal(v: TripVoucher): bigint {
  return sumBig(v.expenses.map((e) => BigInt(e.amountPaise)));
}

/** Net profit of a trip = freight income − trip expenses (income is 0 for own-trade loads). */
export function tripProfit(v: TripVoucher): bigint {
  const income = v.ownTradeLoadId ? 0n : BigInt(v.freightPaise);
  return income - tripExpensesTotal(v);
}

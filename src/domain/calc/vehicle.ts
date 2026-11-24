/**
 * Vehicle business P&L (spec §9.7): per vehicle over a period.
 *   freight earned  = Σ trip freight (0 for own-trade loads, [CONFIRM] #7)
 *   expenses        = Σ trip expenses by kind + Σ EXPENSE vouchers tagged with the vehicle
 *   net profit      = freight − expenses
 *   due from hirers = Σ trip due (freight − advance received at the trip)
 *   ₹/km            = expenses of trips with both odometer readings ÷ their km (if any)
 */
import { divRoundHalfUp } from "../rounding";
import type { ExpenseVoucher, TripVoucher } from "../schemas/vouchers";
import { TRIP_EXPENSE_KINDS } from "../schemas/vouchers";
import { tripExpensesTotal } from "./trip";

export type TripExpenseKind = (typeof TRIP_EXPENSE_KINDS)[number];

export interface VehiclePnl {
  tripCount: number;
  freightPaise: bigint;
  expensesByKind: Record<TripExpenseKind, bigint>;
  /** EXPENSE vouchers tagged with this vehicle (repairs paid from the daily expense screen…). */
  otherExpensesPaise: bigint;
  totalExpensesPaise: bigint;
  netProfitPaise: bigint;
  dueFromHirersPaise: bigint;
  dieselMl: bigint;
  km: bigint;
  /** Paise per km over the trips that have odometer readings; null when none do. */
  perKmPaise: bigint | null;
}

export function vehiclePnl(
  trips: readonly TripVoucher[],
  expenses: readonly ExpenseVoucher[] = [],
): VehiclePnl {
  const byKind = Object.fromEntries(TRIP_EXPENSE_KINDS.map((k) => [k, 0n])) as Record<
    TripExpenseKind,
    bigint
  >;
  let freight = 0n;
  let due = 0n;
  let diesel = 0n;
  let km = 0n;
  let kmExpenses = 0n;
  let tripCount = 0;
  for (const t of trips) {
    if (t.status !== "active") continue;
    tripCount++;
    if (!t.ownTradeLoadId) freight += BigInt(t.freightPaise);
    due += BigInt(t.duePaise);
    for (const e of t.expenses) {
      byKind[e.kind] += BigInt(e.amountPaise);
      if (e.kind === "DIESEL") diesel += BigInt(e.litresMl ?? "0");
    }
    if (
      t.odometerStartKm !== undefined &&
      t.odometerEndKm !== undefined &&
      t.odometerEndKm > t.odometerStartKm
    ) {
      km += BigInt(t.odometerEndKm - t.odometerStartKm);
      kmExpenses += tripExpensesTotal(t);
    }
  }
  let other = 0n;
  for (const e of expenses) if (e.status === "active") other += BigInt(e.amountPaise);
  let tripExp = 0n;
  for (const k of TRIP_EXPENSE_KINDS) tripExp += byKind[k];
  const total = tripExp + other;
  return {
    tripCount,
    freightPaise: freight,
    expensesByKind: byKind,
    otherExpensesPaise: other,
    totalExpensesPaise: total,
    netProfitPaise: freight - total,
    dueFromHirersPaise: due,
    dieselMl: diesel,
    km,
    perKmPaise: km > 0n ? divRoundHalfUp(kmExpenses, km) : null,
  };
}

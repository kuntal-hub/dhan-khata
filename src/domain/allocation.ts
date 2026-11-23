/**
 * Bill settlement status (spec §9.6): payments are auto-allocated FIFO to the oldest open bill
 * unless the user picked bills manually. Anything left over is an unallocated advance.
 */
import { minBig } from "./rounding";

export type BillStatus = "OPEN" | "PARTIAL" | "SETTLED";

export interface Bill {
  voucherId: string;
  date: string;
  number: string;
  totalPaise: bigint;
}

export interface MoneyMovement {
  voucherId: string;
  date: string;
  amountPaise: bigint;
  /** Manual allocations chosen by the user. */
  allocations?: readonly { voucherId: string; amountPaise: bigint }[];
}

export interface BillState {
  voucherId: string;
  totalPaise: bigint;
  paidPaise: bigint;
  outstandingPaise: bigint;
  status: BillStatus;
}

export function billStatus(total: bigint, paid: bigint): BillStatus {
  if (paid <= 0n) return total === 0n ? "SETTLED" : "OPEN";
  return paid >= total ? "SETTLED" : "PARTIAL";
}

function billOrder(a: Bill, b: Bill): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
}

/** FIFO allocation of `amount` across open bills (already ordered oldest-first). */
export function allocateFifo(
  openBills: readonly { voucherId: string; outstandingPaise: bigint }[],
  amount: bigint,
): { allocations: { voucherId: string; amountPaise: bigint }[]; unallocated: bigint } {
  let left = amount;
  const allocations: { voucherId: string; amountPaise: bigint }[] = [];
  for (const b of openBills) {
    if (left <= 0n) break;
    if (b.outstandingPaise <= 0n) continue;
    const take = minBig(left, b.outstandingPaise);
    allocations.push({ voucherId: b.voucherId, amountPaise: take });
    left -= take;
  }
  return { allocations, unallocated: left };
}

/**
 * Settle a party's bills with its money movements (payments for purchases, receipts for sales).
 * 1) manual allocations first (capped at each bill's outstanding), 2) every remaining amount FIFO
 * to the oldest open bills, 3) leftover = unallocated advance.
 */
export function settleBills(
  bills: readonly Bill[],
  movements: readonly MoneyMovement[],
): { bills: BillState[]; unallocatedPaise: bigint } {
  const ordered = [...bills].sort(billOrder);
  const paid = new Map<string, bigint>(ordered.map((b) => [b.voucherId, 0n]));
  const totals = new Map<string, bigint>(ordered.map((b) => [b.voucherId, b.totalPaise]));
  const outstanding = (id: string) => (totals.get(id) ?? 0n) - (paid.get(id) ?? 0n);

  let pool = 0n;
  const sortedMovements = [...movements].sort((a, b) =>
    a.date === b.date ? (a.voucherId < b.voucherId ? -1 : 1) : a.date < b.date ? -1 : 1,
  );
  for (const m of sortedMovements) {
    let left = m.amountPaise;
    for (const a of m.allocations ?? []) {
      if (!paid.has(a.voucherId) || left <= 0n) continue;
      const take = minBig(minBig(a.amountPaise, left), outstanding(a.voucherId));
      if (take <= 0n) continue;
      paid.set(a.voucherId, (paid.get(a.voucherId) ?? 0n) + take);
      left -= take;
    }
    pool += left;
  }

  const fifo = allocateFifo(
    ordered.map((b) => ({ voucherId: b.voucherId, outstandingPaise: outstanding(b.voucherId) })),
    pool,
  );
  for (const a of fifo.allocations)
    paid.set(a.voucherId, (paid.get(a.voucherId) ?? 0n) + a.amountPaise);

  return {
    bills: ordered.map((b) => {
      const p = paid.get(b.voucherId) ?? 0n;
      return {
        voucherId: b.voucherId,
        totalPaise: b.totalPaise,
        paidPaise: p,
        outstandingPaise: b.totalPaise - p,
        status: billStatus(b.totalPaise, p),
      };
    }),
    unallocatedPaise: fifo.unallocated,
  };
}

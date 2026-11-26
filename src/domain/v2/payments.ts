/**
 * Derived "paid" and "remaining due" (requirement_v2 §7.2). Nothing here is stored: every value
 * is a query over the source document and its ACTIVE payments.
 *
 *   Remaining due (any bill) = Bill total − Σ active linked payments
 */
import { divRoundHalfUp, minBig, sumBig } from "../rounding";
import { compareYmd, diffDays } from "../dates";
import { directionFor } from "./direction";
import type { Doc, Payment, PaymentSourceType, Trip } from "./schemas";

export type Direction = "IN" | "OUT";
export type PayStatus = "PAID" | "PARTIAL" | "UNPAID" | "OVERDUE";

/** A bill that payments can settle. */
export interface Bill {
  sourceType: PaymentSourceType;
  sourceId: string;
  /** Who the money moves with (absent for expenses without a party). */
  partyId?: string;
  /** Money direction that settles this bill (OUT = we pay it). */
  direction: Direction;
  totalPaise: bigint;
  date: string;
  dueDate?: string;
}

/** Bills a document creates (a trip creates its income bill plus one bill per cost). */
export function billsOf(d: Doc): Bill[] {
  if (d.status !== "active") return [];
  switch (d.type) {
    case "PURCHASE":
      return [
        bill("PURCHASE", d._id, "OUT", d.totalPaise, d.transactionDate, d.partyId, d.dueDate),
      ];
    case "SALE":
      return [bill("SALE", d._id, "IN", d.totalPaise, d.transactionDate, d.partyId, d.dueDate)];
    case "EXPENSE":
      return [bill("EXPENSE", d._id, "OUT", d.amountPaise, d.expenseDate, d.partyId, d.dueDate)];
    case "MILL_DISPATCH":
      // The mill pays us for the paddy (v2.1): always a collection, whatever the old type was.
      return [
        bill(
          "MILL_DISPATCH",
          d._id,
          directionFor("MILL_DISPATCH")!,
          d.totalValuePaise,
          d.dispatchDate,
          d.millPartyId,
          d.dueDate,
        ),
      ];
    case "TRIP":
      return [
        ...(BigInt(d.totalIncomePaise) > 0n
          ? [
              bill(
                "VEHICLE_TRIP",
                d._id,
                "IN",
                d.totalIncomePaise,
                d.transactionDate,
                d.customerPartyId,
                d.dueDate,
              ),
            ]
          : []),
        ...d.costs.map((c) =>
          bill(
            "VEHICLE_COST",
            vehicleCostSourceId(d, c.id),
            "OUT",
            c.amountPaise,
            d.transactionDate,
            c.partyId,
          ),
        ),
      ];
    case "SECOND_PARTY":
      return [
        bill(
          "SECOND_PARTY",
          d._id,
          d.kind === "WE_OWE" ? "OUT" : "IN",
          d.amountPaise,
          d.transactionDate,
          d.partyId,
          d.dueDate,
        ),
      ];
    case "OPENING":
      return d.items
        .filter((it) => it.kind === "PARTY" && it.refId && BigInt(it.amountPaise) !== 0n)
        .map((it) => {
          const amt = BigInt(it.amountPaise);
          return {
            sourceType: "OPENING_DUE" as const,
            sourceId: openingDueSourceId(d._id, it.refId!),
            partyId: it.refId,
            direction: amt > 0n ? ("IN" as const) : ("OUT" as const),
            totalPaise: amt > 0n ? amt : -amt,
            date: d.transactionDate,
          };
        });
    default:
      return [];
  }
}

/**
 * Bills that are real money owed (dues, reminders, Due & Advance). An ORDER is not owed (D3).
 * A mill dispatch's bill is netted by `millCredits` (paddy returned + final-settlement
 * adjustment), so "remaining" never counts paddy the mill gave back or did not accept.
 */
export function dueBillsOf(d: Doc, millCredits?: ReadonlyMap<string, bigint>): Bill[] {
  if (d.type === "SALE" && d.saleStatus === "ORDER") return [];
  const bills = billsOf(d);
  if (d.type !== "MILL_DISPATCH" || !millCredits) return bills;
  const credit = millCredits.get(d._id) ?? 0n;
  return bills.map((b) => ({ ...b, totalPaise: b.totalPaise - credit }));
}

/**
 * What reduces each dispatch's receivable (v2.1): the credit of every active paddy return and
 * the adjustment of the active final settlement (signed: a cut is positive). Keyed by dispatch.
 */
export function millCredits(docs: Iterable<Doc>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const add = (id: string, v: bigint) => out.set(id, (out.get(id) ?? 0n) + v);
  for (const d of docs) {
    if (d.status !== "active") continue;
    if (d.type === "MILL_RETURN" && d.product === "PADDY")
      add(d.dispatchId, BigInt(d.totalValuePaise ?? "0"));
    if (d.type === "MILL_SETTLEMENT") add(d.dispatchId, BigInt(d.adjustmentPaise));
  }
  return out;
}

function bill(
  sourceType: PaymentSourceType,
  sourceId: string,
  direction: Direction,
  total: string,
  date: string,
  partyId?: string,
  dueDate?: string,
): Bill {
  return {
    sourceType,
    sourceId,
    direction,
    totalPaise: BigInt(total),
    date,
    ...(partyId ? { partyId } : {}),
    ...(dueDate ? { dueDate } : {}),
  };
}

export const vehicleCostSourceId = (trip: Pick<Trip, "_id">, costId: string) =>
  `${trip._id}:${costId}`;
export const openingDueSourceId = (openingId: string, partyId: string) => `${openingId}:${partyId}`;

/** Active payments that settle `sourceId` (any type). */
export function paymentsFor(sourceId: string, payments: readonly Payment[]): Payment[] {
  return payments.filter((p) => p.status === "active" && p.source.id === sourceId);
}

/** Σ payments for a bill; a payment in the opposite direction (refund) counts negative. */
export function paidFor(
  b: Pick<Bill, "sourceId" | "direction">,
  payments: readonly Payment[],
): bigint {
  return sumBig(
    paymentsFor(b.sourceId, payments).map((p) =>
      p.direction === b.direction ? BigInt(p.amountPaise) : -BigInt(p.amountPaise),
    ),
  );
}

export interface BillState {
  bill: Bill;
  paidPaise: bigint;
  /** total − paid (negative = paid more than the bill). */
  duePaise: bigint;
  status: PayStatus;
  overdueDays: number;
}

export function billState(b: Bill, payments: readonly Payment[], today: string): BillState {
  const paid = paidFor(b, payments);
  const due = b.totalPaise - paid;
  let status: PayStatus;
  if (due <= 0n) status = "PAID";
  else if (b.dueDate && compareYmd(b.dueDate, today) < 0) status = "OVERDUE";
  else if (paid > 0n) status = "PARTIAL";
  else status = "UNPAID";
  const overdueDays = status === "OVERDUE" && b.dueDate ? diffDays(b.dueDate, today) : 0;
  return { bill: b, paidPaise: paid, duePaise: due, status, overdueDays };
}

/**
 * A payment larger than the remaining due: the bill part and the extra that becomes a
 * PARTY_ADVANCE (only after the user confirms, §7.2). Never double-counts.
 */
export function splitOverpayment(
  amountPaise: bigint,
  duePaise: bigint,
): { billPaise: bigint; advancePaise: bigint } {
  const billPaise = duePaise > 0n ? minBig(amountPaise, duePaise) : 0n;
  return { billPaise, advancePaise: amountPaise - billPaise };
}

export interface Allocation {
  sourceType: PaymentSourceType;
  sourceId: string;
  amountPaise: bigint;
}

/**
 * Allocate a party payment over open bills, oldest first (FIFO, §12.6). Bills must all settle in
 * the payment's direction. The rest is an on-account advance.
 */
export function allocateFifo(
  amountPaise: bigint,
  open: readonly BillState[],
): { allocations: Allocation[]; advancePaise: bigint } {
  const sorted = [...open]
    .filter((s) => s.duePaise > 0n)
    .sort(
      (a, b) =>
        compareYmd(a.bill.date, b.bill.date) || (a.bill.sourceId < b.bill.sourceId ? -1 : 1),
    );
  let left = amountPaise;
  const allocations: Allocation[] = [];
  for (const s of sorted) {
    if (left <= 0n) break;
    const take = minBig(left, s.duePaise);
    allocations.push({
      sourceType: s.bill.sourceType,
      sourceId: s.bill.sourceId,
      amountPaise: take,
    });
    left -= take;
  }
  return { allocations, advancePaise: left };
}

/** Percentage paid in basis points (display). */
export function paidBps(s: Pick<BillState, "paidPaise" | "bill">): bigint {
  if (s.bill.totalPaise <= 0n) return 10_000n;
  return divRoundHalfUp(s.paidPaise * 10_000n, s.bill.totalPaise);
}

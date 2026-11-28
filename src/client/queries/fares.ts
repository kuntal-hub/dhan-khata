/**
 * Vehicle Fare & Owner Ledger reads (DECISIONS D56), one Gola at a time. Nothing is stored:
 *   earned      = Σ fares of the owner's active purchases
 *   paid        = Σ active VEHICLE_FARE payments to him
 *   outstanding = Σ remaining of each fare (earned − paid, never below 0 per fare)
 * His overall ledger balance (other dealings, advances) is shown beside it, never mixed in.
 */
import { todayIST } from "@/domain/dates";
import { billState, billsOf, type BillState } from "@/domain/v2/payments";
import type { DocOf, Party, Payment } from "@/domain/schemas";
import { db } from "../db/dexie";
import { godownBalances } from "./ledger";

export type Purchase = DocOf<"PURCHASE">;

export interface FareDelivery {
  purchase: Purchase;
  farmer?: Party;
  /** The fare's own bill (VEHICLE_FARE): paid / remaining / status. */
  state: BillState;
  /** Active payments of this fare, oldest first. */
  payments: Payment[];
}

export interface OwnerTotals {
  jobs: number;
  earnedPaise: bigint;
  paidPaise: bigint;
  outstandingPaise: bigint;
}

export interface OwnerSummary extends OwnerTotals {
  party: Party;
  /** Ledger balance of the party (all dealings): < 0 we owe him. */
  balancePaise: bigint;
  lastDate?: string;
}

/** One payment as the user made it: the per-fare parts of a payment share a group. */
export interface OwnerPayment {
  key: string;
  date: string;
  amountPaise: bigint;
  mode: Payment["mode"];
  reference?: string;
  notes?: string;
  status: Payment["status"];
  isInitial: boolean;
  /** Every record of the payment (one per fare it paid). */
  parts: Payment[];
}

const byDate = (a: Payment, b: Payment) =>
  a.paymentDate === b.paymentDate
    ? a.createdAt.localeCompare(b.createdAt)
    : a.paymentDate.localeCompare(b.paymentDate);

async function golaFareData(godownId: string) {
  const d = db();
  const [purchases, payments] = await Promise.all([
    d.vouchers.where("[godownId+type]").equals([godownId, "PURCHASE"]).toArray(),
    d.vouchers.where("[godownId+type]").equals([godownId, "PAYMENT"]).toArray(),
  ]);
  const withFare = purchases.filter(
    (p): p is Purchase => p.type === "PURCHASE" && p.status === "active" && !!p.vehicleFare,
  );
  const farePays = payments.filter(
    (p): p is Payment => p.type === "PAYMENT" && p.source.type === "VEHICLE_FARE",
  );
  const bySource = new Map<string, Payment[]>();
  for (const p of farePays) {
    if (p.status !== "active" || !p.source.id) continue;
    bySource.set(p.source.id, [...(bySource.get(p.source.id) ?? []), p]);
  }
  return { withFare, farePays, bySource };
}

function deliveryOf(
  purchase: Purchase,
  bySource: ReadonlyMap<string, Payment[]>,
  today: string,
  farmer?: Party,
): FareDelivery {
  const bill = billsOf(purchase).find((b) => b.sourceType === "VEHICLE_FARE")!;
  const payments = [...(bySource.get(bill.sourceId) ?? [])].sort(byDate);
  return {
    purchase,
    ...(farmer ? { farmer } : {}),
    state: billState(bill, payments, today),
    payments,
  };
}

export function ownerTotals(deliveries: readonly FareDelivery[]): OwnerTotals {
  let earned = 0n;
  let paid = 0n;
  let outstanding = 0n;
  for (const x of deliveries) {
    earned += x.state.bill.totalPaise;
    paid += x.state.paidPaise;
    if (x.state.duePaise > 0n) outstanding += x.state.duePaise;
  }
  return {
    jobs: deliveries.length,
    earnedPaise: earned,
    paidPaise: paid,
    outstandingPaise: outstanding,
  };
}

/** Every vehicle owner of the Gola (role TRANSPORTER or named on a fare) with his totals. */
export async function vehicleOwnerSummaries(
  godownId: string,
  today = todayIST(),
): Promise<OwnerSummary[]> {
  const [{ withFare, bySource }, parties, balances] = await Promise.all([
    golaFareData(godownId),
    db().parties.where("godownId").equals(godownId).toArray(),
    godownBalances(godownId),
  ]);
  const byOwner = new Map<string, FareDelivery[]>();
  for (const p of withFare) {
    const owner = p.vehicleFare!.ownerPartyId;
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), deliveryOf(p, bySource, today)]);
  }
  return parties
    .filter((p) => p.status === "active" && (p.roles.includes("TRANSPORTER") || byOwner.has(p._id)))
    .map((party) => {
      const list = byOwner.get(party._id) ?? [];
      const last = list
        .map((x) => x.purchase.transactionDate)
        .sort()
        .at(-1);
      return {
        party,
        ...ownerTotals(list),
        balancePaise: balances.get(`PARTY:${party._id}`) ?? 0n,
        ...(last ? { lastDate: last } : {}),
      };
    })
    .sort((a, b) =>
      a.outstandingPaise === b.outstandingPaise
        ? a.party.name.localeCompare(b.party.name)
        : a.outstandingPaise > b.outstandingPaise
          ? -1
          : 1,
    );
}

/** Group fare payments as the user made them (one group = one payment across several fares). */
export function groupOwnerPayments(payments: readonly Payment[]): OwnerPayment[] {
  const groups = new Map<string, Payment[]>();
  for (const p of [...payments].sort(byDate)) {
    const key = p.groupId ?? p._id;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .map(([key, parts]) => {
      const first = parts[0]!;
      return {
        key,
        date: first.paymentDate,
        amountPaise: parts.reduce((s, p) => s + BigInt(p.amountPaise), 0n),
        mode: first.mode,
        ...(first.reference ? { reference: first.reference } : {}),
        ...(first.notes ? { notes: first.notes } : {}),
        status: parts.every((p) => p.status === "void") ? ("void" as const) : ("active" as const),
        isInitial: parts.some((p) => p.isInitial),
        parts,
      };
    })
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

export interface OwnerLedger {
  party: Party;
  summary: OwnerSummary;
  /** Newest first. */
  deliveries: FareDelivery[];
  /** Newest first, reversed ones included (marked void). */
  payments: OwnerPayment[];
}

/** One vehicle owner's fare ledger: deliveries (farmer, fare, status) and payments. */
export async function vehicleOwnerLedger(
  godownId: string,
  partyId: string,
  today = todayIST(),
): Promise<OwnerLedger | null> {
  const party = await db().parties.get(partyId);
  if (!party || party.godownId !== godownId) return null;
  const [{ withFare, farePays, bySource }, parties, balances] = await Promise.all([
    golaFareData(godownId),
    db().parties.where("godownId").equals(godownId).toArray(),
    godownBalances(godownId),
  ]);
  const pById = new Map(parties.map((p) => [p._id, p] as const));
  const deliveries = withFare
    .filter((p) => p.vehicleFare!.ownerPartyId === partyId)
    .map((p) => deliveryOf(p, bySource, today, pById.get(p.partyId)))
    .sort((a, b) =>
      a.purchase.transactionDate === b.purchase.transactionDate
        ? b.purchase.createdAt.localeCompare(a.purchase.createdAt)
        : a.purchase.transactionDate < b.purchase.transactionDate
          ? 1
          : -1,
    );
  const last = deliveries[0]?.purchase.transactionDate;
  return {
    party,
    summary: {
      party,
      ...ownerTotals(deliveries),
      balancePaise: balances.get(`PARTY:${partyId}`) ?? 0n,
      ...(last ? { lastDate: last } : {}),
    },
    deliveries,
    payments: groupOwnerPayments(farePays.filter((p) => p.partyId === partyId)),
  };
}

export interface FareRow extends FareDelivery {
  owner?: Party;
}

/** Fares of the Gola in a date range (purchase date), oldest first — for reports. */
export async function fareRows(
  godownId: string,
  from = "",
  to = "￿",
  today = todayIST(),
): Promise<FareRow[]> {
  const [{ withFare, bySource }, parties] = await Promise.all([
    golaFareData(godownId),
    db().parties.where("godownId").equals(godownId).toArray(),
  ]);
  const pById = new Map(parties.map((p) => [p._id, p] as const));
  return withFare
    .filter((p) => p.transactionDate >= from && p.transactionDate <= to)
    .sort((a, b) =>
      a.transactionDate === b.transactionDate
        ? a.createdAt.localeCompare(b.createdAt)
        : a.transactionDate < b.transactionDate
          ? -1
          : 1,
    )
    .map((p) => {
      const owner = pById.get(p.vehicleFare!.ownerPartyId);
      return {
        ...deliveryOf(p, bySource, today, pById.get(p.partyId)),
        ...(owner ? { owner } : {}),
      };
    });
}

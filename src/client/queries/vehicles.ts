/**
 * Vehicle Business reads (requirement_v2 §12.7). Per trip: income (customer bill, received / due),
 * costs (driver, diesel, other; each paid / due) and
 *
 *   Net profit = Total income − Driver cost − Diesel cost − Other expenses
 *
 * Daily-expense entries linked to a vehicle are shown with that vehicle's costs (labelled), so
 * nothing is counted twice: they are separate records from the trip costs.
 */
import { todayIST } from "@/domain/dates";
import { billState, billsOf, vehicleCostSourceId, type BillState } from "@/domain/v2/payments";
import type { DocOf, Party, Payment, Vehicle } from "@/domain/schemas";
import { db } from "../db/dexie";

export type Trip = DocOf<"TRIP">;
export type CostKind = Trip["costs"][number]["kind"];

export interface TripRow {
  doc: Trip;
  vehicle?: Vehicle;
  customer?: Party;
  income?: BillState;
  costs: Array<{ cost: Trip["costs"][number]; state: BillState }>;
  costPaise: bigint;
  netPaise: bigint;
}

async function tripPayments(godownId: string): Promise<Map<string, Payment[]>> {
  const pays = (await db()
    .vouchers.where("[godownId+type]")
    .equals([godownId, "PAYMENT"])
    .filter(
      (x) =>
        x.type === "PAYMENT" &&
        x.status === "active" &&
        (x.source.type === "VEHICLE_TRIP" || x.source.type === "VEHICLE_COST"),
    )
    .toArray()) as Payment[];
  const m = new Map<string, Payment[]>();
  for (const p of pays) m.set(p.source.id!, [...(m.get(p.source.id!) ?? []), p]);
  return m;
}

export function tripRow(
  doc: Trip,
  pays: Map<string, Payment[]>,
  vehicle?: Vehicle,
  customer?: Party,
  today = todayIST(),
): TripRow {
  const bills = billsOf({ ...doc, status: "active" });
  const incomeBill = bills.find((b) => b.sourceType === "VEHICLE_TRIP");
  const costs = doc.costs.map((cost) => {
    const sid = vehicleCostSourceId(doc, cost.id);
    const bill = bills.find((b) => b.sourceId === sid)!;
    return { cost, state: billState(bill, pays.get(sid) ?? [], today) };
  });
  const costPaise = doc.costs.reduce((s, c) => s + BigInt(c.amountPaise), 0n);
  return {
    doc,
    ...(vehicle ? { vehicle } : {}),
    ...(customer ? { customer } : {}),
    ...(incomeBill ? { income: billState(incomeBill, pays.get(doc._id) ?? [], today) } : {}),
    costs,
    costPaise,
    netPaise: BigInt(doc.totalIncomePaise) - costPaise,
  };
}

export interface TripFilter {
  from?: string;
  to?: string;
  vehicleId?: string;
  customerId?: string;
  q?: string;
}

export async function tripRows(godownId: string, f: TripFilter = {}): Promise<TripRow[]> {
  const d = db();
  const docs = (await d.vouchers
    .where("[godownId+transactionDate]")
    .between([godownId, f.from ?? ""], [godownId, f.to ?? "￿"], true, true)
    .filter((x) => x.type === "TRIP")
    .toArray()) as Trip[];
  const [vehicles, parties, pays] = await Promise.all([
    d.vehicles.where("godownId").equals(godownId).toArray(),
    d.parties.where("godownId").equals(godownId).toArray(),
    tripPayments(godownId),
  ]);
  const v = new Map(vehicles.map((x) => [x._id, x] as const));
  const p = new Map(parties.map((x) => [x._id, x] as const));
  const s = f.q?.trim().toLowerCase() ?? "";
  const out: TripRow[] = [];
  for (const doc of docs) {
    if (f.vehicleId && doc.vehicleId !== f.vehicleId) continue;
    if (f.customerId && doc.customerPartyId !== f.customerId) continue;
    const row = tripRow(
      doc,
      pays,
      v.get(doc.vehicleId),
      doc.customerPartyId ? p.get(doc.customerPartyId) : undefined,
    );
    if (s) {
      const hay = [
        row.vehicle?.number,
        row.customer?.name,
        row.customer?.searchKey,
        doc.driverName,
        doc.loadingLocation,
        doc.destination,
        doc.number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(s) && !hay.includes(s.replace(/\s+/g, ""))) continue;
    }
    out.push(row);
  }
  return out.sort((a, b) =>
    a.doc.transactionDate === b.doc.transactionDate
      ? a.doc.createdAt < b.doc.createdAt
        ? 1
        : -1
      : a.doc.transactionDate < b.doc.transactionDate
        ? 1
        : -1,
  );
}

export interface PnL {
  trips: number;
  incomePaise: bigint;
  receivedPaise: bigint;
  dueInPaise: bigint;
  cost: Record<CostKind, bigint>;
  /** Daily-expense entries linked to the vehicle (shown apart; not trip costs). */
  expensePaise: bigint;
  netPaise: bigint;
}

function emptyPnl(): PnL {
  return {
    trips: 0,
    incomePaise: 0n,
    receivedPaise: 0n,
    dueInPaise: 0n,
    cost: { DRIVER: 0n, DIESEL: 0n, OTHER: 0n },
    expensePaise: 0n,
    netPaise: 0n,
  };
}

function add(p: PnL, r: TripRow): void {
  if (r.doc.status !== "active") return;
  p.trips++;
  p.incomePaise += BigInt(r.doc.totalIncomePaise);
  p.receivedPaise += r.income?.paidPaise ?? 0n;
  p.dueInPaise += r.income && r.income.duePaise > 0n ? r.income.duePaise : 0n;
  for (const c of r.doc.costs) p.cost[c.kind] += BigInt(c.amountPaise);
  p.netPaise += r.netPaise;
}

/** Expenses (Daily Expenses) linked to each vehicle, by vehicle id and month. */
async function vehicleExpenses(
  godownId: string,
  from?: string,
  to?: string,
): Promise<Array<{ vehicleId: string; date: string; amount: bigint }>> {
  const docs = (await db()
    .vouchers.where("[godownId+type]")
    .equals([godownId, "EXPENSE"])
    .filter((x) => x.type === "EXPENSE" && x.status === "active" && !!x.vehicleId)
    .toArray()) as Array<DocOf<"EXPENSE">>;
  return docs
    .filter((x) => (!from || x.expenseDate >= from) && (!to || x.expenseDate <= to))
    .map((x) => ({ vehicleId: x.vehicleId!, date: x.expenseDate, amount: BigInt(x.amountPaise) }));
}

export interface VehicleSummary {
  vehicle: Vehicle;
  pnl: PnL;
}

export async function vehicleSummaries(
  godownId: string,
  from?: string,
  to?: string,
): Promise<VehicleSummary[]> {
  const vehicles = (await db().vehicles.where("godownId").equals(godownId).toArray()).filter(
    (v) => v.status === "active",
  );
  const rows = await tripRows(godownId, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const exp = await vehicleExpenses(godownId, from, to);
  return vehicles
    .map((vehicle) => {
      const pnl = emptyPnl();
      for (const r of rows) if (r.doc.vehicleId === vehicle._id) add(pnl, r);
      for (const e of exp) if (e.vehicleId === vehicle._id) pnl.expensePaise += e.amount;
      return { vehicle, pnl };
    })
    .sort((a, b) => (a.pnl.netPaise > b.pnl.netPaise ? -1 : 1));
}

export interface CustomerTrips {
  party: Party;
  pnl: PnL;
}

export async function tripCustomerSummaries(godownId: string): Promise<CustomerTrips[]> {
  const rows = await tripRows(godownId);
  const parties = new Map(
    (await db().parties.where("godownId").equals(godownId).toArray()).map(
      (p) => [p._id, p] as const,
    ),
  );
  const m = new Map<string, PnL>();
  for (const r of rows) {
    if (!r.doc.customerPartyId) continue;
    const p = m.get(r.doc.customerPartyId) ?? emptyPnl();
    add(p, r);
    m.set(r.doc.customerPartyId, p);
  }
  return [...m.entries()]
    .filter(([id]) => parties.has(id))
    .map(([id, pnl]) => ({ party: parties.get(id)!, pnl }))
    .sort((a, b) => (a.pnl.dueInPaise > b.pnl.dueInPaise ? -1 : 1));
}

export interface PeriodPnl {
  period: string;
  pnl: PnL;
}

/** Income / costs / profit by day (`YYYY-MM-DD`) or month (`YYYY-MM`). */
export async function pnlByPeriod(
  godownId: string,
  by: "day" | "month",
  from?: string,
  to?: string,
  vehicleId?: string,
): Promise<PeriodPnl[]> {
  const rows = await tripRows(godownId, {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(vehicleId ? { vehicleId } : {}),
  });
  const exp = (await vehicleExpenses(godownId, from, to)).filter(
    (e) => !vehicleId || e.vehicleId === vehicleId,
  );
  const key = (date: string) => (by === "day" ? date : date.slice(0, 7));
  const m = new Map<string, PnL>();
  for (const r of rows) {
    const k = key(r.doc.transactionDate);
    const p = m.get(k) ?? emptyPnl();
    add(p, r);
    m.set(k, p);
  }
  for (const e of exp) {
    const k = key(e.date);
    const p = m.get(k) ?? emptyPnl();
    p.expensePaise += e.amount;
    m.set(k, p);
  }
  return [...m.entries()]
    .map(([period, pnl]) => ({ period, pnl }))
    .sort((a, b) => (a.period < b.period ? 1 : -1));
}

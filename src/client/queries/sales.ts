/**
 * Sales section reads (requirement_v2 §12.3), one Gola at a time. Paid / due / status come from
 * the ACTIVE collections of each sale (never stored). Stock figures come from derived stock moves.
 */
import { todayIST } from "@/domain/dates";
import { matchesPayFilter, type PayFilter } from "@/domain/v2/payments";
import type { DocOf, Location, Party, Product, Variety } from "@/domain/schemas";
import { db } from "../db/dexie";
import { godownBalances } from "./ledger";
import { matchesQuery, paymentsOf, stateOf, type Purchase } from "./purchases";
import type { BillState } from "@/domain/v2/payments";

export type Sale = DocOf<"SALE">;
export type DeliveryStatus = Sale["deliveryStatus"];

export interface SaleRow {
  doc: Sale;
  party?: Party;
  variety?: Variety;
  state: BillState;
}

export interface SaleFilter {
  from?: string;
  to?: string;
  status?: PayFilter | "ALL";
  delivery?: DeliveryStatus | "ALL";
  saleStatus?: Sale["saleStatus"] | "ALL";
  partyId?: string;
  q?: string;
}

export async function saleRows(godownId: string, f: SaleFilter = {}): Promise<SaleRow[]> {
  const d = db();
  const docs = (await d.vouchers
    .where("[godownId+transactionDate]")
    .between([godownId, f.from ?? ""], [godownId, f.to ?? "￿"], true, true)
    .filter((x) => x.type === "SALE")
    .toArray()) as Sale[];
  const [parties, varieties] = await Promise.all([
    d.parties.where("godownId").equals(godownId).toArray(),
    d.varieties.where("godownId").equals(godownId).toArray(),
  ]);
  const pById = new Map(parties.map((p) => [p._id, p] as const));
  const vById = new Map(varieties.map((v) => [v._id, v] as const));
  const today = todayIST();
  const out: SaleRow[] = [];
  for (const doc of docs) {
    if (f.partyId && doc.partyId !== f.partyId) continue;
    if (f.delivery && f.delivery !== "ALL" && doc.deliveryStatus !== f.delivery) continue;
    if (f.saleStatus && f.saleStatus !== "ALL" && doc.saleStatus !== f.saleStatus) continue;
    const pays = (await paymentsOf(doc._id)).filter((p) => p.status === "active");
    const state = stateOf(doc, pays, today)!;
    const row: SaleRow = {
      doc,
      party: pById.get(doc.partyId),
      variety: vById.get(doc.varietyId),
      state,
    };
    if (f.status && f.status !== "ALL") {
      if (doc.status === "void" || !matchesPayFilter(state, f.status)) continue;
    }
    if (f.q && !matchesQuery(row, f.q)) continue;
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

/** Totals of a list: confirmed active sales only (orders are counted apart; no effect yet). */
export function saleTotals(rows: readonly SaleRow[]): {
  count: number;
  orders: number;
  paddyG: bigint;
  riceG: bigint;
  amountPaise: bigint;
  duePaise: bigint;
} {
  let paddy = 0n;
  let rice = 0n;
  let amount = 0n;
  let due = 0n;
  let count = 0;
  let orders = 0;
  for (const r of rows) {
    if (r.doc.status !== "active") continue;
    if (r.doc.saleStatus === "ORDER") {
      orders++;
      continue;
    }
    count++;
    if (r.doc.product === "RICE") rice += BigInt(r.doc.weight.netG);
    else paddy += BigInt(r.doc.weight.netG);
    amount += BigInt(r.doc.totalPaise);
    due += r.state.duePaise > 0n ? r.state.duePaise : 0n;
  }
  return { count, orders, paddyG: paddy, riceG: rice, amountPaise: amount, duePaise: due };
}

export interface CustomerSummary {
  party: Party;
  paddyG: bigint;
  riceG: bigint;
  amountPaise: bigint;
  /** Party balance: > 0 they owe us (receivable), < 0 advance received from them. */
  balancePaise: bigint;
}

/** Buyers (customers and mills) with their sale totals and current balance. */
export async function customerSummaries(godownId: string): Promise<CustomerSummary[]> {
  const d = db();
  const parties = (await d.parties.where("godownId").equals(godownId).toArray()).filter(
    (p) =>
      p.status === "active" &&
      (p.roles.includes("CUSTOMER") || p.roles.includes("MILL") || p.roles.includes("GOLA")),
  );
  const balances = await godownBalances(godownId);
  const sales = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, "SALE"])
    .filter((x) => x.status === "active")
    .toArray()) as Sale[];
  return parties
    .map((party) => {
      const mine = sales.filter((s) => s.partyId === party._id && s.saleStatus === "CONFIRMED");
      return {
        party,
        paddyG: mine
          .filter((s) => s.product === "PADDY")
          .reduce((t, s) => t + BigInt(s.weight.netG), 0n),
        riceG: mine
          .filter((s) => s.product === "RICE")
          .reduce((t, s) => t + BigInt(s.weight.netG), 0n),
        amountPaise: mine.reduce((t, s) => t + BigInt(s.totalPaise), 0n),
        balancePaise: balances.get(`PARTY:${party._id}`) ?? 0n,
      };
    })
    .filter(
      (r) =>
        !r.party.roles.includes("GOLA") ||
        r.amountPaise > 0n ||
        r.balancePaise !== 0n ||
        r.party.roles.length > 1,
    )
    .sort((a, b) =>
      a.balancePaise > b.balancePaise
        ? -1
        : a.balancePaise < b.balancePaise
          ? 1
          : a.party.name.localeCompare(b.party.name),
    );
}

export interface StockPosition {
  product: Product;
  location: Location;
  varietyId?: string;
  millPartyId?: string;
  /** TRANSIT only: the purchase group. */
  groupId?: string;
}

/** Quantity (g) of one stock position at the end of `upTo` (all dates when omitted). */
export async function stockAvailable(
  godownId: string,
  pos: StockPosition,
  upTo?: string,
  excludeVoucherId?: string,
): Promise<bigint> {
  const moves = await db()
    .stockMoves.where("[godownId+product+location]")
    .equals([godownId, pos.product, pos.location])
    .toArray();
  let q = 0n;
  for (const m of moves) {
    if (upTo && m.date > upTo) continue;
    if (excludeVoucherId && m.voucherId === excludeVoucherId) continue;
    if (pos.varietyId && m.varietyId !== pos.varietyId) continue;
    if (pos.millPartyId && m.millPartyId !== pos.millPartyId) continue;
    if (pos.groupId && m.groupId !== pos.groupId) continue;
    q += BigInt(m.qtyG);
  }
  return q;
}

export interface TransitPurchase {
  doc: Purchase;
  party?: Party;
  /** Paddy of this direct-delivery purchase not yet sold on (g). */
  leftG: bigint;
}

/** Direct-delivery purchases with paddy still in transit (for a direct-delivery sale). */
export async function openTransitPurchases(
  godownId: string,
  keepGroup?: string,
): Promise<TransitPurchase[]> {
  const d = db();
  const docs = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, "PURCHASE"])
    .filter((x) => x.status === "active" && x.type === "PURCHASE" && x.storeAt === "TRANSIT")
    .toArray()) as Purchase[];
  const moves = await d.stockMoves
    .where("[godownId+product+location]")
    .equals([godownId, "PADDY", "TRANSIT"])
    .toArray();
  const left = new Map<string, bigint>();
  for (const m of moves) {
    if (!m.groupId) continue;
    left.set(m.groupId, (left.get(m.groupId) ?? 0n) + BigInt(m.qtyG));
  }
  const parties = new Map(
    (await d.parties.where("godownId").equals(godownId).toArray()).map((p) => [p._id, p] as const),
  );
  return docs
    .map((doc) => ({
      doc,
      party: parties.get(doc.partyId),
      leftG: left.get(doc.groupId ?? doc._id) ?? 0n,
    }))
    .filter((r) => r.leftG > 0n || (keepGroup && (r.doc.groupId ?? r.doc._id) === keepGroup))
    .sort((a, b) => (a.doc.transactionDate < b.doc.transactionDate ? 1 : -1));
}

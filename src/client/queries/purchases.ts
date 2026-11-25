/**
 * Purchase section reads (requirement_v2 §12.2), one Gola at a time. Paid / due / status are
 * derived from the ACTIVE payments of each purchase (never stored).
 */
import { todayIST } from "@/domain/dates";
import { billState, billsOf, type BillState, type PayStatus } from "@/domain/v2/payments";
import type { BankAccount, Doc, DocOf, Party, Payment, Variety } from "@/domain/schemas";
import { db } from "../db/dexie";
import { godownBalances } from "./ledger";

export type Purchase = DocOf<"PURCHASE">;

export interface PurchaseRow {
  doc: Purchase;
  party?: Party;
  variety?: Variety;
  state: BillState;
}

/** Payments (any status) that point at `docId` — for ledgers and history. */
export async function paymentsOf(docId: string): Promise<Payment[]> {
  const d = db();
  const rows = [
    ...(await d.vouchers.where("source.id").equals(docId).toArray()),
    ...(await d.vouchers.where("source.id").startsWith(`${docId}:`).toArray()),
  ];
  return rows
    .filter((p): p is Payment => p.type === "PAYMENT")
    .sort((a, b) =>
      a.paymentDate === b.paymentDate
        ? a.createdAt < b.createdAt
          ? -1
          : 1
        : a.paymentDate < b.paymentDate
          ? -1
          : 1,
    );
}

export function stateOf(
  doc: Doc,
  payments: readonly Payment[],
  today = todayIST(),
): BillState | undefined {
  const bill = billsOf({ ...doc, status: "active" } as Doc)[0];
  return bill ? billState(bill, payments, today) : undefined;
}

export interface PurchaseFilter {
  from?: string;
  to?: string;
  status?: PayStatus | "ALL";
  varietyId?: string;
  q?: string;
}

export async function purchaseRows(
  godownId: string,
  f: PurchaseFilter = {},
): Promise<PurchaseRow[]> {
  const d = db();
  const docs = (await d.vouchers
    .where("[godownId+transactionDate]")
    .between([godownId, f.from ?? ""], [godownId, f.to ?? "￿"], true, true)
    .filter((x) => x.type === "PURCHASE")
    .toArray()) as Purchase[];
  const [parties, varieties] = await Promise.all([
    d.parties.where("godownId").equals(godownId).toArray(),
    d.varieties.where("godownId").equals(godownId).toArray(),
  ]);
  const pById = new Map(parties.map((p) => [p._id, p] as const));
  const vById = new Map(varieties.map((v) => [v._id, v] as const));
  const today = todayIST();
  const out: PurchaseRow[] = [];
  for (const doc of docs) {
    const pays = (await paymentsOf(doc._id)).filter((p) => p.status === "active");
    const state = stateOf(doc, pays, today)!;
    const row: PurchaseRow = {
      doc,
      party: pById.get(doc.partyId),
      variety: vById.get(doc.varietyId),
      state,
    };
    if (f.varietyId && doc.varietyId !== f.varietyId) continue;
    if (f.status && f.status !== "ALL") {
      if (doc.status === "void" || state.status !== f.status) continue;
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

function matchesQuery(r: PurchaseRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/[^0-9]/g, "");
  const hay = [
    r.party?.name,
    r.party?.nameAlt,
    r.party?.searchKey,
    r.party?.phone,
    r.variety?.name,
    r.variety?.nameAlt,
    r.variety?.systemKey,
    r.doc.number,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(s)) return true;
  // Amount typed in rupees ("134400").
  return digits.length >= 2 && (BigInt(r.doc.totalPaise) / 100n).toString().startsWith(digits);
}

/** Totals of a list (active purchases only). */
export function purchaseTotals(rows: readonly PurchaseRow[]): {
  count: number;
  qtyG: bigint;
  amountPaise: bigint;
  duePaise: bigint;
} {
  let qty = 0n;
  let amount = 0n;
  let due = 0n;
  let count = 0;
  for (const r of rows) {
    if (r.doc.status !== "active") continue;
    count++;
    qty += BigInt(r.doc.weight.netG);
    amount += BigInt(r.doc.totalPaise);
    due += r.state.duePaise > 0n ? r.state.duePaise : 0n;
  }
  return { count, qtyG: qty, amountPaise: amount, duePaise: due };
}

export interface FarmerSummary {
  party: Party;
  qtyG: bigint;
  amountPaise: bigint;
  /** Party balance: < 0 we owe (payable), > 0 advance given. */
  balancePaise: bigint;
}

/** Farmers / suppliers of the Gola with their totals and current balance. */
export async function farmerSummaries(godownId: string): Promise<FarmerSummary[]> {
  const d = db();
  const parties = (await d.parties.where("godownId").equals(godownId).toArray()).filter(
    (p) => p.status === "active" && (p.roles.includes("FARMER") || p.roles.includes("SUPPLIER")),
  );
  const balances = await godownBalances(godownId);
  const purchases = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, "PURCHASE"])
    .filter((x) => x.status === "active")
    .toArray()) as Purchase[];
  return parties
    .map((party) => {
      const mine = purchases.filter((p) => p.partyId === party._id);
      return {
        party,
        qtyG: mine.reduce((s, p) => s + BigInt(p.weight.netG), 0n),
        amountPaise: mine.reduce((s, p) => s + BigInt(p.totalPaise), 0n),
        balancePaise: balances.get(`PARTY:${party._id}`) ?? 0n,
      };
    })
    .sort((a, b) =>
      a.balancePaise < b.balancePaise
        ? -1
        : a.balancePaise > b.balancePaise
          ? 1
          : a.party.name.localeCompare(b.party.name),
    );
}

export interface LedgerRow {
  date: string;
  doc: Doc;
  debitPaise: bigint;
  creditPaise: bigint;
  balancePaise: bigint;
}

/** A party's ledger (every source), running balance, optional date range. */
export async function partyLedger(
  godownId: string,
  partyId: string,
  from?: string,
  to?: string,
): Promise<{ opening: bigint; rows: LedgerRow[]; closing: bigint }> {
  const d = db();
  const lines = await d.ledgerLines
    .where("[godownId+account+date]")
    .between([godownId, `PARTY:${partyId}`, ""], [godownId, `PARTY:${partyId}`, "￿"], true, true)
    .toArray();
  let opening = 0n;
  const byDoc = new Map<string, { date: string; dr: bigint; cr: bigint }>();
  for (const l of lines) {
    const v = BigInt(l.debitPaise) - BigInt(l.creditPaise);
    if (from && l.date < from) {
      opening += v;
      continue;
    }
    if (to && l.date > to) continue;
    const e = byDoc.get(l.voucherId) ?? { date: l.date, dr: 0n, cr: 0n };
    e.dr += BigInt(l.debitPaise);
    e.cr += BigInt(l.creditPaise);
    byDoc.set(l.voucherId, e);
  }
  const docs = await d.vouchers.bulkGet([...byDoc.keys()]);
  const rows = docs
    .filter((x): x is Doc => !!x)
    .map((doc) => ({ doc, ...byDoc.get(doc._id)! }))
    .sort((a, b) =>
      a.date === b.date ? (a.doc.createdAt < b.doc.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1,
    );
  let bal = opening;
  const out: LedgerRow[] = rows.map((r) => {
    bal += r.dr - r.cr;
    return { date: r.date, doc: r.doc, debitPaise: r.dr, creditPaise: r.cr, balancePaise: bal };
  });
  return { opening, rows: out, closing: bal };
}

export interface VarietyRow {
  variety: Variety;
  uses: number;
  lastUsed?: string;
}

/** Varieties of the Gola with usage counts; recents = last 8 used. */
export async function varietyRows(
  godownId: string,
): Promise<{ all: VarietyRow[]; recent: string[] }> {
  const d = db();
  const vs = (await d.varieties.where("godownId").equals(godownId).toArray()).filter(
    (v) => v.status === "active",
  );
  const docs = await d.vouchers
    .where("godownId")
    .equals(godownId)
    .filter((x) => x.status === "active" && "varietyId" in x)
    .toArray();
  const uses = new Map<string, { n: number; last: string }>();
  for (const x of docs) {
    const id = (x as { varietyId?: string }).varietyId;
    if (!id) continue;
    const e = uses.get(id) ?? { n: 0, last: "" };
    e.n++;
    if (x.createdAt > e.last) e.last = x.createdAt;
    uses.set(id, e);
  }
  const all = vs.map((v) => ({
    variety: v,
    uses: uses.get(v._id)?.n ?? 0,
    lastUsed: uses.get(v._id)?.last,
  }));
  const recent = all
    .filter((r) => r.lastUsed)
    .sort((a, b) => (a.lastUsed! < b.lastUsed! ? 1 : -1))
    .slice(0, 8)
    .map((r) => r.variety._id);
  return { all, recent };
}

/** Active bank accounts with their balances. */
export async function bankRows(
  godownId: string,
): Promise<Array<{ bank: BankAccount; balancePaise: bigint }>> {
  const banks = (await db().bankAccounts.where("godownId").equals(godownId).toArray()).filter(
    (b) => b.status === "active",
  );
  const bal = await godownBalances(godownId);
  return banks.map((bank) => ({ bank, balancePaise: bal.get(`BANK:${bank._id}`) ?? 0n }));
}

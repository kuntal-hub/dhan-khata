/**
 * Party queries (spec §9.6, §9.8, §9.12). Every function takes `godownId`.
 * Balances come from ledger lines (PARTY:<id>); bill status from FIFO settlement.
 */
import { agingBuckets, type AgingBucket } from "@/domain/aging";
import { settleBills, type BillState } from "@/domain/allocation";
import { saleSummary } from "@/domain/calc/sale";
import { normalizeDigits } from "@/domain/digits";
import { divRoundHalfUp } from "@/domain/rounding";
import type { LedgerLine, Party, PartyRole, Voucher } from "@/domain/schemas";
import { matchesSearch } from "@/i18n/translit";
import { db } from "../db/dexie";

const PARTY_PREFIX = "PARTY:";

export async function godownParties(godownId: string, includeVoid = false): Promise<Party[]> {
  const all = await db().parties.where("godownId").equals(godownId).toArray();
  return all.filter((p) => includeVoid || p.status === "active");
}

/** Cross-script search over name / nameAlt / village / phone (digits in either script). */
export function partyMatches(p: Party, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const digits = normalizeDigits(q).replace(/\D/g, "");
  if (digits.length >= 3 && [p.phone, p.altPhone].some((ph) => ph?.includes(digits))) return true;
  return matchesSearch(p.searchKey, q);
}

export async function searchParties(
  godownId: string,
  query: string,
  role?: PartyRole,
): Promise<Party[]> {
  const list = (await godownParties(godownId)).filter(
    (p) => (!role || p.roles.includes(role)) && partyMatches(p, query),
  );
  return list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** All party-account lines of a godown. */
async function partyLines(godownId: string): Promise<LedgerLine[]> {
  return db()
    .ledgerLines.where("[godownId+account+date]")
    .between([godownId, PARTY_PREFIX, ""], [godownId, `${PARTY_PREFIX}￿`, "￿"], true, true)
    .toArray();
}

/** partyId → balance (> 0 = পাওনা, < 0 = দেনা). */
export async function partyBalances(godownId: string): Promise<Map<string, bigint>> {
  const m = new Map<string, bigint>();
  for (const l of await partyLines(godownId)) {
    const id = l.account.slice(PARTY_PREFIX.length);
    m.set(id, (m.get(id) ?? 0n) + BigInt(l.debitPaise) - BigInt(l.creditPaise));
  }
  return m;
}

export async function linesOfParty(
  godownId: string,
  partyId: string,
  range: { from?: string; to?: string } = {},
): Promise<LedgerLine[]> {
  const acc = `${PARTY_PREFIX}${partyId}`;
  return db()
    .ledgerLines.where("[godownId+account+date]")
    .between([godownId, acc, range.from ?? ""], [godownId, acc, range.to ?? "￿"], true, true)
    .toArray();
}

export interface StatementRow {
  voucherId: string;
  date: string;
  number: string;
  type: Voucher["type"];
  debitPaise: bigint;
  creditPaise: bigint;
  balancePaise: bigint;
  voucher: Voucher | undefined;
}

export interface Statement {
  openingPaise: bigint;
  rows: StatementRow[];
  closingPaise: bigint;
  totalDebitPaise: bigint;
  totalCreditPaise: bigint;
}

/**
 * Party khata (spec §9.6): opening balance before `from`, one row per voucher (net of its party
 * lines), running balance, closing. Optional bank filter keeps only vouchers touching that bank.
 */
export async function partyStatement(
  godownId: string,
  partyId: string,
  range: { from?: string; to?: string } = {},
  opts: { bankAccountId?: string } = {},
): Promise<Statement> {
  const all = await linesOfParty(godownId, partyId, range.to ? { to: range.to } : {});
  let opening = 0n;
  const inRange: LedgerLine[] = [];
  for (const l of all) {
    if (range.from && l.date < range.from) opening += BigInt(l.debitPaise) - BigInt(l.creditPaise);
    else inRange.push(l);
  }
  const byVoucher = new Map<string, { dr: bigint; cr: bigint; date: string }>();
  for (const l of inRange) {
    const e = byVoucher.get(l.voucherId) ?? { dr: 0n, cr: 0n, date: l.date };
    e.dr += BigInt(l.debitPaise);
    e.cr += BigInt(l.creditPaise);
    byVoucher.set(l.voucherId, e);
  }
  const vouchers = await db().vouchers.bulkGet([...byVoucher.keys()]);
  const vById = new Map(vouchers.filter((v): v is Voucher => !!v).map((v) => [v._id, v]));
  let entries = [...byVoucher.entries()];
  if (opts.bankAccountId) {
    const bank = opts.bankAccountId;
    entries = entries.filter(([id]) => {
      const v = vById.get(id);
      return (v?.type === "PAYMENT" || v?.type === "RECEIPT") && v.ourBankAccountId === bank;
    });
  }
  entries.sort(([a, ea], [b, eb]) => {
    if (ea.date !== eb.date) return ea.date < eb.date ? -1 : 1;
    const va = vById.get(a);
    const vb = vById.get(b);
    const ca = va?.createdAt ?? "";
    const cb = vb?.createdAt ?? "";
    return ca < cb ? -1 : ca > cb ? 1 : a < b ? -1 : 1;
  });
  let bal = opening;
  let td = 0n;
  let tc = 0n;
  const rows: StatementRow[] = entries.map(([id, e]) => {
    const v = vById.get(id);
    bal += e.dr - e.cr;
    td += e.dr;
    tc += e.cr;
    return {
      voucherId: id,
      date: e.date,
      number: v?.number ?? "",
      type: v?.type ?? "JOURNAL",
      debitPaise: e.dr,
      creditPaise: e.cr,
      balancePaise: bal,
      voucher: v,
    };
  });
  return {
    openingPaise: opening,
    rows,
    closingPaise: bal,
    totalDebitPaise: td,
    totalCreditPaise: tc,
  };
}

/** Active vouchers of a godown that involve a party (any party field). */
export async function partyVouchers(godownId: string, partyId: string): Promise<Voucher[]> {
  const direct = await db()
    .vouchers.where("[godownId+partyId+date]")
    .between([godownId, partyId, ""], [godownId, partyId, "￿"], true, true)
    .toArray();
  const loads = await db()
    .vouchers.where("[godownId+type+date]")
    .between([godownId, "LOAD", ""], [godownId, "LOAD", "￿"], true, true)
    .filter(
      (v) =>
        v.type === "LOAD" &&
        (v.fromPartyId === partyId || v.toMillPartyId === partyId || v.secondPartyId === partyId),
    )
    .toArray();
  const seen = new Set<string>();
  return [...direct, ...loads]
    .filter((v) => (seen.has(v._id) ? false : (seen.add(v._id), true)))
    .sort((a, b) =>
      a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1,
    );
}

export interface PartyBills {
  /** Purchases from the party, settled by our PAYMENTs. */
  purchases: BillState[];
  /** Sales to the party, settled by their RECEIPTs. */
  sales: BillState[];
  /** Payments not matched to any purchase bill (advance given). */
  advanceGivenPaise: bigint;
  /** Receipts not matched to any sale bill (advance taken). */
  advanceTakenPaise: bigint;
  billDates: Map<string, string>;
}

/** Bill amount of a sale for collection: total ± settlement difference − freight the mill deducted. */
function saleBillAmount(v: Voucher, settlementDiff: bigint): bigint {
  if (v.type !== "SALE") return 0n;
  const s = saleSummary(v);
  const millFreight = v.delivery?.payer === "MILL" ? s.freight : 0n;
  return s.goodsValue + settlementDiff - millFreight;
}

/** Bill states (Open / Partial / Settled) for one party, FIFO + manual allocations (§9.6). */
export async function partyBills(godownId: string, partyId: string): Promise<PartyBills> {
  const vs = (await partyVouchers(godownId, partyId)).filter((v) => v.status === "active");
  const settlementDiff = new Map<string, bigint>();
  const settlements = await db()
    .vouchers.where("[godownId+type+date]")
    .between([godownId, "MILL_SETTLEMENT", ""], [godownId, "MILL_SETTLEMENT", "￿"], true, true)
    .filter((v) => v.status === "active" && v.type === "MILL_SETTLEMENT" && v.partyId === partyId)
    .toArray();
  for (const s of settlements) {
    if (s.type === "MILL_SETTLEMENT") {
      settlementDiff.set(
        s.saleId,
        (settlementDiff.get(s.saleId) ?? 0n) + BigInt(s.differencePaise),
      );
    }
  }
  const billDates = new Map<string, string>();
  const purchaseBills = [];
  const saleBills = [];
  const payments = [];
  const receipts = [];
  for (const v of vs) {
    if (v.type === "PURCHASE" && v.partyId === partyId) {
      purchaseBills.push({
        voucherId: v._id,
        date: v.date,
        number: v.number,
        totalPaise: BigInt(v.totalPaise),
      });
      billDates.set(v._id, v.date);
    } else if (v.type === "SALE" && v.partyId === partyId) {
      saleBills.push({
        voucherId: v._id,
        date: v.date,
        number: v.number,
        totalPaise: saleBillAmount(v, settlementDiff.get(v._id) ?? 0n),
      });
      billDates.set(v._id, v.date);
    } else if (v.type === "PAYMENT" && v.partyId === partyId) {
      payments.push({
        voucherId: v._id,
        date: v.date,
        amountPaise: BigInt(v.amountPaise),
        allocations: (v.allocations ?? []).map((a) => ({
          voucherId: a.voucherId,
          amountPaise: BigInt(a.amountPaise),
        })),
      });
    } else if (v.type === "RECEIPT" && v.partyId === partyId) {
      receipts.push({
        voucherId: v._id,
        date: v.date,
        amountPaise: BigInt(v.amountPaise) + BigInt(v.tdsPaise ?? "0"),
        allocations: (v.allocations ?? []).map((a) => ({
          voucherId: a.voucherId,
          amountPaise: BigInt(a.amountPaise),
        })),
      });
    }
  }
  const p = settleBills(purchaseBills, payments);
  const s = settleBills(saleBills, receipts);
  return {
    purchases: p.bills,
    sales: s.bills,
    advanceGivenPaise: p.unallocatedPaise,
    advanceTakenPaise: s.unallocatedPaise,
    billDates,
  };
}

export async function partyAging(
  godownId: string,
  partyId: string,
  asOf: string,
): Promise<{ receivable: Record<AgingBucket, bigint>; payable: Record<AgingBucket, bigint> }> {
  const b = await partyBills(godownId, partyId);
  const items = (bills: BillState[]) =>
    bills.map((x) => ({
      date: b.billDates.get(x.voucherId) ?? asOf,
      outstandingPaise: x.outstandingPaise,
    }));
  return {
    receivable: agingBuckets(items(b.sales), asOf),
    payable: agingBuckets(items(b.purchases), asOf),
  };
}

export interface DueRow {
  party: Party;
  balancePaise: bigint;
  advanceGivenPaise: bigint;
  advanceTakenPaise: bigint;
  oldestOpenDate: string | null;
  openBills: number;
}

/** Parties with a non-zero balance (spec §9.6), with advances and the oldest open bill. */
export async function dueList(godownId: string): Promise<DueRow[]> {
  const balances = await partyBalances(godownId);
  const parties = new Map((await godownParties(godownId, true)).map((p) => [p._id, p]));
  const rows: DueRow[] = [];
  for (const [id, bal] of balances) {
    if (bal === 0n) continue;
    const party = parties.get(id);
    if (!party) continue;
    const bills = await partyBills(godownId, id);
    const open = [...bills.purchases, ...bills.sales].filter((x) => x.outstandingPaise > 0n);
    const dates = open
      .map((x) => bills.billDates.get(x.voucherId) ?? "")
      .filter(Boolean)
      .sort();
    rows.push({
      party,
      balancePaise: bal,
      advanceGivenPaise: bills.advanceGivenPaise,
      advanceTakenPaise: bills.advanceTakenPaise,
      oldestOpenDate: dates[0] ?? null,
      openBills: open.length,
    });
  }
  return rows;
}

export interface PurchaseHistory {
  rows: Array<{ voucher: Voucher; netG: bigint; bags: number; bill: BillState | undefined }>;
  totalNetG: bigint;
  totalAmountPaise: bigint;
  totalPaidPaise: bigint;
  balancePaise: bigint;
  avgRatePaisePerQtl: bigint;
}

/** Customer-wise purchase history (spec §9.2) with summary header. */
export async function purchaseHistory(
  godownId: string,
  partyId: string,
  filter: { from?: string; to?: string; season?: string; varietyId?: string } = {},
): Promise<PurchaseHistory> {
  const bills = await partyBills(godownId, partyId);
  const billById = new Map(bills.purchases.map((b) => [b.voucherId, b]));
  const vs = (await partyVouchers(godownId, partyId)).filter(
    (v) =>
      v.status === "active" &&
      v.type === "PURCHASE" &&
      (!filter.from || v.date >= filter.from) &&
      (!filter.to || v.date <= filter.to) &&
      (!filter.season || v.season === filter.season) &&
      (!filter.varietyId ||
        (v.type === "PURCHASE" && v.lines.some((l) => l.varietyId === filter.varietyId))),
  );
  let totalNetG = 0n;
  let totalAmount = 0n;
  let totalPaid = 0n;
  const rows = vs.map((v) => {
    let net = 0n;
    let bags = 0;
    if (v.type === "PURCHASE") {
      for (const l of v.lines) {
        net += BigInt(l.netG);
        bags += l.bags ?? 0;
      }
      totalAmount += BigInt(v.totalPaise);
    }
    totalNetG += net;
    const bill = billById.get(v._id);
    totalPaid += bill?.paidPaise ?? 0n;
    return { voucher: v, netG: net, bags, bill };
  });
  const balance = (await partyBalances(godownId)).get(partyId) ?? 0n;
  return {
    rows,
    totalNetG,
    totalAmountPaise: totalAmount,
    totalPaidPaise: totalPaid,
    balancePaise: balance,
    avgRatePaisePerQtl: totalNetG > 0n ? divRoundHalfUp(totalAmount * 100_000n, totalNetG) : 0n,
  };
}

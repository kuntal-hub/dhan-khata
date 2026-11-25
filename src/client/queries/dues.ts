/**
 * Due & Advance reads (requirement_v2 §12.6): one unified view over parties, their bills and
 * payments. Nothing here is stored.
 *  - The remaining amount of a party IS its ledger balance (so "Due totals == ledger" always).
 *  - Bill totals / paid / earliest due / overdue come from the party's open bills (`dueBillsOf`:
 *    a consignment's expected value and an order are not owed, DECISIONS D39 / D3).
 *  - Categories follow the party's roles and the balance sign (DECISIONS D33 / D41).
 *  - Reminders: automatic from open bills' due dates + manual ones, with the owner's state.
 */
import { addDays, diffDays, todayIST } from "@/domain/dates";
import { AGING_BUCKETS, agingBucketOf, type AgingBucket } from "@/domain/aging";
import { billState, dueBillsOf, type BillState } from "@/domain/v2/payments";
import type { Doc, Party, PartyRole, Payment, Reminder } from "@/domain/schemas";
import { db } from "../db/dexie";
import { godownBalances } from "./ledger";

export type DueCategory = "receivable" | "payable" | "mill" | "advance" | "other";
export const DUE_CATEGORIES: readonly DueCategory[] = [
  "receivable",
  "payable",
  "mill",
  "advance",
  "other",
];

const SALES_SIDE: readonly PartyRole[] = ["CUSTOMER", "MILL", "VEHICLE_CUSTOMER", "GOLA"];
const BUY_SIDE: readonly PartyRole[] = ["FARMER", "SUPPLIER"];
const has = (roles: readonly PartyRole[], list: readonly PartyRole[]) =>
  roles.some((r) => list.includes(r));

/** Which Due & Advance tab a party belongs to (null when settled). */
export function dueCategory(roles: readonly PartyRole[], balancePaise: bigint): DueCategory | null {
  if (balancePaise === 0n) return null;
  if (balancePaise > 0n) {
    if (has(roles, SALES_SIDE)) return "receivable";
    if (has(roles, BUY_SIDE)) return "advance";
    return "other";
  }
  if (roles.includes("MILL")) return "mill";
  if (has(roles, BUY_SIDE)) return "payable";
  if (roles.includes("CUSTOMER") || roles.includes("VEHICLE_CUSTOMER")) return "advance";
  return "other";
}

export interface OpenBill {
  doc: Doc;
  state: BillState;
}

export interface PartyDue {
  party: Party;
  category: DueCategory;
  /** Ledger balance: > 0 they owe us, < 0 we owe them. */
  balancePaise: bigint;
  /** Opening (initial) balance entered for the party, signed like the balance. */
  openingPaise: bigint;
  /** Σ bill totals of the party (active bills). */
  totalPaise: bigint;
  /** Σ payments against those bills. */
  paidPaise: bigint;
  earliestDue?: string;
  overdueDays: number;
  lastDate?: string;
  open: OpenBill[];
}

async function golaDocs(godownId: string): Promise<Doc[]> {
  return (await db().vouchers.where("godownId").equals(godownId).toArray()).filter(
    (d) => d.status === "active",
  );
}

function bySource(docs: readonly Doc[]): Map<string, Payment[]> {
  const m = new Map<string, Payment[]>();
  for (const p of docs) {
    if (p.type !== "PAYMENT" || !p.source.id) continue;
    m.set(p.source.id, [...(m.get(p.source.id) ?? []), p]);
  }
  return m;
}

function dateOf(d: Doc): string {
  switch (d.type) {
    case "EXPENSE":
      return d.expenseDate;
    case "MILL_DISPATCH":
      return d.dispatchDate;
    case "MILL_RETURN":
      return d.returnDate;
    case "CONVERSION":
      return d.conversionDate;
    case "PAYMENT":
      return d.paymentDate;
    case "DAY_CLOSE":
      return d.date;
    default:
      return d.transactionDate;
  }
}

function partyOf(d: Doc): string | undefined {
  switch (d.type) {
    case "PURCHASE":
    case "SALE":
    case "PAYMENT":
    case "EXPENSE":
    case "SECOND_PARTY":
      return d.partyId;
    case "MILL_DISPATCH":
    case "MILL_RETURN":
      return d.millPartyId;
    case "TRIP":
      return d.customerPartyId;
    default:
      return undefined;
  }
}

/** Every party with a non-zero balance, with its bills and category. */
export async function partyDues(godownId: string, today = todayIST()): Promise<PartyDue[]> {
  const d = db();
  const [parties, docs, balances] = await Promise.all([
    d.parties.where("godownId").equals(godownId).toArray(),
    golaDocs(godownId),
    godownBalances(godownId),
  ]);
  const pays = bySource(docs);
  const bills = new Map<string, OpenBill[]>();
  const totals = new Map<string, { total: bigint; paid: bigint }>();
  const opening = new Map<string, bigint>();
  const last = new Map<string, string>();
  for (const doc of docs) {
    const pid = partyOf(doc);
    if (pid) {
      const dt = dateOf(doc);
      if ((last.get(pid) ?? "") < dt) last.set(pid, dt);
    }
    if (doc.type === "OPENING") {
      for (const it of doc.items) {
        if (it.kind === "PARTY" && it.refId)
          opening.set(it.refId, (opening.get(it.refId) ?? 0n) + BigInt(it.amountPaise));
      }
    }
    for (const b of dueBillsOf(doc)) {
      if (!b.partyId) continue;
      const st = billState(b, pays.get(b.sourceId) ?? [], today);
      const t = totals.get(b.partyId) ?? { total: 0n, paid: 0n };
      t.total += b.totalPaise;
      t.paid += st.paidPaise;
      totals.set(b.partyId, t);
      if (st.duePaise > 0n)
        bills.set(b.partyId, [...(bills.get(b.partyId) ?? []), { doc, state: st }]);
    }
  }
  const out: PartyDue[] = [];
  for (const party of parties) {
    const bal = balances.get(`PARTY:${party._id}`) ?? 0n;
    const category = dueCategory(party.roles, bal);
    if (!category) continue;
    const open = (bills.get(party._id) ?? []).sort((a, b) =>
      a.state.bill.date < b.state.bill.date ? -1 : 1,
    );
    const dues = open
      .map((o) => o.state.bill.dueDate)
      .filter((x): x is string => !!x)
      .sort();
    const earliest = dues[0];
    const t = totals.get(party._id) ?? { total: 0n, paid: 0n };
    out.push({
      party,
      category,
      balancePaise: bal,
      openingPaise: opening.get(party._id) ?? 0n,
      totalPaise: t.total,
      paidPaise: t.paid,
      ...(earliest ? { earliestDue: earliest } : {}),
      overdueDays: earliest && earliest < today ? diffDays(earliest, today) : 0,
      ...(last.get(party._id) ? { lastDate: last.get(party._id) } : {}),
      open,
    });
  }
  return out.sort((a, b) => {
    const x = a.balancePaise < 0n ? -a.balancePaise : a.balancePaise;
    const y = b.balancePaise < 0n ? -b.balancePaise : b.balancePaise;
    return x === y ? a.party.name.localeCompare(b.party.name) : x > y ? -1 : 1;
  });
}

export interface DueSummary {
  /** Σ |balance| per category. */
  totals: Record<DueCategory, bigint>;
  counts: Record<DueCategory, number>;
  /** Open bills by age (bill date), split by who pays. */
  aging: { collect: Record<AgingBucket, bigint>; pay: Record<AgingBucket, bigint> };
  top: PartyDue[];
}

export function dueSummary(rows: readonly PartyDue[], today = todayIST()): DueSummary {
  const zero = () =>
    Object.fromEntries(DUE_CATEGORIES.map((c) => [c, 0n])) as Record<DueCategory, bigint>;
  const totals = zero();
  const counts = Object.fromEntries(DUE_CATEGORIES.map((c) => [c, 0])) as Record<
    DueCategory,
    number
  >;
  const bucket = () =>
    Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0n])) as Record<AgingBucket, bigint>;
  const aging = { collect: bucket(), pay: bucket() };
  for (const r of rows) {
    totals[r.category] += r.balancePaise < 0n ? -r.balancePaise : r.balancePaise;
    counts[r.category]++;
    for (const o of r.open) {
      const side = o.state.bill.direction === "IN" ? aging.collect : aging.pay;
      side[agingBucketOf(o.state.bill.date, today)] += o.state.duePaise;
    }
  }
  return { totals, counts, aging, top: rows.slice(0, 5) };
}

/** A party's open bills in one direction, oldest first (for paying across bills, FIFO). */
export async function openBillsOf(
  godownId: string,
  partyId: string,
  direction: "IN" | "OUT",
  today = todayIST(),
): Promise<OpenBill[]> {
  const docs = await golaDocs(godownId);
  const pays = bySource(docs);
  const out: OpenBill[] = [];
  for (const doc of docs) {
    for (const b of dueBillsOf(doc)) {
      if (b.partyId !== partyId || b.direction !== direction) continue;
      const st = billState(b, pays.get(b.sourceId) ?? [], today);
      if (st.duePaise > 0n) out.push({ doc, state: st });
    }
  }
  return out.sort(
    (a, b) =>
      (a.state.bill.date < b.state.bill.date
        ? -1
        : a.state.bill.date > b.state.bill.date
          ? 1
          : 0) || (a.state.bill.sourceId < b.state.bill.sourceId ? -1 : 1),
  );
}

// ── Reminders ────────────────────────────────────────────────────────────────────────────────

export interface ReminderRow {
  /** `auto:<sourceId>` for an automatic reminder, else the manual reminder id. */
  id: string;
  kind: Reminder["kind"];
  auto: boolean;
  party?: Party;
  dueDate: string;
  amountPaise?: bigint;
  title: string;
  status: Reminder["status"];
  snoozeUntil?: string;
  source?: { type: string; id: string };
  doc?: Doc;
}

export type ReminderWhen = "overdue" | "today" | "upcoming" | "later" | "done";

export function reminderWhen(r: ReminderRow, today = todayIST()): ReminderWhen {
  if (r.status === "done") return "done";
  if (r.status === "snoozed" && r.snoozeUntil && r.snoozeUntil > today) return "later";
  if (r.dueDate < today) return "overdue";
  if (r.dueDate === today) return "today";
  return r.dueDate <= addDays(today, 7) ? "upcoming" : "later";
}

export async function reminderRows(godownId: string, today = todayIST()): Promise<ReminderRow[]> {
  const d = db();
  const [docs, stored, parties] = await Promise.all([
    golaDocs(godownId),
    d.reminders.where("godownId").equals(godownId).toArray(),
    d.parties.where("godownId").equals(godownId).toArray(),
  ]);
  const p = new Map(parties.map((x) => [x._id, x] as const));
  const state = new Map(stored.map((r) => [r._id, r] as const));
  const pays = bySource(docs);
  const out: ReminderRow[] = [];
  for (const doc of docs) {
    for (const b of dueBillsOf(doc)) {
      if (!b.dueDate) continue;
      const st = billState(b, pays.get(b.sourceId) ?? [], today);
      if (st.duePaise <= 0n) continue;
      const id = `auto:${b.sourceId}`;
      const s = state.get(id);
      out.push({
        id,
        kind: b.direction === "IN" ? "COLLECT" : "PAY",
        auto: true,
        ...(b.partyId && p.get(b.partyId) ? { party: p.get(b.partyId) } : {}),
        dueDate: s?.dueDate ?? b.dueDate,
        amountPaise: st.duePaise,
        title: "",
        status: s?.status ?? "open",
        ...(s?.snoozeUntil ? { snoozeUntil: s.snoozeUntil } : {}),
        source: { type: b.sourceType, id: b.sourceId },
        doc,
      });
    }
  }
  for (const r of stored) {
    if (r._id.startsWith("auto:")) continue;
    out.push({
      id: r._id,
      kind: r.kind,
      auto: false,
      ...(r.partyId && p.get(r.partyId) ? { party: p.get(r.partyId) } : {}),
      dueDate: r.dueDate,
      ...(r.amountPaise ? { amountPaise: BigInt(r.amountPaise) } : {}),
      title: r.title,
      status: r.status,
      ...(r.snoozeUntil ? { snoozeUntil: r.snoozeUntil } : {}),
    });
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

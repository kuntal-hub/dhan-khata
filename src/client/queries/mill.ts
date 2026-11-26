/**
 * Mill & Second Party reads (requirement_v2.1 §12.8), one Gola at a time.
 *  - Dispatch-wise history: sent, returned, consumed, accepted, shortfall, still at the mill
 *    (`dispatchBalance`, from the active returns / conversions / final settlement).
 *  - Dispatch money (the mill PAYS us): value − paddy-return credits − settlement adjustment =
 *    net value; collected = IN payments − refunds against the dispatch; receivable = net −
 *    collected (negative = the mill paid too much → "মিলকে ফেরত দিতে হবে").
 *  - Second parties: "we owe" / "they owe" entries with their payments, and the party balance.
 */
import { todayIST } from "@/domain/dates";
import {
  billState,
  billsOf,
  millCredits,
  type BillState,
  type PayStatus,
} from "@/domain/v2/payments";
import { dispatchBalance, type DispatchBalance } from "@/domain/v2/stock";
import type { Doc, DocOf, Party, Payment, Variety } from "@/domain/schemas";
import { db } from "../db/dexie";
import { godownBalances } from "./ledger";
import { paymentsOf } from "./purchases";

export type Dispatch = DocOf<"MILL_DISPATCH">;
export type MillReturn = DocOf<"MILL_RETURN">;
export type Conversion = DocOf<"CONVERSION">;
export type Settlement = DocOf<"MILL_SETTLEMENT">;
export type SecondPartyEntry = DocOf<"SECOND_PARTY">;

export interface DispatchMoney {
  /** quantity × rate the mill pays. */
  valuePaise: bigint;
  /** Σ credits of active paddy returns. */
  returnCreditPaise: bigint;
  /** Final-settlement adjustment (signed: a cut is positive). */
  settlementAdjPaise: bigint;
  /** value − return credits − settlement adjustment. */
  netValuePaise: bigint;
  /** Σ IN collections − Σ refunds against this dispatch. */
  collectedPaise: bigint;
  /** net − collected (< 0: the mill paid more than it owes). */
  receivablePaise: bigint;
}

export interface DispatchRow {
  doc: Dispatch;
  mill?: Party;
  variety?: Variety;
  balance: DispatchBalance;
  money: DispatchMoney;
  /** Bill state over the NET value (what the mill still owes for this dispatch). */
  state: BillState;
  /** Active final settlement, if any. */
  settlement?: Settlement;
}

async function related(godownId: string): Promise<Doc[]> {
  const d = db();
  const [returns, conversions, settlements, sales] = await Promise.all([
    d.vouchers.where("[godownId+type]").equals([godownId, "MILL_RETURN"]).toArray(),
    d.vouchers.where("[godownId+type]").equals([godownId, "CONVERSION"]).toArray(),
    d.vouchers.where("[godownId+type]").equals([godownId, "MILL_SETTLEMENT"]).toArray(),
    d.vouchers
      .where("[godownId+type]")
      .equals([godownId, "SALE"])
      .filter((x) => x.type === "SALE" && !!x.consignmentDispatchId)
      .toArray(),
  ]);
  return [...returns, ...conversions, ...settlements, ...sales];
}

/** Money of one dispatch from its linked docs and its active payments (incl. refunds). */
export function dispatchMoney(
  doc: Dispatch,
  linked: readonly Doc[],
  payments: readonly Payment[],
  today = todayIST(),
): { money: DispatchMoney; state: BillState } {
  const credits = millCredits(linked.filter((x) => "dispatchId" in x && x.dispatchId === doc._id));
  const net = BigInt(doc.totalValuePaise) - (credits.get(doc._id) ?? 0n);
  const bill = { ...billsOf({ ...doc, status: "active" })[0]!, totalPaise: net };
  const state = billState(bill, payments, today);
  const active = linked.filter((x) => x.status === "active");
  const returnCredit = active
    .filter((x): x is MillReturn => x.type === "MILL_RETURN" && x.dispatchId === doc._id)
    .filter((x) => x.product === "PADDY")
    .reduce((s, x) => s + BigInt(x.totalValuePaise ?? "0"), 0n);
  const value = BigInt(doc.totalValuePaise);
  return {
    money: {
      valuePaise: value,
      returnCreditPaise: returnCredit,
      settlementAdjPaise: value - returnCredit - net,
      netValuePaise: net,
      collectedPaise: state.paidPaise,
      receivablePaise: net - state.paidPaise,
    },
    state,
  };
}

const isMine = (doc: Dispatch) => (x: Doc) =>
  x.type === "SALE"
    ? x.consignmentDispatchId === doc._id
    : (x as { dispatchId?: string }).dispatchId === doc._id;

async function maps(godownId: string) {
  const d = db();
  const [parties, varieties] = await Promise.all([
    d.parties.where("godownId").equals(godownId).toArray(),
    d.varieties.where("godownId").equals(godownId).toArray(),
  ]);
  return {
    party: new Map(parties.map((p) => [p._id, p] as const)),
    variety: new Map(varieties.map((v) => [v._id, v] as const)),
  };
}

export interface DispatchFilter {
  millId?: string;
  /** Only dispatches with paddy still at the mill. */
  open?: boolean;
  /** Only active dispatches without a final settlement. */
  unsettled?: boolean;
  q?: string;
  status?: PayStatus | "ALL";
}

export async function dispatchRows(
  godownId: string,
  f: DispatchFilter = {},
): Promise<DispatchRow[]> {
  const d = db();
  const docs = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, "MILL_DISPATCH"])
    .toArray()) as Dispatch[];
  const rel = await related(godownId);
  const m = await maps(godownId);
  const today = todayIST();
  const s = f.q?.trim().toLowerCase() ?? "";
  const out: DispatchRow[] = [];
  for (const doc of docs) {
    if (f.millId && doc.millPartyId !== f.millId) continue;
    const mine = rel.filter(isMine(doc));
    const balance = dispatchBalance(doc, mine);
    if (f.open && (doc.status !== "active" || balance.remainingG <= 0n)) continue;
    const settlement = mine.find(
      (x): x is Settlement => x.type === "MILL_SETTLEMENT" && x.status === "active",
    );
    if (f.unsettled && (doc.status !== "active" || settlement)) continue;
    const pays = (await paymentsOf(doc._id)).filter((p) => p.status === "active");
    const { money, state } = dispatchMoney(doc, mine, pays, today);
    if (f.status && f.status !== "ALL") {
      if (doc.status !== "active" || state.status !== f.status) continue;
    }
    const row: DispatchRow = {
      doc,
      mill: m.party.get(doc.millPartyId),
      variety: m.variety.get(doc.varietyId),
      balance,
      money,
      state,
      ...(settlement ? { settlement } : {}),
    };
    if (s) {
      const hay = [
        row.mill?.name,
        row.mill?.searchKey,
        row.mill?.phone,
        row.variety?.name,
        row.variety?.systemKey,
        doc.number,
        doc.vehicleNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(s)) continue;
    }
    out.push(row);
  }
  return out.sort((a, b) =>
    a.doc.dispatchDate === b.doc.dispatchDate
      ? a.doc.createdAt < b.doc.createdAt
        ? 1
        : -1
      : a.doc.dispatchDate < b.doc.dispatchDate
        ? 1
        : -1,
  );
}

export interface DispatchDetail extends DispatchRow {
  payments: Payment[];
  returns: MillReturn[];
  conversions: Conversion[];
  /** Final settlements (any status, for history). */
  settlements: Settlement[];
  /** Legacy v2.0 consignment sales of this dispatch (read-only history). */
  legacySales: DocOf<"SALE">[];
}

/** One dispatch with everything linked to it (any status, for history). */
export async function dispatchDetail(id: string): Promise<DispatchDetail | null> {
  const d = db();
  const doc = await d.vouchers.get(id);
  if (!doc || doc.type !== "MILL_DISPATCH") return null;
  const linked = await d.vouchers.where("dispatchId").equals(id).toArray();
  const legacySales = (await d.vouchers
    .where("[godownId+type]")
    .equals([doc.godownId, "SALE"])
    .filter((x) => x.type === "SALE" && x.consignmentDispatchId === id)
    .toArray()) as DocOf<"SALE">[];
  const payments = await paymentsOf(id);
  const [mill, variety] = await Promise.all([
    d.parties.get(doc.millPartyId),
    d.varieties.get(doc.varietyId),
  ]);
  const active = payments.filter((p) => p.status === "active");
  const { money, state } = dispatchMoney(doc, linked, active);
  const byDate = <T extends Doc>(a: T, b: T) => (a.createdAt < b.createdAt ? -1 : 1);
  const settlements = (linked.filter((x) => x.type === "MILL_SETTLEMENT") as Settlement[]).sort(
    byDate,
  );
  const settlement = settlements.find((s) => s.status === "active");
  return {
    doc,
    mill,
    variety,
    balance: dispatchBalance(doc, [...linked, ...legacySales]),
    money,
    state,
    ...(settlement ? { settlement } : {}),
    payments,
    returns: (linked.filter((x) => x.type === "MILL_RETURN") as MillReturn[]).sort(byDate),
    conversions: (linked.filter((x) => x.type === "CONVERSION") as Conversion[]).sort(byDate),
    settlements,
    legacySales: legacySales.sort(byDate),
  };
}

export interface ReturnRow {
  doc: MillReturn;
  mill?: Party;
  variety?: Variety;
  dispatch?: Dispatch;
  /** Paddy: the credit to the mill (its receivable goes down by this). 0 for rice / other. */
  creditPaise: bigint;
  /** Legacy v2.0 money received with the return (repaired onto the dispatch by the data fix). */
  receivedPaise: bigint;
  /** Rice / other already used by an active conversion. */
  converted: boolean;
}

export async function returnRows(
  godownId: string,
  f: { dispatchId?: string; product?: MillReturn["product"] | "ALL" } = {},
): Promise<ReturnRow[]> {
  const d = db();
  const docs = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, "MILL_RETURN"])
    .toArray()) as MillReturn[];
  const convs = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, "CONVERSION"])
    .filter((x) => x.status === "active")
    .toArray()) as Conversion[];
  const used = new Set(convs.flatMap((c) => c.outputs.map((o) => o.returnId)));
  const m = await maps(godownId);
  const out: ReturnRow[] = [];
  for (const doc of docs) {
    if (f.dispatchId && doc.dispatchId !== f.dispatchId) continue;
    if (f.product && f.product !== "ALL" && doc.product !== f.product) continue;
    const pays = (await paymentsOf(doc._id)).filter((p) => p.status === "active");
    const dispatch = (await d.vouchers.get(doc.dispatchId)) as Dispatch | undefined;
    out.push({
      doc,
      mill: m.party.get(doc.millPartyId),
      variety: doc.varietyId ? m.variety.get(doc.varietyId) : undefined,
      dispatch,
      creditPaise: doc.product === "PADDY" ? BigInt(doc.totalValuePaise ?? "0") : 0n,
      receivedPaise: pays.reduce((s, p) => s + BigInt(p.amountPaise), 0n),
      converted: used.has(doc._id),
    });
  }
  return out.sort((a, b) =>
    a.doc.returnDate === b.doc.returnDate
      ? a.doc.createdAt < b.doc.createdAt
        ? 1
        : -1
      : a.doc.returnDate < b.doc.returnDate
        ? 1
        : -1,
  );
}

/**
 * Rice / by-product returns of a dispatch that no other active conversion uses yet
 * (`keepConversionId`: the conversion being edited keeps its own outputs).
 */
export async function convertibleReturns(
  dispatchId: string,
  keepConversionId?: string,
): Promise<MillReturn[]> {
  const d = db();
  const linked = await d.vouchers.where("dispatchId").equals(dispatchId).toArray();
  const used = new Set(
    linked
      .filter(
        (x): x is Conversion =>
          x.type === "CONVERSION" && x.status === "active" && x._id !== keepConversionId,
      )
      .flatMap((c) => c.outputs.map((o) => o.returnId)),
  );
  return (
    linked.filter(
      (x): x is MillReturn =>
        x.type === "MILL_RETURN" &&
        x.status === "active" &&
        x.product !== "PADDY" &&
        !used.has(x._id),
    ) as MillReturn[]
  ).sort((a, b) => (a.returnDate < b.returnDate ? -1 : 1));
}

export interface ConversionRow {
  doc: Conversion;
  mill?: Party;
  variety?: Variety;
  dispatch?: Dispatch;
}

export async function conversionRows(godownId: string): Promise<ConversionRow[]> {
  const d = db();
  const docs = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, "CONVERSION"])
    .toArray()) as Conversion[];
  const m = await maps(godownId);
  const out: ConversionRow[] = [];
  for (const doc of docs) {
    out.push({
      doc,
      mill: m.party.get(doc.millPartyId),
      variety: m.variety.get(doc.varietyId),
      dispatch: (await d.vouchers.get(doc.dispatchId)) as Dispatch | undefined,
    });
  }
  return out.sort((a, b) => (a.doc.conversionDate < b.doc.conversionDate ? 1 : -1));
}

/** Conversion % (basis points) for information only: Σ outputs / consumed. */
export function conversionBps(consumedG: bigint, outputsG: bigint): bigint {
  if (consumedG <= 0n) return 0n;
  return (outputsG * 10_000n) / consumedG;
}

// ── Second party ledger (§12.8A) ─────────────────────────────────────────────────────────────

export interface SecondPartySummary {
  party: Party;
  weOwePaise: bigint;
  theyOwePaise: bigint;
  /** Party balance: > 0 they owe us, < 0 we owe them. */
  balancePaise: bigint;
  lastDate?: string;
}

export async function secondPartySummaries(godownId: string): Promise<SecondPartySummary[]> {
  const d = db();
  const parties = (await d.parties.where("godownId").equals(godownId).toArray()).filter(
    (p) => p.status === "active" && p.roles.includes("SECOND_PARTY"),
  );
  const entries = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, "SECOND_PARTY"])
    .filter((x) => x.status === "active")
    .toArray()) as SecondPartyEntry[];
  const balances = await godownBalances(godownId);
  return parties
    .map((party) => {
      const mine = entries.filter((e) => e.partyId === party._id);
      const sum = (k: SecondPartyEntry["kind"]) =>
        mine.filter((e) => e.kind === k).reduce((s, e) => s + BigInt(e.amountPaise), 0n);
      const last = mine.map((e) => e.transactionDate).sort();
      return {
        party,
        weOwePaise: sum("WE_OWE"),
        theyOwePaise: sum("THEY_OWE"),
        balancePaise: balances.get(`PARTY:${party._id}`) ?? 0n,
        ...(last.length ? { lastDate: last[last.length - 1] } : {}),
      };
    })
    .sort((a, b) => {
      const x = a.balancePaise < 0n ? -a.balancePaise : a.balancePaise;
      const y = b.balancePaise < 0n ? -b.balancePaise : b.balancePaise;
      return x === y ? a.party.name.localeCompare(b.party.name) : x > y ? -1 : 1;
    });
}

export interface SecondPartyRow {
  doc: SecondPartyEntry;
  party?: Party;
  state: BillState;
}

export async function secondPartyEntries(
  godownId: string,
  partyId?: string,
): Promise<SecondPartyRow[]> {
  const d = db();
  const docs = (await d.vouchers
    .where("[godownId+type]")
    .equals([godownId, "SECOND_PARTY"])
    .toArray()) as SecondPartyEntry[];
  const m = await maps(godownId);
  const today = todayIST();
  const out: SecondPartyRow[] = [];
  for (const doc of docs) {
    if (partyId && doc.partyId !== partyId) continue;
    const pays = (await paymentsOf(doc._id)).filter((p) => p.status === "active");
    const bill = billsOf({ ...doc, status: "active" })[0]!;
    out.push({ doc, party: m.party.get(doc.partyId), state: billState(bill, pays, today) });
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

/** On-account second-party money (no entry) of a party, any status. */
export async function secondPartyOnAccount(godownId: string, partyId: string): Promise<Payment[]> {
  const rows = await db()
    .vouchers.where("[godownId+partyId]")
    .equals([godownId, partyId])
    .filter((x) => x.type === "PAYMENT" && x.source.type === "SECOND_PARTY" && x.source.id === null)
    .toArray();
  return (rows as Payment[]).sort((a, b) => (a.paymentDate < b.paymentDate ? -1 : 1));
}

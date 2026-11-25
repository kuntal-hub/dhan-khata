/**
 * Mill & Second Party reads (requirement_v2 §12.8), one Gola at a time.
 *  - Dispatch-wise history: sent, returned, consumed, settled, remaining at the mill
 *    (`dispatchBalance`, from the active returns / conversions / settlement sales).
 *  - MILLING dispatch: milling charges payable to the mill, paid / due from its active payments.
 *    CONSIGNMENT dispatch: the expected value is informational; money already received from the
 *    mill is an advance (IN payments against the dispatch) until the settlement sale.
 *  - Second parties: "we owe" / "they owe" entries with their payments, and the party balance.
 */
import { todayIST } from "@/domain/dates";
import { billState, billsOf, type BillState, type PayStatus } from "@/domain/v2/payments";
import { dispatchBalance, type DispatchBalance } from "@/domain/v2/stock";
import type { Doc, DocOf, Party, Payment, Variety } from "@/domain/schemas";
import { db } from "../db/dexie";
import { godownBalances } from "./ledger";
import { paymentsOf } from "./purchases";

export type Dispatch = DocOf<"MILL_DISPATCH">;
export type MillReturn = DocOf<"MILL_RETURN">;
export type Conversion = DocOf<"CONVERSION">;
export type SecondPartyEntry = DocOf<"SECOND_PARTY">;

export interface DispatchRow {
  doc: Dispatch;
  mill?: Party;
  variety?: Variety;
  balance: DispatchBalance;
  /** Bill state (MILLING: what we owe the mill; CONSIGNMENT: expected value vs advances). */
  state: BillState;
  /** Active payments against the dispatch (MILLING: paid; CONSIGNMENT: advances received). */
  paidPaise: bigint;
}

async function related(godownId: string): Promise<Doc[]> {
  const d = db();
  const [returns, conversions, sales] = await Promise.all([
    d.vouchers.where("[godownId+type]").equals([godownId, "MILL_RETURN"]).toArray(),
    d.vouchers.where("[godownId+type]").equals([godownId, "CONVERSION"]).toArray(),
    d.vouchers
      .where("[godownId+type]")
      .equals([godownId, "SALE"])
      .filter((x) => x.type === "SALE" && !!x.consignmentDispatchId)
      .toArray(),
  ]);
  return [...returns, ...conversions, ...sales];
}

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
  type?: Dispatch["dispatchType"] | "ALL";
  millId?: string;
  /** Only dispatches with paddy still at the mill. */
  open?: boolean;
  q?: string;
  status?: PayStatus | "ALL";
}

function dispatchState(doc: Dispatch, payments: readonly Payment[], today: string): BillState {
  const bill = billsOf({ ...doc, status: "active" })[0]!;
  return billState(bill, payments, today);
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
    if (f.type && f.type !== "ALL" && doc.dispatchType !== f.type) continue;
    if (f.millId && doc.millPartyId !== f.millId) continue;
    const mine = rel.filter((x) =>
      x.type === "SALE"
        ? x.consignmentDispatchId === doc._id
        : (x as { dispatchId?: string }).dispatchId === doc._id,
    );
    const balance = dispatchBalance(doc, mine);
    if (f.open && (doc.status !== "active" || balance.remainingG <= 0n)) continue;
    const pays = (await paymentsOf(doc._id)).filter((p) => p.status === "active");
    const state = dispatchState(doc, pays, today);
    if (f.status && f.status !== "ALL") {
      if (doc.status !== "active" || doc.dispatchType !== "MILLING" || state.status !== f.status)
        continue;
    }
    const row: DispatchRow = {
      doc,
      mill: m.party.get(doc.millPartyId),
      variety: m.variety.get(doc.varietyId),
      balance,
      state,
      paidPaise: state.paidPaise,
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
  settlements: DocOf<"SALE">[];
}

/** One dispatch with everything linked to it (any status, for history). */
export async function dispatchDetail(id: string): Promise<DispatchDetail | null> {
  const d = db();
  const doc = await d.vouchers.get(id);
  if (!doc || doc.type !== "MILL_DISPATCH") return null;
  const linked = await d.vouchers.where("dispatchId").equals(id).toArray();
  const settlements = (await d.vouchers
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
  const state = dispatchState(doc, active, todayIST());
  const byDate = <T extends Doc>(a: T, b: T) => (a.createdAt < b.createdAt ? -1 : 1);
  return {
    doc,
    mill,
    variety,
    balance: dispatchBalance(doc, [...linked, ...settlements]),
    state,
    paidPaise: state.paidPaise,
    payments,
    returns: (linked.filter((x) => x.type === "MILL_RETURN") as MillReturn[]).sort(byDate),
    conversions: (linked.filter((x) => x.type === "CONVERSION") as Conversion[]).sort(byDate),
    settlements: settlements.sort(byDate),
  };
}

export interface ReturnRow {
  doc: MillReturn;
  mill?: Party;
  variety?: Variety;
  dispatch?: Dispatch;
  /** Money received from the mill with this return (active IN payments). */
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

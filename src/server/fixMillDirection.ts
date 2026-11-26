/**
 * v2.1 data repair: "money direction with mills" (docs/BUGFIX_MILL_DIRECTION.md).
 *
 * Idempotent. Dry run by default (nothing is written); `apply: true` writes, one Mongo transaction
 * per Gola. Nothing is ever deleted: edited documents get a new revision (audited), a converted
 * consignment sale is VOIDED (kept in history), new final settlements are created.
 *
 * Per Gola:
 *  1. Payments
 *     - IN payments against a mill RETURN → re-pointed to the return's dispatch (same money).     [auto]
 *     - OUT payments against a mill DISPATCH → ambiguous (a mill collection entered the wrong way
 *       round, OR a real milling charge / refund). Never changed without the owner's decision:
 *       "IN" (flip: cash/bank change by 2 × amount) or "REFUND" (keep OUT as a MILL_REFUND).      [review]
 *  2. Dispatches
 *     - CONSIGNMENT: the expected price becomes the price the mill pays.                          [auto]
 *     - MILLING with a rate > 0: the rate was a milling CHARGE, not a sale price → the owner must
 *       enter the price the mill pays.                                                             [review]
 *     - MILLING with rate 0: posted as a ₹0 receivable until a price is entered.                   [review, optional]
 *     - Paddy returns without a value: credit = quantity × the dispatch rate (the spec default).    [auto]
 *       Paddy returns with an entered value (v2.0 "stock value") → confirm or change the credit.   [review]
 *  3. Consignment sales (v2.0 settlement) → one MILL_SETTLEMENT on the dispatch (accepted = sale
 *     quantity, final rate = sale rate), the sale voided, its payments re-pointed to the dispatch.  [auto]
 *     Two or more on one dispatch, or a rounded total → review.
 *  4. Rebuild ledger lines + stock moves of the Gola (full replay) and log every voucher in the
 *     changelog, so every device re-downloads the documents with their new rows (dailyAgg follows).
 *  5. Reconcile before/after: cash, each bank, each mill, receivable / payable, stock quantities.
 *     Stock quantities must be unchanged; cash/bank may change only by 2 × each flipped payment.
 *
 * A Gola with an undecided BLOCKING review item is not changed at all (reported as blocked).
 */
import type { ClientSession, Db } from "mongodb";
import { v7 as uuidv7 } from "uuid";
import { fyOf } from "@/domain/dates";
import { amountForWeight } from "@/domain/money";
import { validateLinks } from "@/domain/v2/links";
import {
  settlementAmounts,
  recomputeDoc,
  validateDocRules,
  verifyDoc,
} from "@/domain/v2/recompute";
import { deriveAll } from "@/domain/v2/replay";
import {
  DocSchema,
  type Doc,
  type DocOf,
  type LedgerLineV2,
  type Payment,
  type StockMoveV2,
} from "@/domain/v2/schemas";
import { logChanges, type ChangeEntry } from "./changelog";
import { toDbLine, toDbMove } from "./convert";
import { cols, getMongoClient } from "./db";

export const FIX_REASON = "v2.1 mill-direction fix";

/** The owner's answers, keyed by document id (see docs/MILL_FIX_REVIEW.md). */
export interface FixDecisions {
  /** OUT payment against a dispatch: "IN" = it was money FROM the mill; "REFUND" = real money TO it. */
  payments?: Record<string, "IN" | "REFUND">;
  /** v2.0 MILLING dispatch: the price per quintal the mill pays, in rupees ("2600" or "2600.50"). */
  rates?: Record<string, string>;
  /** Paddy return with a v2.0 value: the credit to the mill in rupees ("13000"), or "DEFAULT". */
  credits?: Record<string, string>;
}

export interface Snapshot {
  cashPaise: bigint;
  banks: Record<string, bigint>;
  /** Party balance of each mill (> 0 = the mill owes us). */
  mills: Record<string, bigint>;
  receivablePaise: bigint;
  payablePaise: bigint;
  warehousePaddyG: bigint;
  millPaddyG: bigint;
  riceG: bigint;
  otherG: bigint;
}

export interface ReviewItem {
  kind: "PAYMENT_DIRECTION" | "MILLING_RATE" | "RETURN_CREDIT" | "CONSIGNMENT_SALE" | "MILL_SALE";
  godownId: string;
  docId: string;
  number: string;
  date: string;
  millPartyId?: string;
  amountPaise?: bigint;
  /** What the script proposes / the current value. */
  current: string;
  proposed: string;
  /** Blocking items stop the Gola from being changed until decided. */
  blocking: boolean;
  decided?: string;
}

export interface GolaResult {
  godownId: string;
  name: string;
  status: "unchanged" | "planned" | "applied" | "blocked";
  auto: string[];
  review: ReviewItem[];
  /** Payments flipped OUT → IN: account → Σ amount. */
  flips: Array<{ paymentId: string; account: string; amountPaise: bigint }>;
  changedDocs: number;
  before: Snapshot;
  after?: Snapshot;
  checks: string[];
  problems: string[];
}

export interface FixReport {
  apply: boolean;
  at: string;
  golas: GolaResult[];
}

const rupeesToPaise = (s: string): bigint => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) throw new Error(`Bad amount in decisions: "${s}"`);
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
};

/** Balances and stock from stored or rebuilt derived rows. */
export function snapshotOf(
  lines: ReadonlyArray<Pick<LedgerLineV2, "account" | "debitPaise" | "creditPaise">>,
  moves: ReadonlyArray<Pick<StockMoveV2, "product" | "location" | "qtyG">>,
  millIds: ReadonlySet<string>,
): Snapshot {
  const bal = new Map<string, bigint>();
  for (const l of lines) {
    bal.set(l.account, (bal.get(l.account) ?? 0n) + BigInt(l.debitPaise) - BigInt(l.creditPaise));
  }
  const s: Snapshot = {
    cashPaise: bal.get("CASH") ?? 0n,
    banks: {},
    mills: {},
    receivablePaise: 0n,
    payablePaise: 0n,
    warehousePaddyG: 0n,
    millPaddyG: 0n,
    riceG: 0n,
    otherG: 0n,
  };
  for (const [a, v] of bal) {
    if (a.startsWith("BANK:")) s.banks[a.slice(5)] = v;
    if (a.startsWith("PARTY:")) {
      const id = a.slice(6);
      if (millIds.has(id)) s.mills[id] = v;
      if (v > 0n) s.receivablePaise += v;
      else s.payablePaise -= v;
    }
  }
  for (const m of moves) {
    const q = BigInt(m.qtyG);
    if (m.product === "PADDY" && m.location === "WAREHOUSE") s.warehousePaddyG += q;
    else if (m.product === "PADDY" && m.location === "MILL") s.millPaddyG += q;
    else if (m.product === "RICE") s.riceG += q;
    else if (m.product === "OTHER") s.otherG += q;
  }
  return s;
}

interface PlanCtx {
  godownId: string;
  godownCode: string;
  actorId: string;
  deviceId: string;
  today: string;
  nowIso: string;
  decisions: FixDecisions;
  nextSettlementSeq: () => number;
}

interface Plan {
  docs: Map<string, Doc>;
  changed: Set<string>;
  auto: string[];
  review: ReviewItem[];
  flips: GolaResult["flips"];
}

/** Plan the repair of one Gola's documents (pure: no database access). */
export function planGola(input: readonly Doc[], ctx: PlanCtx): Plan {
  const docs = new Map(input.map((d) => [d._id, d] as const));
  const changed = new Set<string>();
  const auto: string[] = [];
  const review: ReviewItem[] = [];
  const flips: Plan["flips"] = [];
  const bump = <D extends Doc>(d: D, patch: Partial<D>): D => {
    const next = {
      ...d,
      ...patch,
      rev: d.rev + 1,
      updatedAt: ctx.nowIso,
      updatedBy: ctx.actorId,
      editReason: FIX_REASON,
    } as D;
    docs.set(d._id, next);
    changed.add(d._id);
    return next;
  };
  const active = () => [...docs.values()].filter((d) => d.status === "active");
  const dispatchOf = (id: string) => {
    const d = docs.get(id);
    return d && d.type === "MILL_DISPATCH" ? d : undefined;
  };
  const moneyAccount = (p: Payment) => (p.mode === "CASH" ? "CASH" : `BANK:${p.bankAccountId}`);

  // ── 2a. Dispatches: rates ──
  for (const d of active()) {
    if (d.type !== "MILL_DISPATCH" || !d.dispatchType) continue;
    if (d.dispatchType === "CONSIGNMENT") {
      // Dropping the deprecated type also marks the dispatch as done (idempotent re-runs).
      const { dispatchType: _drop, ...rest } = d;
      void _drop;
      bump(rest as DocOf<"MILL_DISPATCH">, {});
      auto.push(
        `dispatch ${d.number}: consignment price ${d.ratePaisePerQtl} paise/qtl kept as the price the mill pays`,
      );
      continue;
    }
    // MILLING: the rate was a milling charge.
    const decided = ctx.decisions.rates?.[d._id];
    const blocking = BigInt(d.ratePaisePerQtl) > 0n;
    review.push({
      kind: "MILLING_RATE",
      godownId: ctx.godownId,
      docId: d._id,
      number: d.number,
      date: d.dispatchDate,
      millPartyId: d.millPartyId,
      amountPaise: BigInt(d.totalValuePaise),
      current: `milling charge ${d.ratePaisePerQtl} paise/qtl (total ${d.totalValuePaise} paise, was payable TO the mill)`,
      proposed: "enter the price per quintal the mill pays",
      blocking,
      ...(decided ? { decided } : {}),
    });
    if (decided) {
      const rate = rupeesToPaise(decided).toString();
      const { dispatchType: _drop, ...rest } = d;
      void _drop;
      bump(rest as DocOf<"MILL_DISPATCH">, {
        ratePaisePerQtl: rate,
        totalValuePaise: amountForWeight(BigInt(d.weight.netG), BigInt(rate)).toString(),
      });
    }
  }

  // ── 2b. Paddy returns: credit ──
  for (const r of active()) {
    if (r.type !== "MILL_RETURN" || r.product !== "PADDY") continue;
    const di = dispatchOf(r.dispatchId);
    if (!di) continue;
    const dflt = amountForWeight(BigInt(r.weight.netG), BigInt(di.ratePaisePerQtl));
    if (r.ratePaisePerQtl === di.ratePaisePerQtl) continue; // already a v2.1 credit
    if (r.ratePaisePerQtl === undefined && r.totalValuePaise === undefined) {
      bump(r, { ratePaisePerQtl: di.ratePaisePerQtl });
      auto.push(`return ${r.number}: credit = qty × dispatch rate = ${dflt} paise`);
      continue;
    }
    // A typed credit (value without a rate) only exists in v2.1 (the v2.0 form always stored the
    // rate with a value), or was decided on an earlier run: leave it.
    if (r.ratePaisePerQtl === undefined) continue;
    const decided = ctx.decisions.credits?.[r._id];
    review.push({
      kind: "RETURN_CREDIT",
      godownId: ctx.godownId,
      docId: r._id,
      number: r.number,
      date: r.returnDate,
      millPartyId: r.millPartyId,
      amountPaise: BigInt(r.totalValuePaise ?? "0"),
      current: `v2.0 stock value ${r.totalValuePaise ?? "0"} paise`,
      proposed: `credit ${dflt} paise (qty × dispatch rate)`,
      blocking: true,
      ...(decided ? { decided } : {}),
    });
    if (decided === "DEFAULT") bump(r, { ratePaisePerQtl: di.ratePaisePerQtl });
    else if (decided) {
      const { ratePaisePerQtl: _r, ...rest } = r;
      void _r;
      docs.set(r._id, rest as Doc);
      bump(rest as DocOf<"MILL_RETURN">, { totalValuePaise: rupeesToPaise(decided).toString() });
    }
  }

  // ── 1. Payments ──
  for (const p of active()) {
    if (p.type !== "PAYMENT") continue;
    if (p.source.type === "MILL_RETURN" && p.source.id) {
      const r = docs.get(p.source.id);
      const dispatchId = r && r.type === "MILL_RETURN" ? r.dispatchId : null;
      if (dispatchId && p.direction === "IN") {
        bump(p, { source: { type: "MILL_DISPATCH", id: dispatchId } });
        auto.push(
          `payment ${p.number}: money received with return ${r!.number} moved to its dispatch (no cash change)`,
        );
        continue;
      }
      const decided = ctx.decisions.payments?.[p._id];
      review.push({
        kind: "PAYMENT_DIRECTION",
        godownId: ctx.godownId,
        docId: p._id,
        number: p.number,
        date: p.paymentDate,
        ...(p.partyId ? { millPartyId: p.partyId } : {}),
        amountPaise: BigInt(p.amountPaise),
        current: `${p.direction} (${p.mode}) against a mill return`,
        proposed: "IN if this was money FROM the mill; REFUND if you really paid the mill",
        blocking: true,
        ...(decided ? { decided } : {}),
      });
      if (decided === "IN") {
        bump(p, { direction: "IN", source: { type: "MILL_DISPATCH", id: dispatchId } });
        if (p.direction === "OUT")
          flips.push({
            paymentId: p._id,
            account: moneyAccount(p),
            amountPaise: BigInt(p.amountPaise),
          });
      } else if (decided === "REFUND") {
        bump(p, { direction: "OUT", source: { type: "MILL_REFUND", id: dispatchId } });
        if (p.direction === "IN")
          flips.push({
            paymentId: p._id,
            account: moneyAccount(p),
            amountPaise: -BigInt(p.amountPaise),
          });
      }
      continue;
    }
    if (p.source.type === "MILL_DISPATCH" && p.direction === "OUT") {
      const decided = ctx.decisions.payments?.[p._id];
      review.push({
        kind: "PAYMENT_DIRECTION",
        godownId: ctx.godownId,
        docId: p._id,
        number: p.number,
        date: p.paymentDate,
        ...(p.partyId ? { millPartyId: p.partyId } : {}),
        amountPaise: BigInt(p.amountPaise),
        current: `OUT (${p.mode}) — counted as money paid to the mill`,
        proposed:
          "IN if this was money FROM the mill (cash/bank +2× amount); REFUND if you really paid the mill",
        blocking: true,
        ...(decided ? { decided } : {}),
      });
      if (decided === "IN") {
        bump(p, { direction: "IN" });
        flips.push({
          paymentId: p._id,
          account: moneyAccount(p),
          amountPaise: BigInt(p.amountPaise),
        });
      } else if (decided === "REFUND") {
        bump(p, { source: { type: "MILL_REFUND", id: p.source.id } });
      }
    }
  }

  // ── 3. Consignment sales → final settlement ──
  const salesByDispatch = new Map<string, DocOf<"SALE">[]>();
  for (const s of active()) {
    if (s.type !== "SALE" || !s.consignmentDispatchId) continue;
    salesByDispatch.set(s.consignmentDispatchId, [
      ...(salesByDispatch.get(s.consignmentDispatchId) ?? []),
      s,
    ]);
  }
  for (const [dispatchId, sales] of salesByDispatch) {
    const di = dispatchOf(dispatchId);
    const s = sales[0]!;
    const exact = s.roundOffPaise === "0";
    if (!di || sales.length > 1 || !exact || di.status !== "active") {
      for (const x of sales) {
        review.push({
          kind: "CONSIGNMENT_SALE",
          godownId: ctx.godownId,
          docId: x._id,
          number: x.number,
          date: x.transactionDate,
          millPartyId: x.partyId,
          amountPaise: BigInt(x.totalPaise),
          current:
            "v2.0 consignment settlement recorded as a SALE (income counted twice under v2.1)",
          proposed:
            sales.length > 1
              ? "several sales on one dispatch: record one final settlement by hand, then void these sales"
              : "rounded / unusual sale: record the final settlement by hand, then void this sale",
          blocking: true,
        });
      }
      continue;
    }
    const base = {
      acceptedG: s.weight.netG,
      shortfallG: "0",
      dispatchRatePaisePerQtl: di.ratePaisePerQtl,
      finalRatePaisePerQtl: s.ratePaisePerQtl,
      deductionPaise: "0",
    };
    const a = settlementAmounts(base);
    const id = uuidv7();
    const seq = ctx.nextSettlementSeq();
    const settlement = {
      _id: id,
      businessId: s.businessId,
      godownId: s.godownId,
      rev: 1,
      status: "active",
      entryDate: ctx.today,
      createdAt: s.createdAt,
      createdBy: ctx.actorId,
      updatedAt: ctx.nowIso,
      updatedBy: ctx.actorId,
      deviceId: ctx.deviceId,
      number: `${ctx.godownCode}-FIX-MST-${String(seq).padStart(6, "0")}`,
      fy: fyOf(s.transactionDate),
      notes: `${FIX_REASON}: from sale ${s.number}`,
      type: "MILL_SETTLEMENT",
      dispatchId: di._id,
      millPartyId: di.millPartyId,
      varietyId: di.varietyId,
      transactionDate: s.transactionDate,
      ...base,
      billedPaise: a.billedPaise.toString(),
      finalValuePaise: a.finalValuePaise.toString(),
      adjustmentPaise: a.adjustmentPaise.toString(),
    } as Doc;
    docs.set(id, settlement);
    changed.add(id);
    for (const p of active()) {
      if (p.type === "PAYMENT" && p.source.id === s._id) {
        bump(p, { source: { type: "MILL_DISPATCH", id: di._id } });
      }
    }
    bump(s, {
      status: "void",
      voidReason: `${FIX_REASON}: replaced by final settlement ${settlement.number}`,
    });
    auto.push(
      `sale ${s.number} (consignment) → final settlement ${settlement.number} on dispatch ${di.number}; sale voided, its payments moved to the dispatch`,
    );
  }

  // ── Information: sales from mill stock that are not consignment settlements ──
  for (const s of active()) {
    if (s.type === "SALE" && s.source === "MILL" && !s.consignmentDispatchId) {
      review.push({
        kind: "MILL_SALE",
        godownId: ctx.godownId,
        docId: s._id,
        number: s.number,
        date: s.transactionDate,
        millPartyId: s.sourceMillId ?? "",
        amountPaise: BigInt(s.totalPaise),
        current: "sale to another buyer from paddy lying at a mill",
        proposed:
          "check: under v2.1 paddy sent to a mill is the mill's to pay for. If the mill did not buy it, record a return of that paddy first",
        blocking: false,
      });
    }
  }

  return { docs, changed, auto, review, flips };
}

/** Check every changed document exactly like the write path (recompute, rules, links). */
function validateChanged(plan: Plan, today: string): string[] {
  const problems: string[] = [];
  for (const id of plan.changed) {
    const raw = plan.docs.get(id)!;
    try {
      const d = DocSchema.parse(recomputeDoc(raw));
      plan.docs.set(id, d);
      if (d.status === "void") continue;
      const diffs = verifyDoc(d);
      if (diffs.length) problems.push(`${d.number}: CALC_MISMATCH ${diffs.join(",")}`);
      validateDocRules(d, today);
      validateLinks(d, (x) => plan.docs.get(x));
    } catch (e) {
      problems.push(`${raw.number}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return problems;
}

export interface FixOptions {
  apply?: boolean;
  decisions?: FixDecisions;
  /** User recorded as the editor (the business owner). */
  actorId: string;
  today: string;
  nowIso?: string;
  /** Limit to these Golas. */
  godownIds?: string[];
}

/** Run the repair over every Gola (dry run unless `apply`). */
export async function fixMillDirection(db: Db, opts: FixOptions): Promise<FixReport> {
  const k = cols(db);
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const report: FixReport = { apply: !!opts.apply, at: nowIso, golas: [] };
  const godowns = await k.godowns
    .find(opts.godownIds ? { _id: { $in: opts.godownIds } } : {})
    .toArray();
  for (const g of godowns) {
    const vouchers = (await k.vouchers.find({ godownId: g._id }).toArray()) as unknown as Doc[];
    const parties = await k.parties.find({ godownId: g._id }).toArray();
    const millIds = new Set(
      parties.filter((p) => (p.roles as string[]).includes("MILL")).map((p) => p._id as string),
    );
    const stored = {
      lines: (await k.ledgerLines.find({ godownId: g._id }).toArray()) as unknown as LedgerLineV2[],
      moves: (await k.stockMoves.find({ godownId: g._id }).toArray()) as unknown as StockMoveV2[],
    };
    const before = snapshotOf(stored.lines, stored.moves, millIds);
    let seq = vouchers.filter((v) => v.type === "MILL_SETTLEMENT").length;
    const plan = planGola(
      vouchers.map((v) => {
        const { serverSeq: _s, ...rest } = v as Doc & { serverSeq?: number };
        void _s;
        return rest as Doc;
      }),
      {
        godownId: g._id,
        godownCode: g.code,
        actorId: opts.actorId,
        deviceId: `fix-mill-${nowIso.slice(0, 10)}`,
        today: opts.today,
        nowIso,
        decisions: opts.decisions ?? {},
        nextSettlementSeq: () => ++seq,
      },
    );
    const problems = validateChanged(plan, opts.today);
    const all = [...plan.docs.values()];
    const rebuilt = deriveAll(all);
    const after = snapshotOf(rebuilt.lines, rebuilt.moves, millIds);
    const derivedChanged = !sameRows(stored, rebuilt);
    // The "মিলের খরচ / Mill charges" expense category (v2.1) for Golas created before it existed.
    const needCategory = !(await k.expenseCategories.findOne({
      godownId: g._id,
      code: "MILL_CHARGES",
    }));
    if (needCategory) plan.auto.push("expense category MILL_CHARGES (মিলের খরচ) added");
    const blocked = plan.review.some((r) => r.blocking && !r.decided);
    const result: GolaResult = {
      godownId: g._id,
      name: g.name,
      status: blocked
        ? "blocked"
        : plan.changed.size === 0 && !derivedChanged && !needCategory
          ? "unchanged"
          : "planned",
      auto: plan.auto,
      review: plan.review,
      flips: plan.flips,
      changedDocs: plan.changed.size,
      before,
      after,
      checks: reconcile(before, after, plan.flips),
      problems,
    };
    if (opts.apply && result.status === "planned" && problems.length === 0) {
      await writeGola(db, g._id, all, plan.changed, rebuilt, {
        ...(needCategory
          ? {
              category: {
                businessId: g.businessId as string,
                actorId: opts.actorId,
                nowIso,
              },
            }
          : {}),
        derivedChanged: derivedChanged || plan.changed.size > 0,
      });
      result.status = "applied";
    }
    report.golas.push(result);
  }
  return report;
}

function sameRows(
  a: { lines: LedgerLineV2[]; moves: StockMoveV2[] },
  b: { lines: LedgerLineV2[]; moves: StockMoveV2[] },
): boolean {
  const kl = (l: LedgerLineV2) =>
    `${l._id}|${l.account}|${BigInt(l.debitPaise)}|${BigInt(l.creditPaise)}|${l.date}`;
  const km = (m: StockMoveV2) => `${m._id}|${m.location}|${BigInt(m.qtyG)}|${BigInt(m.valuePaise)}`;
  const x = a.lines.map(kl).sort().join("\n") + a.moves.map(km).sort().join("\n");
  const y = b.lines.map(kl).sort().join("\n") + b.moves.map(km).sort().join("\n");
  return x === y;
}

/** The before/after rules: stock unchanged; cash/bank change only by 2 × each flipped payment. */
export function reconcile(before: Snapshot, after: Snapshot, flips: GolaResult["flips"]): string[] {
  const out: string[] = [];
  const stock = ["warehousePaddyG", "millPaddyG", "riceG", "otherG"] as const;
  for (const k of stock) {
    out.push(
      before[k] === after[k]
        ? `OK ${k} unchanged (${after[k]} g)`
        : `FAIL ${k} ${before[k]} → ${after[k]} g`,
    );
  }
  const expected = new Map<string, bigint>();
  for (const f of flips)
    expected.set(f.account, (expected.get(f.account) ?? 0n) + 2n * f.amountPaise);
  const accounts = new Set([
    "CASH",
    ...Object.keys(before.banks).map((b) => `BANK:${b}`),
    ...Object.keys(after.banks).map((b) => `BANK:${b}`),
  ]);
  for (const a of accounts) {
    const b = a === "CASH" ? before.cashPaise : (before.banks[a.slice(5)] ?? 0n);
    const n = a === "CASH" ? after.cashPaise : (after.banks[a.slice(5)] ?? 0n);
    const want = expected.get(a) ?? 0n;
    out.push(
      n - b === want
        ? `OK ${a} ${b} → ${n} paise (change ${n - b} = 2 × flipped payments)`
        : `FAIL ${a} ${b} → ${n} paise (change ${n - b}, expected ${want})`,
    );
  }
  return out;
}

async function writeGola(
  db: Db,
  godownId: string,
  all: readonly Doc[],
  changed: ReadonlySet<string>,
  rebuilt: { lines: LedgerLineV2[]; moves: StockMoveV2[] },
  extra: {
    category?: { businessId: string; actorId: string; nowIso: string };
    derivedChanged: boolean;
  },
): Promise<void> {
  const k = cols(db);
  const client = await getMongoClient();
  await client.withSession((session: ClientSession) =>
    session.withTransaction(async () => {
      if (extra.category) {
        const id = uuidv7();
        await k.expenseCategories.insertOne(
          {
            _id: id,
            businessId: extra.category.businessId,
            godownId,
            code: "MILL_CHARGES",
            isSystem: true,
            enabled: true,
            rev: 1,
            createdAt: extra.category.nowIso,
            createdBy: extra.category.actorId,
            deviceId: "server",
            updatedAt: extra.category.nowIso,
            updatedBy: extra.category.actorId,
            status: "active",
          } as never,
          { session },
        );
        const [seq] = await logChanges(db, session, [
          { godownId, entity: "expenseCategory", entityId: id, rev: 1 },
        ]);
        await k.expenseCategories.updateOne(
          { _id: id },
          { $set: { serverSeq: seq! } },
          { session },
        );
      }
      if (!extra.derivedChanged) return;
      for (const id of changed) {
        const d = all.find((x) => x._id === id)!;
        await k.vouchers.replaceOne({ _id: id }, d as never, { upsert: true, session });
      }
      await k.ledgerLines.deleteMany({ godownId }, { session });
      await k.stockMoves.deleteMany({ godownId }, { session });
      if (rebuilt.lines.length)
        await k.ledgerLines.insertMany(rebuilt.lines.map(toDbLine), { session });
      if (rebuilt.moves.length)
        await k.stockMoves.insertMany(rebuilt.moves.map(toDbMove), { session });
      // Every voucher of the Gola goes back on the changelog: devices re-download each document
      // with its rebuilt lines / moves (their dailyAgg follows the rows).
      const entries: ChangeEntry[] = all.map((d) => ({
        godownId,
        entity: "voucher",
        entityId: d._id,
        rev: d.rev,
      }));
      for (let i = 0; i < entries.length; i += 1000) {
        const chunk = entries.slice(i, i + 1000);
        const seqs = await logChanges(db, session, chunk);
        for (let j = 0; j < chunk.length; j++) {
          await k.vouchers.updateOne(
            { _id: chunk[j]!.entityId },
            { $set: { serverSeq: seqs[j]! } },
            { session },
          );
        }
      }
    }),
  );
}

// ── Reports ──────────────────────────────────────────────────────────────────────────────────

const rs = (p: bigint) => {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? "−" : ""}₹${(a / 100n).toString()}.${(a % 100n).toString().padStart(2, "0")}`;
};
const qt = (g: bigint) => {
  const neg = g < 0n;
  const a = neg ? -g : g;
  return `${neg ? "−" : ""}${(a / 100_000n).toString()}.${((a % 100_000n) / 100n).toString().padStart(3, "0")} qtl`;
};

/** docs/MILL_FIX_REVIEW.md: everything that needs the owner's decision. */
export function reviewMarkdown(r: FixReport, millNames: ReadonlyMap<string, string>): string {
  const lines: string[] = [
    "# Mill direction fix — items for the owner to confirm",
    "",
    `Generated ${r.at} (${r.apply ? "apply" : "dry run"}). Fill in \`docs/mill-fix-decisions.json\` and run the script again.`,
    "Blocking items keep their Gola completely unchanged until decided.",
    "",
  ];
  const kinds: Array<[ReviewItem["kind"], string, string]> = [
    [
      "PAYMENT_DIRECTION",
      "Payments marked as paid TO a mill",
      '`payments`: `"IN"` (it was money from the mill) or `"REFUND"` (you really paid the mill)',
    ],
    [
      "MILLING_RATE",
      "Dispatches that stored a milling charge, not a price",
      '`rates`: the price per quintal the mill pays, in rupees, e.g. `"2600"`',
    ],
    [
      "RETURN_CREDIT",
      "Paddy returns with an old value",
      '`credits`: the credit in rupees, or `"DEFAULT"` for quantity × dispatch rate',
    ],
    [
      "CONSIGNMENT_SALE",
      "Consignment sales that need a manual settlement",
      "record the final settlement in the app, then void the sale",
    ],
    [
      "MILL_SALE",
      "Sales from paddy lying at a mill (information)",
      "no decision needed; check them",
    ],
  ];
  for (const [kind, title, how] of kinds) {
    const items = r.golas.flatMap((g) =>
      g.review.filter((x) => x.kind === kind).map((x) => ({ g, x })),
    );
    lines.push(`## ${title}`, "", `How to decide: ${how}.`, "");
    if (!items.length) {
      lines.push("None.", "");
      continue;
    }
    lines.push(
      "| Gola | Date | No. | Mill | Amount | Now | Proposed | Blocking | Decision (id) |",
      "|---|---|---|---|---|---|---|---|---|",
    );
    for (const { g, x } of items) {
      lines.push(
        `| ${g.name} | ${x.date} | ${x.number} | ${millNames.get(x.millPartyId ?? "") ?? ""} | ${x.amountPaise !== undefined ? rs(x.amountPaise) : ""} | ${x.current} | ${x.proposed} | ${x.blocking ? "yes" : "no"} | ${x.decided ?? "—"} (\`${x.docId}\`) |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** docs/MILL_FIX_RECONCILIATION.md: before / after per Gola with every check. */
export function reconciliationMarkdown(
  r: FixReport,
  millNames: ReadonlyMap<string, string>,
): string {
  const out: string[] = [
    "# Mill direction fix — reconciliation",
    "",
    `Run ${r.at} (${r.apply ? "APPLY" : "dry run: nothing written"}).`,
    "",
  ];
  for (const g of r.golas) {
    const a = g.after!;
    const b = g.before;
    out.push(`## ${g.name} — ${g.status}`, "");
    out.push("| | Before | After |", "|---|---|---|");
    out.push(`| Cash | ${rs(b.cashPaise)} | ${rs(a.cashPaise)} |`);
    for (const id of new Set([...Object.keys(b.banks), ...Object.keys(a.banks)]))
      out.push(`| Bank ${id} | ${rs(b.banks[id] ?? 0n)} | ${rs(a.banks[id] ?? 0n)} |`);
    for (const id of new Set([...Object.keys(b.mills), ...Object.keys(a.mills)]))
      out.push(
        `| Mill ${millNames.get(id) ?? id} (> 0 = owes us) | ${rs(b.mills[id] ?? 0n)} | ${rs(a.mills[id] ?? 0n)} |`,
      );
    out.push(`| Total receivable | ${rs(b.receivablePaise)} | ${rs(a.receivablePaise)} |`);
    out.push(`| Total payable | ${rs(b.payablePaise)} | ${rs(a.payablePaise)} |`);
    out.push(`| Warehouse paddy | ${qt(b.warehousePaddyG)} | ${qt(a.warehousePaddyG)} |`);
    out.push(`| Paddy at mills | ${qt(b.millPaddyG)} | ${qt(a.millPaddyG)} |`);
    out.push(`| Rice | ${qt(b.riceG)} | ${qt(a.riceG)} |`);
    out.push(`| Other products | ${qt(b.otherG)} | ${qt(a.otherG)} |`, "");
    out.push("Checks:", "", ...g.checks.map((c) => `- ${c}`), "");
    if (g.flips.length)
      out.push(
        "Cash / bank changes (payments flipped OUT → IN, each changes its account by 2 × amount):",
        "",
        ...g.flips.map(
          (f) =>
            `- ${f.paymentId}: ${f.account} +${rs(2n * f.amountPaise)} (${rs(f.amountPaise)} was counted as paid; it was received)`,
        ),
        "",
      );
    if (g.auto.length) out.push("Automatic changes:", "", ...g.auto.map((x) => `- ${x}`), "");
    if (g.problems.length)
      out.push("Problems (nothing written):", "", ...g.problems.map((x) => `- ${x}`), "");
  }
  return out.join("\n");
}

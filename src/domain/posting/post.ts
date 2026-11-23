/**
 * postLedger / postStock (spec §7.2, §7.3): the ONE pure function that turns a voucher into
 * balanced ledger lines and stock moves. Imported by both client and server.
 *
 * Stock valuation is weighted average per (godown, variety) for STORE, and specific cost for
 * direct loads: TRANSIT positions are scoped by the voucher group, so a sale out of TRANSIT
 * takes exactly the cost of the purchase that went into TRANSIT in the same group.
 *
 * Cost of goods depends on the stock position BEFORE this voucher, supplied via `ctx`.
 */
import { DomainError } from "../errors";
import { allocateProportional, divRoundHalfUp, sumBig } from "../rounding";
import type { PayMode, StockLocation } from "../schemas/common";
import type { Voucher } from "../schemas/vouchers";
import {
  ACC,
  bankAccountKey,
  expenseAccountKey,
  partyAccountKey,
  vehicleExpenseKey,
  vehicleIncomeKey,
} from "./accounts";

export interface LineTags {
  partyId?: string;
  varietyId?: string;
  vehicleId?: string;
  loadId?: string;
}

export interface PostedLine extends LineTags {
  account: string;
  debit: bigint;
  credit: bigint;
}

export interface PostedMove {
  location: StockLocation;
  varietyId: string;
  qtyG: bigint;
  valuePaise: bigint;
  /** Set for TRANSIT moves: the group whose specific cost applies. */
  groupId?: string;
}

export interface StockPosition {
  qtyG: bigint;
  valuePaise: bigint;
}

export interface PostingContext {
  /**
   * Stock position of this voucher's godown BEFORE the voucher. For TRANSIT, `groupId` scopes
   * the position to one voucher group (specific cost of a direct load).
   */
  position(varietyId: string, location: StockLocation, groupId?: string): StockPosition;
}

export const EMPTY_CONTEXT: PostingContext = {
  position: () => ({ qtyG: 0n, valuePaise: 0n }),
};

export interface PostingResult {
  lines: PostedLine[];
  moves: PostedMove[];
}

/** Group key used to scope TRANSIT stock. Falls back to the voucher's own id. */
export function transitScope(v: Pick<Voucher, "_id" | "groupId">): string {
  return v.groupId ?? v._id;
}

class Builder {
  lines: PostedLine[] = [];
  moves: PostedMove[] = [];

  /** Debit `dr`, credit `cr` by `amount`. Negative amounts swap sides; zero posts nothing. */
  entry(
    dr: string,
    cr: string,
    amount: bigint,
    tags: LineTags = {},
    crTags: LineTags = tags,
  ): void {
    if (amount === 0n) return;
    if (amount < 0n) {
      this.entry(cr, dr, -amount, crTags, tags);
      return;
    }
    this.lines.push({ account: dr, debit: amount, credit: 0n, ...clean(tags) });
    this.lines.push({ account: cr, debit: 0n, credit: amount, ...clean(crTags) });
  }

  debit(account: string, amount: bigint, tags: LineTags = {}): void {
    if (amount === 0n) return;
    if (amount < 0n) return this.credit(account, -amount, tags);
    this.lines.push({ account, debit: amount, credit: 0n, ...clean(tags) });
  }

  credit(account: string, amount: bigint, tags: LineTags = {}): void {
    if (amount === 0n) return;
    if (amount < 0n) return this.debit(account, -amount, tags);
    this.lines.push({ account, debit: 0n, credit: amount, ...clean(tags) });
  }
}

function clean(tags: LineTags): LineTags {
  const out: LineTags = {};
  if (tags.partyId) out.partyId = tags.partyId;
  if (tags.varietyId) out.varietyId = tags.varietyId;
  if (tags.vehicleId) out.vehicleId = tags.vehicleId;
  if (tags.loadId) out.loadId = tags.loadId;
  return out;
}

/**
 * Money account for a pay mode. Receipts by cheque/DD go to CHEQUE_IN_HAND until cleared.
 * CASH (and OTHER without a bank) → CASH; everything else needs our bank account.
 */
export function moneyAccount(
  mode: PayMode,
  bankAccountId: string | undefined,
  isReceipt = false,
): string {
  if (mode === "CASH") return ACC.CASH;
  if (isReceipt && (mode === "CHEQUE" || mode === "DD")) return ACC.CHEQUE_IN_HAND;
  if (bankAccountId) return bankAccountKey(bankAccountId);
  if (mode === "OTHER") return ACC.CASH;
  throw new DomainError("BANK_ACCOUNT_REQUIRED");
}

/** Tracks positions within one voucher so several lines of the same variety cost correctly. */
class PositionTracker {
  private deltas = new Map<string, StockPosition>();
  constructor(private ctx: PostingContext) {}

  private key(varietyId: string, location: StockLocation, scope?: string) {
    return `${varietyId}|${location}|${location === "TRANSIT" ? (scope ?? "") : ""}`;
  }

  get(varietyId: string, location: StockLocation, scope?: string): StockPosition {
    const base = this.ctx.position(varietyId, location, location === "TRANSIT" ? scope : undefined);
    const d = this.deltas.get(this.key(varietyId, location, scope)) ?? { qtyG: 0n, valuePaise: 0n };
    return { qtyG: base.qtyG + d.qtyG, valuePaise: base.valuePaise + d.valuePaise };
  }

  apply(
    varietyId: string,
    location: StockLocation,
    scope: string | undefined,
    qtyG: bigint,
    valuePaise: bigint,
  ) {
    const k = this.key(varietyId, location, scope);
    const d = this.deltas.get(k) ?? { qtyG: 0n, valuePaise: 0n };
    this.deltas.set(k, { qtyG: d.qtyG + qtyG, valuePaise: d.valuePaise + valuePaise });
  }

  /**
   * Cost of taking `qtyG` out at weighted average. Taking out the whole position takes the
   * whole value exactly (no rounding residue). With no positive stock, cost is 0 (the UI warns
   * before allowing negative stock; integrity check flags it).
   */
  costOut(
    varietyId: string,
    location: StockLocation,
    scope: string | undefined,
    qtyG: bigint,
  ): bigint {
    const pos = this.get(varietyId, location, scope);
    if (pos.qtyG <= 0n) return 0n;
    if (qtyG >= pos.qtyG) {
      // Whole position plus any excess at the same average.
      const excess = qtyG - pos.qtyG;
      return pos.valuePaise + divRoundHalfUp(excess * pos.valuePaise, pos.qtyG);
    }
    return divRoundHalfUp(qtyG * pos.valuePaise, pos.qtyG);
  }
}

/** Post a voucher. Void vouchers post nothing (they are excluded from every total). */
export function post(v: Voucher, ctx: PostingContext = EMPTY_CONTEXT): PostingResult {
  if (v.status === "void") return { lines: [], moves: [] };
  const b = new Builder();
  const pos = new PositionTracker(ctx);
  const scope = transitScope(v);

  const stockIn = (
    location: StockLocation,
    varietyId: string,
    qtyG: bigint,
    valuePaise: bigint,
  ) => {
    const g = location === "TRANSIT" ? scope : undefined;
    b.moves.push({ location, varietyId, qtyG, valuePaise, ...(g ? { groupId: g } : {}) });
    pos.apply(varietyId, location, g, qtyG, valuePaise);
  };
  const stockOut = (location: StockLocation, varietyId: string, qtyG: bigint): bigint => {
    const g = location === "TRANSIT" ? scope : undefined;
    const cost = pos.costOut(varietyId, location, g, qtyG);
    b.moves.push({
      location,
      varietyId,
      qtyG: -qtyG,
      valuePaise: -cost,
      ...(g ? { groupId: g } : {}),
    });
    pos.apply(varietyId, location, g, -qtyG, -cost);
    return cost;
  };

  switch (v.type) {
    case "PURCHASE": {
      const total = BigInt(v.totalPaise);
      const parts = allocateProportional(
        total,
        v.lines.map((l) => BigInt(l.amountPaise)),
      );
      v.lines.forEach((l, i) => {
        const value = parts[i] ?? 0n;
        b.debit(ACC.STOCK, value, { varietyId: l.varietyId, loadId: v.loadId });
        stockIn(v.storeAt, l.varietyId, BigInt(l.netG), value);
      });
      b.credit(partyAccountKey(v.partyId), total, { partyId: v.partyId, loadId: v.loadId });
      break;
    }

    case "SALE": {
      const total = BigInt(v.totalPaise);
      b.debit(partyAccountKey(v.partyId), total, { partyId: v.partyId, loadId: v.loadId });
      const parts = allocateProportional(
        total,
        v.lines.map((l) => BigInt(l.amountPaise)),
      );
      v.lines.forEach((l, i) => {
        b.credit(ACC.SALES, parts[i] ?? 0n, { varietyId: l.varietyId, loadId: v.loadId });
      });
      // Cost of goods sold (perpetual inventory).
      for (const l of v.lines) {
        const cost = stockOut(v.source, l.varietyId, BigInt(l.netG));
        b.entry(ACC.COGS, ACC.STOCK, cost, { varietyId: l.varietyId, loadId: v.loadId });
      }
      // Freight (spec §7.2). Loading/advances are separate linked vouchers.
      const freight = BigInt(v.delivery?.amountPaise ?? "0");
      if (v.delivery && freight > 0n) {
        const t = v.delivery.transporterPartyId;
        const expTags = { vehicleId: v.vehicleId, loadId: v.loadId };
        if (v.delivery.payer === "US") {
          if (!t) throw new DomainError("TRANSPORTER_REQUIRED");
          b.entry(expenseAccountKey("TRANSPORT"), partyAccountKey(t), freight, expTags, {
            partyId: t,
            loadId: v.loadId,
          });
        } else if (v.delivery.payer === "MILL") {
          // Mill pays the driver directly and deducts it from our bill.
          if (t) {
            b.entry(expenseAccountKey("TRANSPORT"), partyAccountKey(t), freight, expTags, {
              partyId: t,
              loadId: v.loadId,
            });
            b.entry(
              partyAccountKey(t),
              partyAccountKey(v.partyId),
              freight,
              { partyId: t, loadId: v.loadId },
              { partyId: v.partyId, loadId: v.loadId },
            );
          } else {
            b.entry(expenseAccountKey("TRANSPORT"), partyAccountKey(v.partyId), freight, expTags, {
              partyId: v.partyId,
              loadId: v.loadId,
            });
          }
        }
        // payer BUYER: the buyer bears freight; nothing in our books.
      }
      break;
    }

    case "LOAD": {
      // OWN_TRADE posts through its linked PURCHASE + SALE. AGENT books commission only.
      if (v.mode === "AGENT" && v.commission) {
        const amount = BigInt(v.commission.amountPaise);
        const payer = v.commission.payer === "MILL" ? v.toMillPartyId : v.fromPartyId;
        if (!payer) throw new DomainError("PARTY_REQUIRED");
        b.entry(
          partyAccountKey(payer),
          ACC.COMMISSION_INCOME,
          amount,
          { partyId: payer, loadId: v._id },
          { loadId: v._id },
        );
      }
      break;
    }

    case "PAYMENT": {
      const amount = BigInt(v.amountPaise);
      b.entry(
        partyAccountKey(v.partyId),
        moneyAccount(v.mode, v.ourBankAccountId),
        amount,
        { partyId: v.partyId },
        {},
      );
      break;
    }

    case "RECEIPT": {
      const amount = BigInt(v.amountPaise);
      const tds = BigInt(v.tdsPaise ?? "0");
      b.debit(moneyAccount(v.mode, v.ourBankAccountId, true), amount);
      b.debit(ACC.TDS_RECEIVABLE, tds, { partyId: v.partyId });
      b.credit(partyAccountKey(v.partyId), amount + tds, { partyId: v.partyId });
      break;
    }

    case "EXPENSE": {
      const amount = BigInt(v.amountPaise);
      const tags = { vehicleId: v.vehicleId, loadId: v.loadId };
      if (v.onCredit) {
        if (!v.payeePartyId) throw new DomainError("PARTY_REQUIRED");
        b.entry(expenseAccountKey(v.categoryCode), partyAccountKey(v.payeePartyId), amount, tags, {
          partyId: v.payeePartyId,
        });
      } else {
        b.entry(
          expenseAccountKey(v.categoryCode),
          moneyAccount(v.mode, v.bankAccountId),
          amount,
          tags,
          {},
        );
      }
      break;
    }

    case "TRIP": {
      const vehicleId = v.vehicleId;
      const freight = BigInt(v.freightPaise);
      if (!v.ownTradeLoadId && freight > 0n) {
        if (!v.hirerPartyId) throw new DomainError("HIRER_REQUIRED");
        b.entry(
          partyAccountKey(v.hirerPartyId),
          vehicleIncomeKey(vehicleId),
          freight,
          { partyId: v.hirerPartyId, vehicleId },
          { vehicleId },
        );
      }
      const advance = BigInt(v.advanceReceivedPaise ?? "0");
      if (advance > 0n) {
        if (!v.hirerPartyId) throw new DomainError("HIRER_REQUIRED");
        b.entry(
          moneyAccount(v.advanceMode ?? "CASH", v.advanceBankAccountId, true),
          partyAccountKey(v.hirerPartyId),
          advance,
          { vehicleId },
          { partyId: v.hirerPartyId, vehicleId },
        );
      }
      for (const e of v.expenses) {
        const tags = { vehicleId, loadId: v.ownTradeLoadId };
        const cr = e.creditPartyId
          ? partyAccountKey(e.creditPartyId)
          : moneyAccount(e.mode, e.bankAccountId);
        b.entry(
          vehicleExpenseKey(vehicleId, e.kind),
          cr,
          BigInt(e.amountPaise),
          tags,
          e.creditPartyId ? { partyId: e.creditPartyId, vehicleId } : {},
        );
      }
      break;
    }

    case "CONTRA": {
      const amount = BigInt(v.amountPaise);
      const bank = v.bankAccountId ? bankAccountKey(v.bankAccountId) : undefined;
      const need = (k: string | undefined): string => {
        if (!k) throw new DomainError("BANK_ACCOUNT_REQUIRED");
        return k;
      };
      switch (v.kind) {
        case "CASH_DEPOSIT":
          b.entry(need(bank), ACC.CASH, amount);
          break;
        case "CASH_WITHDRAWAL":
          b.entry(ACC.CASH, need(bank), amount);
          break;
        case "BANK_TRANSFER":
          b.entry(need(v.toBankAccountId && bankAccountKey(v.toBankAccountId)), need(bank), amount);
          break;
        case "CHEQUE_CLEAR":
          b.entry(need(bank), ACC.CHEQUE_IN_HAND, amount);
          break;
        case "CHEQUE_BOUNCE":
          if (!v.partyId) throw new DomainError("PARTY_REQUIRED");
          b.entry(
            partyAccountKey(v.partyId),
            ACC.CHEQUE_IN_HAND,
            amount,
            { partyId: v.partyId },
            {},
          );
          break;
        case "CAPITAL_IN":
          b.entry(bank ?? ACC.CASH, ACC.CAPITAL, amount);
          break;
        case "DRAWINGS":
          b.entry(ACC.DRAWINGS, bank ?? ACC.CASH, amount);
          break;
      }
      break;
    }

    case "STOCK_ADJUST": {
      for (const l of v.lines) {
        const qty = BigInt(l.qtyG);
        if (qty < 0n) {
          const cost = stockOut("STORE", l.varietyId, -qty);
          b.entry(ACC.STOCK_ADJ, ACC.STOCK, cost, { varietyId: l.varietyId });
        } else {
          const p = pos.get(l.varietyId, "STORE");
          const value = p.qtyG > 0n ? divRoundHalfUp(qty * p.valuePaise, p.qtyG) : 0n;
          stockIn("STORE", l.varietyId, qty, value);
          b.entry(ACC.STOCK, ACC.STOCK_ADJ, value, { varietyId: l.varietyId });
        }
      }
      break;
    }

    case "MILL_SETTLEMENT": {
      const diff = BigInt(v.differencePaise);
      const party = partyAccountKey(v.partyId);
      if (diff < 0n) b.entry(ACC.SALES_DEDUCTION, party, -diff, {}, { partyId: v.partyId });
      else if (diff > 0n) b.entry(party, ACC.SALES, diff, { partyId: v.partyId }, {});
      break;
    }

    case "DAY_CLOSE": {
      const diff = BigInt(v.differencePaise);
      // Shortage (diff < 0): Dr CASH_DIFF / Cr CASH. Excess: reverse.
      b.entry(ACC.CASH, ACC.CASH_DIFF, diff);
      break;
    }

    case "OPENING": {
      let net = 0n;
      for (const it of v.items) {
        const amount = BigInt(it.amountPaise);
        let account: string;
        const tags: LineTags = {};
        switch (it.kind) {
          case "CASH":
            account = ACC.CASH;
            break;
          case "BANK":
            if (!it.refId) throw new DomainError("INVALID_REFERENCE");
            account = bankAccountKey(it.refId);
            break;
          case "PARTY":
            if (!it.refId) throw new DomainError("INVALID_REFERENCE");
            account = partyAccountKey(it.refId);
            tags.partyId = it.refId;
            break;
          case "STOCK":
            if (!it.varietyId) throw new DomainError("INVALID_REFERENCE");
            account = ACC.STOCK;
            tags.varietyId = it.varietyId;
            stockIn("STORE", it.varietyId, BigInt(it.qtyG ?? "0"), amount);
            break;
          case "CAPITAL":
            account = ACC.CAPITAL;
            break;
        }
        b.debit(account, amount, tags);
        net += amount;
      }
      b.credit(ACC.OPENING_BAL, net);
      break;
    }

    case "JOURNAL": {
      const dr = sumBig(v.lines.map((l) => BigInt(l.debitPaise)));
      const cr = sumBig(v.lines.map((l) => BigInt(l.creditPaise)));
      if (dr !== cr) throw new DomainError("JOURNAL_UNBALANCED");
      for (const l of v.lines) {
        const tags = { partyId: l.partyId };
        b.debit(l.account, BigInt(l.debitPaise), tags);
        b.credit(l.account, BigInt(l.creditPaise), tags);
      }
      break;
    }
  }

  return { lines: b.lines, moves: b.moves };
}

export function postLedger(v: Voucher, ctx: PostingContext = EMPTY_CONTEXT): PostedLine[] {
  return post(v, ctx).lines;
}

export function postStock(v: Voucher, ctx: PostingContext = EMPTY_CONTEXT): PostedMove[] {
  return post(v, ctx).moves;
}

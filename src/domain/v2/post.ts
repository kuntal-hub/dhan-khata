/**
 * v2 postLedger / postStock (requirement_v2 §8, §9.2): the one pure function that turns a
 * document into balanced ledger lines and stock moves. Shared by client and server.
 *
 * Stock is valued at weighted average per position key (product, location, variety, other
 * product name, mill, transit group). TRANSIT positions are scoped by the document group, so a
 * direct-delivery sale takes exactly the cost of the purchase in its group.
 * Cost depends on the position BEFORE the document, supplied by `ctx`.
 */
import { DomainError } from "../errors";
import { allocateProportional, divRoundHalfUp, sumBig } from "../rounding";
import {
  ACC2,
  bankKey,
  expenseKey,
  partyKey,
  stockAccount,
  stockAtMillKey,
  vehExpenseKey,
  vehIncomeKey,
} from "./accounts";
import type { Doc, Location, PayMode, Product } from "./schemas";
import { bagCountOf } from "./weightBlock";

export interface LineTagsV2 {
  partyId?: string;
  varietyId?: string;
  vehicleId?: string;
}

export interface PostedLineV2 extends LineTagsV2 {
  account: string;
  debit: bigint;
  credit: bigint;
}

/** Identifies one stock position. */
export interface StockKeyV2 {
  product: Product;
  location: Location;
  varietyId?: string;
  otherProductName?: string;
  millPartyId?: string;
  /** TRANSIT only. */
  groupId?: string;
}

export interface PostedMoveV2 extends StockKeyV2 {
  qtyG: bigint;
  valuePaise: bigint;
  bags?: number;
}

export interface StockPosition {
  qtyG: bigint;
  valuePaise: bigint;
}

export interface PostingContextV2 {
  /** Position of this document's Gola BEFORE the document. */
  position(key: StockKeyV2): StockPosition;
}

export const EMPTY_CONTEXT_V2: PostingContextV2 = {
  position: () => ({ qtyG: 0n, valuePaise: 0n }),
};

export interface PostingResultV2 {
  lines: PostedLineV2[];
  moves: PostedMoveV2[];
}

/** Canonical string of a position key (only the fields that matter for its location). */
export function stockKeyId(k: StockKeyV2): string {
  return [
    k.product,
    k.location,
    k.varietyId ?? "",
    k.product === "OTHER" ? (k.otherProductName ?? "") : "",
    k.location === "MILL" ? (k.millPartyId ?? "") : "",
    k.location === "TRANSIT" ? (k.groupId ?? "") : "",
  ].join("|");
}

export function normalizeKey(k: StockKeyV2): StockKeyV2 {
  const out: StockKeyV2 = { product: k.product, location: k.location };
  if (k.varietyId) out.varietyId = k.varietyId;
  if (k.product === "OTHER" && k.otherProductName) out.otherProductName = k.otherProductName;
  if (k.location === "MILL" && k.millPartyId) out.millPartyId = k.millPartyId;
  if (k.location === "TRANSIT" && k.groupId) out.groupId = k.groupId;
  return out;
}

/** Money account for a payment mode. BANK and UPI need our bank account. */
export function moneyAccountV2(mode: PayMode, bankAccountId: string | undefined): string {
  if (mode === "CASH") return ACC2.CASH;
  if (!bankAccountId) throw new DomainError("BANK_ACCOUNT_REQUIRED");
  return bankKey(bankAccountId);
}

/** TRANSIT scope of a document (its group, or itself). */
export function transitScopeV2(d: Pick<Doc, "_id" | "groupId">): string {
  return d.groupId ?? d._id;
}

class Builder {
  lines: PostedLineV2[] = [];
  moves: PostedMoveV2[] = [];
  private deltas = new Map<string, StockPosition>();
  constructor(private ctx: PostingContextV2) {}

  /** Debit `dr`, credit `cr`. Negative amounts swap sides; zero posts nothing. */
  entry(
    dr: string,
    cr: string,
    amount: bigint,
    drTags: LineTagsV2 = {},
    crTags: LineTagsV2 = drTags,
  ): void {
    if (amount === 0n) return;
    if (amount < 0n) return this.entry(cr, dr, -amount, crTags, drTags);
    this.lines.push({ account: dr, debit: amount, credit: 0n, ...clean(drTags) });
    this.lines.push({ account: cr, debit: 0n, credit: amount, ...clean(crTags) });
  }

  debit(account: string, amount: bigint, tags: LineTagsV2 = {}): void {
    if (amount === 0n) return;
    if (amount < 0n) return this.credit(account, -amount, tags);
    this.lines.push({ account, debit: amount, credit: 0n, ...clean(tags) });
  }

  credit(account: string, amount: bigint, tags: LineTagsV2 = {}): void {
    if (amount === 0n) return;
    if (amount < 0n) return this.debit(account, -amount, tags);
    this.lines.push({ account, debit: 0n, credit: amount, ...clean(tags) });
  }

  position(k: StockKeyV2): StockPosition {
    const base = this.ctx.position(normalizeKey(k));
    const d = this.deltas.get(stockKeyId(k)) ?? { qtyG: 0n, valuePaise: 0n };
    return { qtyG: base.qtyG + d.qtyG, valuePaise: base.valuePaise + d.valuePaise };
  }

  private track(k: StockKeyV2, qtyG: bigint, valuePaise: bigint) {
    const id = stockKeyId(k);
    const d = this.deltas.get(id) ?? { qtyG: 0n, valuePaise: 0n };
    this.deltas.set(id, { qtyG: d.qtyG + qtyG, valuePaise: d.valuePaise + valuePaise });
  }

  stockIn(k: StockKeyV2, qtyG: bigint, valuePaise: bigint, bags?: number) {
    this.moves.push({ ...normalizeKey(k), qtyG, valuePaise, ...(bags ? { bags } : {}) });
    this.track(k, qtyG, valuePaise);
  }

  /**
   * Take `qtyG` out at weighted average cost and return the cost. Taking the whole position
   * takes its whole value (no rounding residue). With no positive stock the cost is 0
   * (the UI warns before negative stock; the integrity check flags it).
   */
  stockOut(k: StockKeyV2, qtyG: bigint, bags?: number): bigint {
    const pos = this.position(k);
    let cost = 0n;
    if (pos.qtyG > 0n) {
      cost =
        qtyG >= pos.qtyG
          ? pos.valuePaise + divRoundHalfUp((qtyG - pos.qtyG) * pos.valuePaise, pos.qtyG)
          : divRoundHalfUp(qtyG * pos.valuePaise, pos.qtyG);
    }
    this.moves.push({
      ...normalizeKey(k),
      qtyG: -qtyG,
      valuePaise: -cost,
      ...(bags ? { bags: -bags } : {}),
    });
    this.track(k, -qtyG, -cost);
    return cost;
  }

  /** Average-cost value of `qtyG` at a position (0 if the position is empty). */
  valueAt(k: StockKeyV2, qtyG: bigint): bigint {
    const p = this.position(k);
    return p.qtyG > 0n ? divRoundHalfUp(qtyG * p.valuePaise, p.qtyG) : 0n;
  }
}

function clean(t: LineTagsV2): LineTagsV2 {
  const out: LineTagsV2 = {};
  if (t.partyId) out.partyId = t.partyId;
  if (t.varietyId) out.varietyId = t.varietyId;
  if (t.vehicleId) out.vehicleId = t.vehicleId;
  return out;
}

const keyAccount = (k: StockKeyV2) =>
  stockAccount(k.product, k.location, k.millPartyId, k.otherProductName);

/** Post a document. Void documents post nothing (they are excluded from every total). */
export function postDoc(d: Doc, ctx: PostingContextV2 = EMPTY_CONTEXT_V2): PostingResultV2 {
  if (d.status === "void") return { lines: [], moves: [] };
  const b = new Builder(ctx);
  const transit = transitScopeV2(d);

  switch (d.type) {
    case "PURCHASE": {
      const total = BigInt(d.totalPaise);
      const k: StockKeyV2 = {
        product: "PADDY",
        location: d.storeAt,
        varietyId: d.varietyId,
        ...(d.storeAt === "TRANSIT" ? { groupId: transit } : {}),
      };
      b.stockIn(k, BigInt(d.weight.netG), total, bagCountOf(d.weight));
      b.entry(
        keyAccount(k),
        partyKey(d.partyId),
        total,
        { varietyId: d.varietyId },
        { partyId: d.partyId },
      );
      break;
    }

    case "SALE": {
      if (d.saleStatus !== "CONFIRMED") break; // ORDER: no effect (DECISIONS D3)
      const total = BigInt(d.totalPaise);
      b.entry(
        partyKey(d.partyId),
        ACC2.SALES,
        total,
        { partyId: d.partyId },
        { varietyId: d.varietyId },
      );
      if (d.source === "MILL" && !d.sourceMillId) throw new DomainError("MILL_REQUIRED");
      if (d.source === "MILL" && d.product !== "PADDY") throw new DomainError("VALIDATION_FAILED");
      const k: StockKeyV2 = {
        product: d.product,
        location: d.product === "RICE" ? "WAREHOUSE" : d.source,
        varietyId: d.varietyId,
        ...(d.source === "MILL" ? { millPartyId: d.sourceMillId } : {}),
        ...(d.source === "TRANSIT" ? { groupId: transit } : {}),
      };
      const cost = b.stockOut(k, BigInt(d.weight.netG), bagCountOf(d.weight));
      b.entry(ACC2.COGS, keyAccount(k), cost, { varietyId: d.varietyId });
      break;
    }

    case "PAYMENT": {
      const amount = BigInt(d.amountPaise);
      const money = moneyAccountV2(d.mode, d.bankAccountId);
      let counter: string;
      let tags: LineTagsV2 = {};
      if (d.partyId) {
        counter = partyKey(d.partyId);
        tags = { partyId: d.partyId };
      } else if (d.source.type === "EXPENSE" || d.source.type === "VEHICLE_COST") {
        counter = ACC2.EXP_PAYABLE;
      } else {
        throw new DomainError("PARTY_REQUIRED");
      }
      if (d.direction === "OUT") b.entry(counter, money, amount, tags, {});
      else b.entry(money, counter, amount, {}, tags);
      break;
    }

    case "EXPENSE": {
      const amount = BigInt(d.amountPaise);
      const cr = d.partyId ? partyKey(d.partyId) : ACC2.EXP_PAYABLE;
      b.entry(
        expenseKey(d.categoryCode),
        cr,
        amount,
        { vehicleId: d.vehicleId },
        d.partyId ? { partyId: d.partyId } : {},
      );
      break;
    }

    case "LOAD":
      // A register entry: stock and money move only through its linked sale/dispatch (§12.5).
      break;

    case "MILL_DISPATCH": {
      const qty = BigInt(d.weight.netG);
      const bags = bagCountOf(d.weight);
      const from: StockKeyV2 = { product: "PADDY", location: "WAREHOUSE", varietyId: d.varietyId };
      const to: StockKeyV2 = {
        product: "PADDY",
        location: "MILL",
        varietyId: d.varietyId,
        millPartyId: d.millPartyId,
      };
      const cost = b.stockOut(from, qty, bags);
      b.stockIn(to, qty, cost, bags);
      b.entry(stockAtMillKey(d.millPartyId), ACC2.STOCK_PADDY, cost, { varietyId: d.varietyId });
      if (d.dispatchType === "MILLING") {
        b.entry(
          ACC2.MILLING_CHARGES,
          partyKey(d.millPartyId),
          BigInt(d.totalValuePaise),
          {},
          {
            partyId: d.millPartyId,
          },
        );
      }
      break;
    }

    case "MILL_RETURN": {
      const qty = BigInt(d.weight.netG);
      const bags = bagCountOf(d.weight);
      if (d.product === "PADDY") {
        if (!d.varietyId) throw new DomainError("INVALID_REFERENCE");
        const from: StockKeyV2 = {
          product: "PADDY",
          location: "MILL",
          varietyId: d.varietyId,
          millPartyId: d.millPartyId,
        };
        const cost = b.stockOut(from, qty, bags);
        b.stockIn(
          { product: "PADDY", location: "WAREHOUSE", varietyId: d.varietyId },
          qty,
          cost,
          bags,
        );
        b.entry(ACC2.STOCK_PADDY, stockAtMillKey(d.millPartyId), cost, { varietyId: d.varietyId });
      } else {
        if (d.product === "OTHER" && !d.otherProductName)
          throw new DomainError("VALIDATION_FAILED");
        // Quantity only; value arrives with the milling conversion (DECISIONS D6).
        b.stockIn(
          {
            product: d.product,
            location: "WAREHOUSE",
            ...(d.varietyId ? { varietyId: d.varietyId } : {}),
            ...(d.product === "OTHER" ? { otherProductName: d.otherProductName } : {}),
          },
          qty,
          0n,
          bags,
        );
      }
      break;
    }

    case "CONVERSION": {
      const consumed = BigInt(d.paddyConsumedG);
      const from: StockKeyV2 = {
        product: "PADDY",
        location: "MILL",
        varietyId: d.varietyId,
        millPartyId: d.millPartyId,
      };
      const cost = b.stockOut(from, consumed);
      const outKeys: StockKeyV2[] = d.outputs.map((o) => ({
        product: o.product,
        location: "WAREHOUSE",
        ...(o.varietyId ? { varietyId: o.varietyId } : {}),
        ...(o.product === "OTHER" ? { otherProductName: o.name ?? "" } : {}),
      }));
      let values: bigint[];
      if (d.outputs.length > 0 && d.outputs.every((o) => o.valuePaise !== undefined)) {
        values = d.outputs.map((o) => BigInt(o.valuePaise ?? "0"));
      } else {
        const loss = BigInt(d.lossG);
        const weights = [...d.outputs.map((o) => BigInt(o.qtyG)), loss > 0n ? loss : 0n];
        values = allocateProportional(cost, weights).slice(0, d.outputs.length);
      }
      d.outputs.forEach((o, i) => {
        const k = outKeys[i]!;
        const v = values[i] ?? 0n;
        b.stockIn(k, 0n, v);
        b.debit(keyAccount(k), v, { varietyId: o.varietyId });
      });
      b.debit(ACC2.MILLING_LOSS, cost - sumBig(values));
      b.credit(stockAtMillKey(d.millPartyId), cost, { varietyId: d.varietyId });
      break;
    }

    case "TRIP": {
      const income = BigInt(d.totalIncomePaise);
      b.entry(
        partyKey(d.customerPartyId),
        vehIncomeKey(d.vehicleId),
        income,
        { partyId: d.customerPartyId, vehicleId: d.vehicleId },
        { vehicleId: d.vehicleId },
      );
      for (const c of d.costs) {
        b.entry(
          vehExpenseKey(d.vehicleId, c.kind),
          c.partyId ? partyKey(c.partyId) : ACC2.EXP_PAYABLE,
          BigInt(c.amountPaise),
          { vehicleId: d.vehicleId },
          c.partyId ? { partyId: c.partyId, vehicleId: d.vehicleId } : { vehicleId: d.vehicleId },
        );
      }
      break;
    }

    case "SECOND_PARTY": {
      const amount = BigInt(d.amountPaise);
      const tags = { partyId: d.partyId };
      if (d.kind === "WE_OWE") b.entry(ACC2.SP_CLEARING, partyKey(d.partyId), amount, {}, tags);
      else b.entry(partyKey(d.partyId), ACC2.SP_CLEARING, amount, tags, {});
      break;
    }

    case "STOCK_ADJUST": {
      for (const l of d.lines) {
        const k: StockKeyV2 = {
          product: l.product,
          location: l.location,
          ...(l.varietyId ? { varietyId: l.varietyId } : {}),
          ...(l.otherProductName ? { otherProductName: l.otherProductName } : {}),
          ...(l.millPartyId ? { millPartyId: l.millPartyId } : {}),
        };
        if (l.location === "MILL" && !l.millPartyId) throw new DomainError("MILL_REQUIRED");
        const qty = BigInt(l.qtyG);
        if (qty < 0n) {
          const cost = b.stockOut(k, -qty, l.bags !== undefined ? Math.abs(l.bags) : undefined);
          b.entry(ACC2.STOCK_ADJ, keyAccount(k), cost, { varietyId: l.varietyId });
        } else {
          const value = b.valueAt(k, qty);
          b.stockIn(k, qty, value, l.bags !== undefined ? Math.abs(l.bags) : undefined);
          b.entry(keyAccount(k), ACC2.STOCK_ADJ, value, { varietyId: l.varietyId });
        }
      }
      break;
    }

    case "CONTRA": {
      const amount = BigInt(d.amountPaise);
      const bank = d.bankAccountId ? bankKey(d.bankAccountId) : undefined;
      const need = (k: string | undefined) => {
        if (!k) throw new DomainError("BANK_ACCOUNT_REQUIRED");
        return k;
      };
      switch (d.kind) {
        case "DEPOSIT":
          b.entry(need(bank), ACC2.CASH, amount);
          break;
        case "WITHDRAW":
          b.entry(ACC2.CASH, need(bank), amount);
          break;
        case "TRANSFER":
          if (d.toBankAccountId === d.bankAccountId) throw new DomainError("VALIDATION_FAILED");
          b.entry(need(d.toBankAccountId && bankKey(d.toBankAccountId)), need(bank), amount);
          break;
        case "CAPITAL_IN":
          b.entry(bank ?? ACC2.CASH, ACC2.CAPITAL, amount);
          break;
        case "DRAWINGS":
          b.entry(ACC2.DRAWINGS, bank ?? ACC2.CASH, amount);
          break;
      }
      break;
    }

    case "DAY_CLOSE":
      // Shortage (diff < 0): Dr CASH_DIFF / Cr CASH; excess: the reverse.
      b.entry(ACC2.CASH, ACC2.CASH_DIFF, BigInt(d.diffPaise));
      break;

    case "OPENING": {
      let net = 0n;
      for (const it of d.items) {
        const amount = BigInt(it.amountPaise);
        let account: string;
        const tags: LineTagsV2 = {};
        switch (it.kind) {
          case "CASH":
            account = ACC2.CASH;
            break;
          case "BANK":
            if (!it.refId) throw new DomainError("INVALID_REFERENCE");
            account = bankKey(it.refId);
            break;
          case "PARTY":
            if (!it.refId) throw new DomainError("INVALID_REFERENCE");
            account = partyKey(it.refId);
            tags.partyId = it.refId;
            break;
          case "STOCK": {
            if (!it.product) throw new DomainError("INVALID_REFERENCE");
            const k: StockKeyV2 = {
              product: it.product,
              location: it.location ?? "WAREHOUSE",
              ...(it.varietyId ? { varietyId: it.varietyId } : {}),
              ...(it.otherProductName ? { otherProductName: it.otherProductName } : {}),
              ...(it.millPartyId ? { millPartyId: it.millPartyId } : {}),
            };
            if (k.location === "MILL" && !k.millPartyId) throw new DomainError("MILL_REQUIRED");
            account = keyAccount(k);
            if (it.varietyId) tags.varietyId = it.varietyId;
            b.stockIn(k, BigInt(it.qtyG ?? "0"), amount);
            break;
          }
          case "CAPITAL":
            account = ACC2.CAPITAL;
            break;
        }
        b.debit(account, amount, tags);
        net += amount;
      }
      b.credit(ACC2.OPENING_BAL, net);
      break;
    }
  }

  return { lines: b.lines, moves: b.moves };
}

export const postLedgerV2 = (d: Doc, ctx?: PostingContextV2) => postDoc(d, ctx).lines;
export const postStockV2 = (d: Doc, ctx?: PostingContextV2) => postDoc(d, ctx).moves;

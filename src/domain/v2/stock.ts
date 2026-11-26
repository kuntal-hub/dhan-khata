/**
 * Stock engine queries (requirement_v2 §9, §12.1C) over derived stock moves.
 * Paddy, rice and other products are separate figures and are never added together.
 *
 *   Closing paddy = Opening + Purchases + Returned paddy − Confirmed sales − Mill dispatches ± Adjustments
 *   Closing mill  = Opening mill + Dispatches − Returns − Consumed in milling − Final settlements ± Adjustments
 */
import { sumBig } from "../rounding";
import type { Doc, DocOf, Location, Product, StockMoveV2 } from "./schemas";

export interface StockFilter {
  product: Product;
  location?: Location;
  varietyId?: string;
  millPartyId?: string;
  otherProductName?: string;
}

export function matches(m: StockMoveV2, f: StockFilter): boolean {
  if (m.product !== f.product) return false;
  if (f.location && m.location !== f.location) return false;
  if (f.varietyId && m.varietyId !== f.varietyId) return false;
  if (f.millPartyId && m.millPartyId !== f.millPartyId) return false;
  if (f.otherProductName && m.otherProductName !== f.otherProductName) return false;
  return true;
}

/** Quantity (g) of a position at the end of `upTo` (inclusive; all dates when omitted). */
export function qtyAt(moves: readonly StockMoveV2[], f: StockFilter, upTo?: string): bigint {
  return sumBig(
    moves.filter((m) => matches(m, f) && (!upTo || m.date <= upTo)).map((m) => BigInt(m.qtyG)),
  );
}

export function valueAt(moves: readonly StockMoveV2[], f: StockFilter, upTo?: string): bigint {
  return sumBig(
    moves
      .filter((m) => matches(m, f) && (!upTo || m.date <= upTo))
      .map((m) => BigInt(m.valuePaise)),
  );
}

const sumQty = (list: readonly StockMoveV2[]) => sumBig(list.map((m) => BigInt(m.qtyG)));
const abs = (v: bigint) => (v < 0n ? -v : v);

export interface PaddyDay {
  openingG: bigint;
  purchaseG: bigint;
  returnedFromMillG: bigint;
  salesG: bigint;
  dispatchG: bigint;
  /** Signed: approved adjustments + opening-stock entries made on this day. */
  adjustmentsG: bigint;
  closingG: bigint;
}

/** Warehouse paddy for one day (optionally one variety); §12.1C lines. */
export function paddyDay(
  moves: readonly StockMoveV2[],
  date: string,
  varietyId?: string,
): PaddyDay {
  const f: StockFilter = {
    product: "PADDY",
    location: "WAREHOUSE",
    ...(varietyId ? { varietyId } : {}),
  };
  const rel = moves.filter((m) => matches(m, f));
  const opening = sumQty(rel.filter((m) => m.date < date));
  const day = rel.filter((m) => m.date === date);
  const by = (t: StockMoveV2["voucherType"]) => day.filter((m) => m.voucherType === t);
  const purchase = sumQty(by("PURCHASE"));
  const returned = sumQty(by("MILL_RETURN"));
  const sales = abs(sumQty(by("SALE")));
  const dispatch = abs(sumQty(by("MILL_DISPATCH")));
  const adjustments = sumQty([...by("STOCK_ADJUST"), ...by("OPENING")]);
  return {
    openingG: opening,
    purchaseG: purchase,
    returnedFromMillG: returned,
    salesG: sales,
    dispatchG: dispatch,
    adjustmentsG: adjustments,
    closingG: opening + purchase + returned - sales - dispatch + adjustments,
  };
}

export interface MillDay {
  openingG: bigint;
  dispatchedG: bigint;
  returnedG: bigint;
  consumedG: bigint;
  settledG: bigint;
  adjustmentsG: bigint;
  closingG: bigint;
}

/** Paddy at mills for one day (one mill or all). */
export function millDay(
  moves: readonly StockMoveV2[],
  date: string,
  millPartyId?: string,
): MillDay {
  const f: StockFilter = {
    product: "PADDY",
    location: "MILL",
    ...(millPartyId ? { millPartyId } : {}),
  };
  const rel = moves.filter((m) => matches(m, f));
  const opening = sumQty(rel.filter((m) => m.date < date));
  const day = rel.filter((m) => m.date === date);
  const by = (t: StockMoveV2["voucherType"]) => day.filter((m) => m.voucherType === t);
  const dispatched = sumQty(by("MILL_DISPATCH"));
  const returned = abs(sumQty(by("MILL_RETURN")));
  const consumed = abs(sumQty(by("CONVERSION")));
  // Final settlements (accepted + shortfall); legacy consignment sales took mill stock too.
  const settled = abs(sumQty([...by("MILL_SETTLEMENT"), ...by("SALE")]));
  const adjustments = sumQty([...by("STOCK_ADJUST"), ...by("OPENING")]);
  return {
    openingG: opening,
    dispatchedG: dispatched,
    returnedG: returned,
    consumedG: consumed,
    settledG: settled,
    adjustmentsG: adjustments,
    closingG: opening + dispatched - returned - consumed - settled + adjustments,
  };
}

export interface RiceDay {
  openingG: bigint;
  returnedFromMillG: bigint;
  salesG: bigint;
  adjustmentsG: bigint;
  closingG: bigint;
}

/** Rice (or one other product) in the warehouse for one day. */
export function productDay(
  moves: readonly StockMoveV2[],
  date: string,
  product: "RICE" | "OTHER",
  otherProductName?: string,
): RiceDay {
  const f: StockFilter = {
    product,
    location: "WAREHOUSE",
    ...(otherProductName ? { otherProductName } : {}),
  };
  const rel = moves.filter((m) => matches(m, f));
  const opening = sumQty(rel.filter((m) => m.date < date));
  const day = rel.filter((m) => m.date === date);
  const by = (t: StockMoveV2["voucherType"]) => day.filter((m) => m.voucherType === t);
  const returned = sumQty(by("MILL_RETURN"));
  const sales = abs(sumQty(by("SALE")));
  const adjustments = sumQty([...by("STOCK_ADJUST"), ...by("OPENING")]);
  return {
    openingG: opening,
    returnedFromMillG: returned,
    salesG: sales,
    adjustmentsG: adjustments,
    closingG: opening + returned - sales + adjustments,
  };
}

/** Warn-before-save check (§9.3): would taking `outG` from `availableG` go below zero? */
export function wouldGoNegative(availableG: bigint, outG: bigint): boolean {
  return outG > availableG;
}

export interface DispatchBalance {
  sentG: bigint;
  returnedPaddyG: bigint;
  consumedG: bigint;
  /** Accepted by the mill in the final settlement (+ legacy consignment sales). */
  acceptedG: bigint;
  /** Weight the mill did not account for (final settlement, reasoned loss). */
  shortfallG: bigint;
  /** Paddy of this dispatch still at the mill. */
  remainingG: bigint;
}

/**
 * Dispatch-wise history (§12.8B): sent, returned, consumed, accepted, shortfall, still at mill.
 * `docs` = the dispatch's returns, conversions and settlement (any status; void ones ignored).
 */
export function dispatchBalance(
  dispatch: DocOf<"MILL_DISPATCH">,
  docs: readonly Doc[],
): DispatchBalance {
  const active = docs.filter((d) => d.status === "active");
  const sent = dispatch.status === "active" ? BigInt(dispatch.weight.netG) : 0n;
  const returnedPaddy = sumBig(
    active
      .filter(
        (d): d is DocOf<"MILL_RETURN"> => d.type === "MILL_RETURN" && d.dispatchId === dispatch._id,
      )
      .filter((d) => d.product === "PADDY")
      .map((d) => BigInt(d.weight.netG)),
  );
  const consumed = sumBig(
    active
      .filter(
        (d): d is DocOf<"CONVERSION"> => d.type === "CONVERSION" && d.dispatchId === dispatch._id,
      )
      .map((d) => BigInt(d.paddyConsumedG)),
  );
  const settlements = active.filter(
    (d): d is DocOf<"MILL_SETTLEMENT"> =>
      d.type === "MILL_SETTLEMENT" && d.dispatchId === dispatch._id,
  );
  const legacySales = sumBig(
    active
      .filter(
        (d): d is DocOf<"SALE"> =>
          d.type === "SALE" &&
          d.consignmentDispatchId === dispatch._id &&
          d.saleStatus === "CONFIRMED",
      )
      .map((d) => BigInt(d.weight.netG)),
  );
  const accepted = sumBig(settlements.map((s) => BigInt(s.acceptedG))) + legacySales;
  const shortfall = sumBig(settlements.map((s) => BigInt(s.shortfallG)));
  return {
    sentG: sent,
    returnedPaddyG: returnedPaddy,
    consumedG: consumed,
    acceptedG: accepted,
    shortfallG: shortfall,
    remainingG: sent - returnedPaddy - consumed - accepted - shortfall,
  };
}

/**
 * Replaying vouchers in order rebuilds every ledger line and stock move from scratch.
 * Used for: integrity checks (re-run postLedger/postStock and compare), rebuilding local derived
 * tables, and property tests. Ordering = (date, createdAt, _id) — the same on every device.
 */
import type { LedgerLine, StockMove } from "../schemas/system";
import type { Voucher } from "../schemas/vouchers";
import type { StockLocation } from "../schemas/common";
import {
  post,
  transitScope,
  type PostedLine,
  type PostedMove,
  type PostingContext,
  type StockPosition,
} from "./post";

export function voucherOrder(a: Voucher, b: Voucher): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

function posKey(
  godownId: string,
  varietyId: string,
  location: StockLocation,
  scope?: string,
): string {
  return `${godownId}|${varietyId}|${location}|${location === "TRANSIT" ? (scope ?? "") : ""}`;
}

/** Mutable stock-position book keyed by (godown, variety, location, transit scope). */
export class StockBook {
  private map = new Map<string, StockPosition>();

  contextFor(godownId: string): PostingContext {
    return {
      position: (varietyId, location, groupId) =>
        this.map.get(posKey(godownId, varietyId, location, groupId)) ?? {
          qtyG: 0n,
          valuePaise: 0n,
        },
    };
  }

  apply(godownId: string, moves: readonly PostedMove[]): void {
    for (const m of moves) {
      const k = posKey(godownId, m.varietyId, m.location, m.groupId);
      const p = this.map.get(k) ?? { qtyG: 0n, valuePaise: 0n };
      this.map.set(k, { qtyG: p.qtyG + m.qtyG, valuePaise: p.valuePaise + m.valuePaise });
    }
  }

  /** Total of a (godown, variety, location) across all transit scopes. */
  total(godownId: string, varietyId: string, location: StockLocation): StockPosition {
    let qtyG = 0n;
    let valuePaise = 0n;
    const prefix = `${godownId}|${varietyId}|${location}|`;
    for (const [k, p] of this.map) {
      if (k.startsWith(prefix)) {
        qtyG += p.qtyG;
        valuePaise += p.valuePaise;
      }
    }
    return { qtyG, valuePaise };
  }
}

export interface ReplayedVoucher {
  voucher: Voucher;
  lines: PostedLine[];
  moves: PostedMove[];
}

/** Post all vouchers in canonical order, threading the stock position through. */
export function replay(vouchers: readonly Voucher[]): {
  results: ReplayedVoucher[];
  book: StockBook;
} {
  const book = new StockBook();
  const results: ReplayedVoucher[] = [];
  for (const v of [...vouchers].sort(voucherOrder)) {
    const { lines, moves } = post(v, book.contextFor(v.godownId));
    book.apply(v.godownId, moves);
    results.push({ voucher: v, lines, moves });
  }
  return { results, book };
}

/** Serialize posted lines into stored LedgerLine docs (deterministic ids per voucher revision). */
export function toLedgerLineDocs(v: Voucher, lines: readonly PostedLine[]): LedgerLine[] {
  return lines.map((l, i) => ({
    _id: `${v._id}:${v.rev}:L${i}`,
    godownId: v.godownId,
    voucherId: v._id,
    voucherRev: v.rev,
    voucherType: v.type,
    date: v.date,
    account: l.account,
    debitPaise: l.debit.toString(),
    creditPaise: l.credit.toString(),
    ...(l.partyId ? { partyId: l.partyId } : {}),
    ...(l.varietyId ? { varietyId: l.varietyId } : {}),
    ...(l.vehicleId ? { vehicleId: l.vehicleId } : {}),
    ...(l.loadId ? { loadId: l.loadId } : {}),
    ...(v.season ? { season: v.season } : {}),
    fy: v.fy,
  }));
}

export function toStockMoveDocs(v: Voucher, moves: readonly PostedMove[]): StockMove[] {
  return moves.map((m, i) => ({
    _id: `${v._id}:${v.rev}:S${i}`,
    godownId: v.godownId,
    location: m.location,
    voucherId: v._id,
    voucherRev: v.rev,
    date: v.date,
    varietyId: m.varietyId,
    qtyG: m.qtyG.toString(),
    valuePaise: m.valuePaise.toString(),
    ...(m.groupId ? { groupId: m.groupId } : {}),
  }));
}

export { transitScope };

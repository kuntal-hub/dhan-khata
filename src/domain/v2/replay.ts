/**
 * Replaying v2 documents in canonical order rebuilds every ledger line and stock move from
 * scratch (integrity checks, local rebuilds, property tests).
 * Order = (business date, createdAt, _id): the same on every device and on the server.
 */
import {
  postDoc,
  stockKeyId,
  type PostedLineV2,
  type PostedMoveV2,
  type PostingContextV2,
  type StockKeyV2,
  type StockPosition,
} from "./post";
import { businessDate, type Doc, type LedgerLineV2, type StockMoveV2 } from "./schemas";

/** Canonical posting order key; lexicographic order == `docOrder`. */
export function ordOfDoc(d: Doc): string {
  return `${businessDate(d)}|${d.createdAt}|${d._id}`;
}

export function docOrder(a: Doc, b: Doc): number {
  const x = ordOfDoc(a);
  const y = ordOfDoc(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Mutable stock-position book keyed by Gola + position key. */
export class StockBookV2 {
  private map = new Map<string, StockPosition>();

  contextFor(godownId: string): PostingContextV2 {
    return {
      position: (k: StockKeyV2) =>
        this.map.get(`${godownId}#${stockKeyId(k)}`) ?? { qtyG: 0n, valuePaise: 0n },
    };
  }

  apply(godownId: string, moves: readonly PostedMoveV2[]): void {
    for (const m of moves) {
      const id = `${godownId}#${stockKeyId(m)}`;
      const p = this.map.get(id) ?? { qtyG: 0n, valuePaise: 0n };
      this.map.set(id, { qtyG: p.qtyG + m.qtyG, valuePaise: p.valuePaise + m.valuePaise });
    }
  }

  entries(): Array<[string, StockPosition]> {
    return [...this.map.entries()];
  }
}

export interface ReplayedDoc {
  doc: Doc;
  lines: PostedLineV2[];
  moves: PostedMoveV2[];
}

export function replayDocs(docs: readonly Doc[]): { results: ReplayedDoc[]; book: StockBookV2 } {
  const book = new StockBookV2();
  const results: ReplayedDoc[] = [];
  for (const d of [...docs].sort(docOrder)) {
    const { lines, moves } = postDoc(d, book.contextFor(d.godownId));
    book.apply(d.godownId, moves);
    results.push({ doc: d, lines, moves });
  }
  return { results, book };
}

/** Serialize posted lines into stored ledger docs (deterministic ids per revision). */
export function toLedgerDocsV2(d: Doc, lines: readonly PostedLineV2[]): LedgerLineV2[] {
  const date = businessDate(d);
  return lines.map((l, i) => ({
    _id: `${d._id}:${d.rev}:L${i}`,
    businessId: d.businessId,
    godownId: d.godownId,
    voucherId: d._id,
    voucherRev: d.rev,
    voucherType: d.type,
    date,
    account: l.account,
    debitPaise: l.debit.toString(),
    creditPaise: l.credit.toString(),
    ...(l.partyId ? { partyId: l.partyId } : {}),
    ...(l.varietyId ? { varietyId: l.varietyId } : {}),
    ...(l.vehicleId ? { vehicleId: l.vehicleId } : {}),
    fy: d.fy,
  }));
}

export function toMoveDocsV2(d: Doc, moves: readonly PostedMoveV2[]): StockMoveV2[] {
  const date = businessDate(d);
  const ord = ordOfDoc(d);
  return moves.map((m, i) => ({
    _id: `${d._id}:${d.rev}:S${i}`,
    businessId: d.businessId,
    godownId: d.godownId,
    voucherId: d._id,
    voucherRev: d.rev,
    voucherType: d.type,
    date,
    product: m.product,
    location: m.location,
    ...(m.varietyId ? { varietyId: m.varietyId } : {}),
    ...(m.otherProductName ? { otherProductName: m.otherProductName } : {}),
    ...(m.millPartyId ? { millPartyId: m.millPartyId } : {}),
    ...(m.groupId ? { groupId: m.groupId } : {}),
    qtyG: m.qtyG.toString(),
    valuePaise: m.valuePaise.toString(),
    ...(m.bags !== undefined ? { bags: m.bags } : {}),
    ord,
  }));
}

/** Replay and serialize everything (handy for tests and rebuilds). */
export function deriveAll(docs: readonly Doc[]): { lines: LedgerLineV2[]; moves: StockMoveV2[] } {
  const { results } = replayDocs(docs);
  return {
    lines: results.flatMap((r) => toLedgerDocsV2(r.doc, r.lines)),
    moves: results.flatMap((r) => toMoveDocsV2(r.doc, r.moves)),
  };
}

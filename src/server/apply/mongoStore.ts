/** Mongo implementation of the shared v2 `DerivedStore` (inside one transaction session). */
import type { ClientSession, Db } from "mongodb";
import type { StockKeyV2 } from "@/domain/v2/post";
import type { Derived, DerivedStore } from "@/domain/v2/derive";
import type { Doc } from "@/domain/schemas";
import { fromDbLine, fromDbMove, toDbLine, toDbMove } from "../convert";
import { cols } from "../db";

/** Mongo filter for one stock position (missing optional fields must be absent). */
function keyFilter(key: StockKeyV2): Record<string, unknown> {
  return {
    product: key.product,
    location: key.location,
    varietyId: key.varietyId ?? { $exists: false },
    otherProductName:
      key.product === "OTHER" ? (key.otherProductName ?? { $exists: false }) : { $exists: false },
    millPartyId:
      key.location === "MILL" ? (key.millPartyId ?? { $exists: false }) : { $exists: false },
    groupId: key.location === "TRANSIT" ? (key.groupId ?? { $exists: false }) : { $exists: false },
  };
}

export interface MongoDerivedStore extends DerivedStore {
  /** Documents whose derived rows were rewritten during this operation. */
  touched: Set<string>;
}

export function mongoDerivedStore(db: Db, session: ClientSession): MongoDerivedStore {
  const k = cols(db);
  const touched = new Set<string>();
  return {
    touched,

    async positionBefore(godownId, ord, key, excludeDocId) {
      const [agg] = await k.stockMoves
        .aggregate<{ q: bigint | number; v: bigint | number }>(
          [
            {
              $match: {
                godownId,
                ...keyFilter(key),
                ord: { $lt: ord },
                voucherId: { $ne: excludeDocId },
              },
            },
            { $group: { _id: null, q: { $sum: "$qtyG" }, v: { $sum: "$valuePaise" } } },
          ],
          { session },
        )
        .toArray();
      return { qtyG: BigInt(agg?.q ?? 0), valuePaise: BigInt(agg?.v ?? 0) };
    },

    async docsAfter(godownId, ord, keys) {
      if (keys.length === 0) return [];
      const rows = await k.stockMoves
        .find(
          { godownId, ord: { $gt: ord }, $or: keys.map(keyFilter) },
          { projection: { voucherId: 1, ord: 1 }, session },
        )
        .toArray();
      const out = new Map<string, string>();
      for (const r of rows) out.set(r.voucherId, r.ord);
      return [...out].map(([docId, o]) => ({ docId, ord: o }));
    },

    async getDoc(id) {
      const v = await k.vouchers.findOne({ _id: id }, { session });
      return (v ?? undefined) as Doc | undefined;
    },

    async readDerived(docId): Promise<Derived> {
      // Sequential within a transaction session (no concurrent operations on one session).
      const lines = await k.ledgerLines.find({ voucherId: docId }, { session }).toArray();
      const moves = await k.stockMoves.find({ voucherId: docId }, { session }).toArray();
      return { lines: lines.map(fromDbLine), moves: moves.map(fromDbMove) };
    },

    async writeDerived(d, before, after) {
      touched.add(d._id);
      if (before.lines.length) {
        await k.ledgerLines.deleteMany(
          { _id: { $in: before.lines.map((l) => l._id) } },
          { session },
        );
      }
      if (before.moves.length) {
        await k.stockMoves.deleteMany(
          { _id: { $in: before.moves.map((m) => m._id) } },
          { session },
        );
      }
      if (after.lines.length)
        await k.ledgerLines.insertMany(after.lines.map(toDbLine), { session });
      if (after.moves.length) await k.stockMoves.insertMany(after.moves.map(toDbMove), { session });
    },
  };
}

export async function readDocDerived(
  db: Db,
  docIds: readonly string[],
  session?: ClientSession,
): Promise<Map<string, Derived>> {
  const k = cols(db);
  const out = new Map<string, Derived>(docIds.map((id) => [id, { lines: [], moves: [] }]));
  if (docIds.length === 0) return out;
  const lines = await k.ledgerLines
    .find({ voucherId: { $in: [...docIds] } }, { session })
    .toArray();
  const moves = await k.stockMoves.find({ voucherId: { $in: [...docIds] } }, { session }).toArray();
  for (const l of lines) out.get(l.voucherId)?.lines.push(fromDbLine(l));
  for (const m of moves) out.get(m.voucherId)?.moves.push(fromDbMove(m));
  return out;
}

/** @deprecated name kept for older call sites. */
export const readVoucherDerived = readDocDerived;

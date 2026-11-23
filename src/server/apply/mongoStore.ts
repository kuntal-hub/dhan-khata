/** Mongo implementation of the shared `DerivedStore` (inside one transaction session). */
import type { ClientSession, Db } from "mongodb";
import type { Derived, DerivedStore, StockKey } from "@/domain/posting/derive";
import type { Voucher } from "@/domain/schemas";
import { fromDbLine, fromDbMove, toDbLine, toDbMove } from "../convert";
import { cols } from "../db";

function keyFilter(key: StockKey) {
  return key.location === "TRANSIT"
    ? { varietyId: key.varietyId, location: key.location, groupId: key.groupId ?? "" }
    : { varietyId: key.varietyId, location: key.location };
}

export interface MongoDerivedStore extends DerivedStore {
  /** Vouchers whose derived rows were rewritten during this operation. */
  touched: Set<string>;
}

export function mongoDerivedStore(db: Db, session: ClientSession): MongoDerivedStore {
  const k = cols(db);
  const touched = new Set<string>();
  return {
    touched,

    async positionBefore(godownId, ord, key, excludeVoucherId) {
      const [agg] = await k.stockMoves
        .aggregate<{ q: bigint | number; v: bigint | number }>(
          [
            {
              $match: {
                godownId,
                ...keyFilter(key),
                ord: { $lt: ord },
                voucherId: { $ne: excludeVoucherId },
              },
            },
            { $group: { _id: null, q: { $sum: "$qtyG" }, v: { $sum: "$valuePaise" } } },
          ],
          { session },
        )
        .toArray();
      return { qtyG: BigInt(agg?.q ?? 0), valuePaise: BigInt(agg?.v ?? 0) };
    },

    async vouchersAfter(godownId, ord, keys) {
      if (keys.length === 0) return [];
      const rows = await k.stockMoves
        .find(
          { godownId, ord: { $gt: ord }, $or: keys.map(keyFilter) },
          { projection: { voucherId: 1, ord: 1 }, session },
        )
        .toArray();
      const out = new Map<string, string>();
      for (const r of rows) out.set(r.voucherId, r.ord);
      return [...out].map(([voucherId, o]) => ({ voucherId, ord: o }));
    },

    async getVoucher(id) {
      const v = await k.vouchers.findOne({ _id: id }, { session });
      return (v ?? undefined) as Voucher | undefined;
    },

    async readDerived(voucherId): Promise<Derived> {
      // Sequential within a transaction session (no concurrent operations on one session).
      const lines = await k.ledgerLines.find({ voucherId }, { session }).toArray();
      const moves = await k.stockMoves.find({ voucherId }, { session }).toArray();
      return { lines: lines.map(fromDbLine), moves: moves.map(fromDbMove) };
    },

    async writeDerived(v, before, after) {
      touched.add(v._id);
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

export async function readVoucherDerived(
  db: Db,
  voucherIds: readonly string[],
  session?: ClientSession,
): Promise<Map<string, Derived>> {
  const k = cols(db);
  const out = new Map<string, Derived>(voucherIds.map((id) => [id, { lines: [], moves: [] }]));
  if (voucherIds.length === 0) return out;
  const lines = await k.ledgerLines
    .find({ voucherId: { $in: [...voucherIds] } }, { session })
    .toArray();
  const moves = await k.stockMoves
    .find({ voucherId: { $in: [...voucherIds] } }, { session })
    .toArray();
  for (const l of lines) out.get(l.voucherId)?.lines.push(fromDbLine(l));
  for (const m of moves) out.get(m.voucherId)?.moves.push(fromDbMove(m));
  return out;
}

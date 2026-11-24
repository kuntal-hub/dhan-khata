/** Dexie implementation of the shared v2 `DerivedStore` (positions, re-posting, dailyAgg). */
import type { StockKeyV2, StockPosition } from "@/domain/v2/post";
import { moveMatchesKey, type Derived, type DerivedStore } from "@/domain/v2/derive";
import type { Doc, StockMove } from "@/domain/schemas";
import { db } from "../db/dexie";
import { applyAggDelta } from "./dailyAgg";

function movesForKey(godownId: string, key: StockKeyV2): Promise<StockMove[]> {
  return db()
    .stockMoves.where("[godownId+product+location]")
    .equals([godownId, key.product, key.location])
    .filter((m) => moveMatchesKey(m, key))
    .toArray();
}

export const dexieDerivedStore: DerivedStore = {
  async positionBefore(godownId, ord, key, excludeDocId): Promise<StockPosition> {
    let qtyG = 0n;
    let valuePaise = 0n;
    for (const m of await movesForKey(godownId, key)) {
      if (m.voucherId === excludeDocId || (m.ord ?? "") >= ord) continue;
      qtyG += BigInt(m.qtyG);
      valuePaise += BigInt(m.valuePaise);
    }
    return { qtyG, valuePaise };
  },

  async docsAfter(godownId, ord, keys) {
    const out = new Map<string, string>();
    for (const key of keys) {
      for (const m of await movesForKey(godownId, key)) {
        if ((m.ord ?? "") > ord) out.set(m.voucherId, m.ord ?? "");
      }
    }
    return [...out].map(([docId, o]) => ({ docId, ord: o }));
  },

  async getDoc(id): Promise<Doc | undefined> {
    return db().vouchers.get(id);
  },

  async readDerived(docId): Promise<Derived> {
    const d = db();
    const [lines, moves] = await Promise.all([
      d.ledgerLines.where("voucherId").equals(docId).toArray(),
      d.stockMoves.where("voucherId").equals(docId).toArray(),
    ]);
    return { lines, moves };
  },

  async writeDerived(_d, before, after) {
    await replaceDerivedRows(before, after);
  },
};

/** Replace stored derived rows and keep dailyAgg in step (used by writes and by pull). */
export async function replaceDerivedRows(before: Derived, after: Derived): Promise<void> {
  const d = db();
  await d.ledgerLines.bulkDelete(before.lines.map((l) => l._id));
  await d.stockMoves.bulkDelete(before.moves.map((m) => m._id));
  if (after.lines.length) await d.ledgerLines.bulkPut(after.lines);
  if (after.moves.length) await d.stockMoves.bulkPut(after.moves);
  await applyAggDelta(before, after);
}

/** Dexie implementation of the shared `DerivedStore` (positions, re-posting, dailyAgg). */
import type { Derived, DerivedStore, StockKey } from "@/domain/posting/derive";
import type { StockPosition } from "@/domain/posting/post";
import type { StockMove, Voucher } from "@/domain/schemas";
import { db } from "../db/dexie";
import { applyAggDelta } from "./dailyAgg";

function movesForKey(godownId: string, key: StockKey): Promise<StockMove[]> {
  return db()
    .stockMoves.where("[godownId+varietyId+location]")
    .equals([godownId, key.varietyId, key.location])
    .filter((m) => key.location !== "TRANSIT" || (m.groupId ?? "") === (key.groupId ?? ""))
    .toArray();
}

export const dexieDerivedStore: DerivedStore = {
  async positionBefore(godownId, ord, key, excludeVoucherId): Promise<StockPosition> {
    let qtyG = 0n;
    let valuePaise = 0n;
    for (const m of await movesForKey(godownId, key)) {
      if (m.voucherId === excludeVoucherId || (m.ord ?? "") >= ord) continue;
      qtyG += BigInt(m.qtyG);
      valuePaise += BigInt(m.valuePaise);
    }
    return { qtyG, valuePaise };
  },

  async vouchersAfter(godownId, ord, keys) {
    const out = new Map<string, string>();
    for (const key of keys) {
      for (const m of await movesForKey(godownId, key)) {
        if ((m.ord ?? "") > ord) out.set(m.voucherId, m.ord ?? "");
      }
    }
    return [...out].map(([voucherId, o]) => ({ voucherId, ord: o }));
  },

  async getVoucher(id): Promise<Voucher | undefined> {
    return db().vouchers.get(id);
  },

  async readDerived(voucherId): Promise<Derived> {
    const d = db();
    const [lines, moves] = await Promise.all([
      d.ledgerLines.where("voucherId").equals(voucherId).toArray(),
      d.stockMoves.where("voucherId").equals(voucherId).toArray(),
    ]);
    return { lines, moves };
  },

  async writeDerived(_v, before, after) {
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

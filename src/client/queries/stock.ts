/** Stock queries (per godown): Σ of stored stock moves by variety and location. */
import type { StockLocation } from "@/domain/schemas";
import { db } from "../db/dexie";

export interface StockRow {
  varietyId: string;
  location: StockLocation;
  qtyG: bigint;
  valuePaise: bigint;
}

export async function stockByVariety(godownId: string, toDate?: string): Promise<StockRow[]> {
  const moves = await db()
    .stockMoves.where("[godownId+date]")
    .between([godownId, ""], [godownId, toDate ?? "￿"], true, true)
    .toArray();
  const map = new Map<string, StockRow>();
  for (const m of moves) {
    const k = `${m.varietyId}|${m.location}`;
    const row = map.get(k) ?? {
      varietyId: m.varietyId,
      location: m.location,
      qtyG: 0n,
      valuePaise: 0n,
    };
    row.qtyG += BigInt(m.qtyG);
    row.valuePaise += BigInt(m.valuePaise);
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) =>
    a.varietyId === b.varietyId
      ? a.location.localeCompare(b.location)
      : a.varietyId.localeCompare(b.varietyId),
  );
}

/** Total quantity (g) and value (paise) of one variety in one location. */
export async function stockOf(
  godownId: string,
  varietyId: string,
  location: StockLocation = "STORE",
): Promise<{ qtyG: bigint; valuePaise: bigint }> {
  const moves = await db()
    .stockMoves.where("[godownId+varietyId+location]")
    .equals([godownId, varietyId, location])
    .toArray();
  let qtyG = 0n;
  let valuePaise = 0n;
  for (const m of moves) {
    qtyG += BigInt(m.qtyG);
    valuePaise += BigInt(m.valuePaise);
  }
  return { qtyG, valuePaise };
}

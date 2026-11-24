/** Stock queries (per godown): Σ of stored stock moves by variety and location. */
import { GRAMS_PER_QUINTAL } from "@/domain/money";
import { divRoundHalfUp } from "@/domain/rounding";
import type { StockLocation, Voucher } from "@/domain/schemas";
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

export interface StockSummaryRow {
  varietyId: string;
  qtyG: bigint;
  valuePaise: bigint;
  /** Weighted average cost (paise per quintal); null when there is no positive stock. */
  avgCostPerQtl: bigint | null;
  /** Bags estimate from this godown's own purchases (Σ gross ÷ Σ bags); null when unknown. */
  bagsEstimate: bigint | null;
}

/** Stock page (spec §9.11): STORE stock of the godown by variety. */
export async function stockSummary(godownId: string): Promise<StockSummaryRow[]> {
  const [rows, purchases] = await Promise.all([
    stockByVariety(godownId),
    db()
      .vouchers.where("[godownId+type+date]")
      .between([godownId, "PURCHASE", ""], [godownId, "PURCHASE", "￿"], true, true)
      .filter((v) => v.status === "active")
      .toArray(),
  ]);
  const bagWeight = new Map<string, { g: bigint; bags: bigint }>();
  for (const p of purchases) {
    if (p.type !== "PURCHASE") continue;
    for (const l of p.lines) {
      if (!l.bags) continue;
      const cur = bagWeight.get(l.varietyId) ?? { g: 0n, bags: 0n };
      cur.g += BigInt(l.grossG);
      cur.bags += BigInt(l.bags);
      bagWeight.set(l.varietyId, cur);
    }
  }
  return rows
    .filter((r) => r.location === "STORE" && (r.qtyG !== 0n || r.valuePaise !== 0n))
    .map((r) => {
      const bw = bagWeight.get(r.varietyId);
      return {
        varietyId: r.varietyId,
        qtyG: r.qtyG,
        valuePaise: r.valuePaise,
        avgCostPerQtl:
          r.qtyG > 0n ? divRoundHalfUp(r.valuePaise * GRAMS_PER_QUINTAL, r.qtyG) : null,
        bagsEstimate:
          bw && bw.bags > 0n && bw.g > 0n && r.qtyG > 0n
            ? divRoundHalfUp(r.qtyG * bw.bags, bw.g)
            : null,
      };
    });
}

export interface RegisterRow {
  voucherId: string;
  voucher: Voucher | undefined;
  date: string;
  qtyG: bigint;
  valuePaise: bigint;
  balanceQtyG: bigint;
  balanceValuePaise: bigint;
}

/** Stock register of one variety (STORE) with running balance, in posting order. */
export async function stockRegister(godownId: string, varietyId: string): Promise<RegisterRow[]> {
  const moves = await db()
    .stockMoves.where("[godownId+varietyId+location]")
    .equals([godownId, varietyId, "STORE"])
    .toArray();
  moves.sort((a, b) => ((a.ord ?? a.date) < (b.ord ?? b.date) ? -1 : 1));
  const vs = await db().vouchers.bulkGet([...new Set(moves.map((m) => m.voucherId))]);
  const vById = new Map(vs.filter((v): v is Voucher => !!v).map((v) => [v._id, v]));
  let q = 0n;
  let val = 0n;
  return moves.map((m) => {
    q += BigInt(m.qtyG);
    val += BigInt(m.valuePaise);
    return {
      voucherId: m.voucherId,
      voucher: vById.get(m.voucherId),
      date: m.date,
      qtyG: BigInt(m.qtyG),
      valuePaise: BigInt(m.valuePaise),
      balanceQtyG: q,
      balanceValuePaise: val,
    };
  });
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

/** Integrity: stock positions that went below zero on some date (§9.3, DECISIONS D51). */
import { describe, expect, it } from "vitest";
import { negativePositions } from "@/domain/integrity";
import type { StockMoveV2 } from "@/domain/schemas";

let seq = 0;
function mv(date: string, qtyG: bigint, extra: Partial<StockMoveV2> = {}): StockMoveV2 {
  seq++;
  return {
    _id: `m${seq}`,
    businessId: "B",
    godownId: "G",
    voucherId: `v${seq}`,
    voucherRev: 1,
    voucherType: "PURCHASE",
    date,
    product: "PADDY",
    location: "WAREHOUSE",
    varietyId: "V1",
    qtyG: qtyG.toString(),
    valuePaise: "0",
    ...extra,
  };
}

describe("negativePositions", () => {
  it("finds a position that dipped below zero, with the lowest point and today's quantity", () => {
    const out = negativePositions([
      mv("2026-11-01", 10n),
      mv("2026-11-03", -15n, { voucherType: "SALE" }),
      mv("2026-11-05", -2n, { voucherType: "SALE" }),
      mv("2026-11-08", 20n),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      product: "PADDY",
      varietyId: "V1",
      minG: -7n,
      onDate: "2026-11-05",
      nowG: 13n,
    });
  });

  it("same-day moves are summed first; positions are kept apart; healthy ones are not listed", () => {
    const out = negativePositions([
      // Same day: −5 then +5 → never negative.
      mv("2026-11-01", -5n, { voucherType: "SALE" }),
      mv("2026-11-01", 5n),
      // Another variety is fine.
      mv("2026-11-01", 3n, { varietyId: "V2" }),
      // Mill stock of one mill went negative.
      mv("2026-11-02", -4n, { location: "MILL", millPartyId: "M1", voucherType: "CONVERSION" }),
      mv("2026-11-02", 9n, { location: "MILL", millPartyId: "M2", voucherType: "MILL_DISPATCH" }),
    ]);
    expect(out.map((p) => [p.location, p.millPartyId ?? "", p.minG])).toEqual([
      ["MILL", "M1", -4n],
    ]);
  });
});

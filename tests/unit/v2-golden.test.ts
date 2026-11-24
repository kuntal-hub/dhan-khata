/**
 * requirement_v2 §6.4 golden tests G1–G8, plus units (kg / quintal / mon) and WeightBlock.
 */
import { describe, expect, it } from "vitest";
import { amountForWeight, parseRupees } from "@/domain/money";
import { divRoundHalfUp } from "@/domain/rounding";
import {
  formatWeightNumber,
  gramsToInput,
  monGrams,
  parseWeightIn,
  weightTriple,
} from "@/domain/units";
import { cashbookDay } from "@/domain/v2/cashbook";
import { computeBill, computeWeight } from "@/domain/v2/weightBlock";
import { bags, opening, payment, QTL, RS } from "../helpers/v2";

describe("golden G1–G8", () => {
  it("G1: 56 qtl × ₹2,400 = ₹1,34,400.00", () => {
    expect(amountForWeight(5_600_000n, 240_000n)).toBe(13_440_000n);
    expect(computeBill(56n * QTL, 2400n * RS).totalPaise).toBe(13_440_000n);
  });

  it("G2: 56 qtl = 140 মণ = 5,600 কেজি", () => {
    const g = 56n * QTL;
    expect(formatWeightNumber(g, "MON")).toBe("140.000");
    expect(formatWeightNumber(g, "KG")).toBe("5,600.000");
    expect(weightTriple(g)).toEqual({ KG: "5,600.000", QTL: "56.000", MON: "140.000" });
    expect(weightTriple(g, { digits: "bn" }).MON).toBe("১৪০.০০০");
  });

  it("G3: bags 52.5 + 48.25 + 50.000 kg → total 150.750 kg, average 50.250 kg", () => {
    const r = computeWeight(bags(52_500n, 48_250n, 50_000n));
    expect(r.totalG).toBe(150_750n);
    expect(r.bagCount).toBe(3);
    expect(r.avgBagG).toBe(50_250n);
    expect(formatWeightNumber(r.totalG, "KG")).toBe("150.750");
    expect(formatWeightNumber(r.avgBagG!, "KG")).toBe("50.250");
  });

  it("G4: 987.333 kg × ₹2,183.50 = ₹21,558.42", () => {
    expect(amountForWeight(987_333n, 218_350n)).toBe(2_155_842n);
  });

  it("G5: 1,212.500 kg × ₹2,150 = ₹26,068.75", () => {
    expect(amountForWeight(1_212_500n, 215_000n)).toBe(2_606_875n);
  });

  it("G6: parse '২৬,০৬৮.৭৫' → 2606875 paise", () => {
    const r = parseRupees("২৬,০৬৮.৭৫");
    expect(r.ok && r.value).toBe(2_606_875n);
  });

  it("G7: divRoundHalfUp(−5, 10) = −1", () => {
    expect(divRoundHalfUp(-5n, 10n)).toBe(-1n);
  });

  it("G8: cashbook 50,000 + 25,000 − 40,000 − 5,000 = ₹30,000.00", () => {
    const d1 = "2026-11-19";
    const d2 = "2026-11-20";
    const docs = [
      opening(d1, [
        { kind: "CASH", amountPaise: (50_000n * RS).toString() },
        { kind: "PARTY", refId: "C1", amountPaise: (25_000n * RS).toString() },
        { kind: "PARTY", refId: "F1", amountPaise: (-40_000n * RS).toString() },
      ]),
      payment(d2, "IN", 25_000n * RS, { type: "PARTY_ADVANCE", id: null }, { partyId: "C1" }),
      payment(d2, "OUT", 40_000n * RS, { type: "PARTY_ADVANCE", id: null }, { partyId: "F1" }),
      payment(d2, "OUT", 5_000n * RS, { type: "EXPENSE", id: "E1" }),
    ];
    const day = cashbookDay(docs, "CASH", d2);
    expect(day.openingPaise).toBe(50_000n * RS);
    expect(day.receivedPaise).toBe(25_000n * RS);
    expect(day.paidPaise).toBe(40_000n * RS);
    expect(day.expensesPaise).toBe(5_000n * RS);
    expect(day.expectedClosingPaise).toBe(30_000n * RS);
  });
});

describe("units", () => {
  it("mon is configurable (whole kg) and defaults to 40 kg", () => {
    expect(monGrams()).toBe(40_000n);
    expect(monGrams(37)).toBe(37_000n);
    expect(() => monGrams(0)).toThrow();
    expect(formatWeightNumber(56n * QTL, "MON", { monKg: 50 })).toBe("112.000");
  });

  it("parses quantities in every unit exactly, with Bengali digits", () => {
    expect(parseWeightIn("56", "QTL")).toEqual({ ok: true, value: 5_600_000n });
    expect(parseWeightIn("১৪০", "MON")).toEqual({ ok: true, value: 5_600_000n });
    expect(parseWeightIn("5,600", "KG")).toEqual({ ok: true, value: 5_600_000n });
    expect(parseWeightIn("12.12345", "QTL")).toEqual({ ok: true, value: 1_212_345n });
    expect(parseWeightIn("0.001", "MON")).toEqual({ ok: true, value: 40n });
  });

  it("rejects too many decimals instead of rounding", () => {
    expect(parseWeightIn("1.0005", "KG")).toEqual({
      ok: false,
      error: "errors.number.tooManyDecimals",
    });
    expect(parseWeightIn("1.1234", "MON")).toEqual({
      ok: false,
      error: "errors.number.tooManyDecimals",
    });
  });

  it("prefills inputs without losing grams", () => {
    expect(gramsToInput(5_600_000n, "QTL")).toBe("56");
    expect(gramsToInput(150_750n, "KG")).toBe("150.75");
    expect(gramsToInput(5_600_000n, "MON")).toBe("140");
  });
});

describe("WeightBlock", () => {
  it("deductions are optional and applied in the v1.1 order", () => {
    const r = computeWeight({
      mode: "MANUAL",
      totalG: "100000",
      deductions: { tareG: "1000", dhaltaG: "500", moistureBps: 100, otherG: "10" },
    });
    // moisture = (100000 − 1000) × 1% = 990
    expect(r.netG).toBe(100_000n - 1000n - 500n - 990n - 10n);
    const off = computeWeight(
      { mode: "MANUAL", totalG: "100000", deductions: { tareG: "1000" } },
      false,
    );
    expect(off.netG).toBe(100_000n);
  });

  it("rejects a zero or negative net weight", () => {
    expect(() => computeWeight({ mode: "BAGS", bags: [], totalG: "1" })).toThrow(
      "NET_NOT_POSITIVE",
    );
    expect(() =>
      computeWeight({ mode: "MANUAL", totalG: "1000", deductions: { otherG: "1000" } }),
    ).toThrow("NET_NOT_POSITIVE");
  });

  it("round-to-rupee shows a visible round-off line", () => {
    const b = computeBill(1_212_500n, 215_000n, true);
    expect(b.amountPaise).toBe(2_606_875n);
    expect(b.roundOffPaise).toBe(25n);
    expect(b.totalPaise).toBe(2_606_900n);
  });
});

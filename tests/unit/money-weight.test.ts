import { describe, expect, it } from "vitest";
import { formatScaled, groupIndian, parseScaled } from "@/domain/decimal";
import { normalizeDigits, toBnDigits } from "@/domain/digits";
import {
  formatPaise,
  nearestRupee,
  parsePercent,
  parseRatePerQtl,
  parseRupees,
} from "@/domain/money";
import { allocateProportional } from "@/domain/rounding";
import {
  formatKgNumber,
  formatQuintalNumber,
  parseKg,
  parseLitres,
  quintalsAndKg,
} from "@/domain/weight";
import { parseWeightInput } from "@/i18n/parse";

describe("digits", () => {
  it("normalizes and converts Bengali digits", () => {
    expect(normalizeDigits("০১২৩৪৫৬৭৮৯")).toBe("0123456789");
    expect(toBnDigits("₹1,23,456.00")).toBe("₹১,২৩,৪৫৬.০০");
  });
});

describe("parseRupees", () => {
  it.each([
    ["26068.75", 2_606_875n],
    ["₹ 26,068.75", 2_606_875n],
    ["1,23,45,678", 12_345_678_00n],
    ["123,456.5", 12_345_650n],
    [".5", 50n],
    ["০.০৫", 5n],
    ["0", 0n],
  ])("%s → %s", (input, expected) => {
    expect(parseRupees(input)).toEqual({ ok: true, value: expected });
  });

  it("rejects >2 decimals instead of rounding", () => {
    expect(parseRupees("10.555")).toEqual({ ok: false, error: "errors.number.tooManyDecimals" });
  });

  it.each(["", "abc", "1,2", "1..2", "12a", "--5"])("rejects %j", (input) => {
    expect(parseRupees(input).ok).toBe(false);
  });

  it("negative only when allowed", () => {
    expect(parseRupees("-5")).toEqual({ ok: false, error: "errors.number.negativeNotAllowed" });
    expect(parseRupees("-5", { allowNegative: true })).toEqual({ ok: true, value: -500n });
  });

  it("rate and percent", () => {
    expect(parseRatePerQtl("₹2,150/কু.")).toEqual({ ok: true, value: 215_000n });
    expect(parsePercent("২.৫%")).toEqual({ ok: true, value: 250n });
  });
});

describe("formatPaise", () => {
  it.each([
    [0n, "₹0.00"],
    [5n, "₹0.05"],
    [100n, "₹1.00"],
    [12_345_678_00n, "₹1,23,45,678.00"],
    [-1_000_000n, "-₹10,000.00"],
  ])("%s → %s", (v, s) => {
    expect(formatPaise(v)).toBe(s);
  });
  it("without symbol", () => expect(formatPaise(2_606_875n, { symbol: false })).toBe("26,068.75"));
  it("groupIndian", () => {
    expect(groupIndian("1234")).toBe("1,234");
    expect(groupIndian("123456789")).toBe("12,34,56,789");
  });
  it("nearestRupee half up", () => {
    expect(nearestRupee(2_606_850n)).toBe(2_606_900n);
    expect(nearestRupee(2_606_849n)).toBe(2_606_800n);
  });
});

describe("weight", () => {
  it("parseKg up to 3 decimals", () => {
    expect(parseKg("1,250.5 কেজি")).toEqual({ ok: true, value: 1_250_500n });
    expect(parseKg("1.2345").ok).toBe(false);
  });
  it("dual quintal+kg entry in both scripts", () => {
    expect(parseWeightInput("12 কু. 45.5 কেজি")).toEqual({ ok: true, value: 1_245_500n });
    expect(parseWeightInput("১২কু ৪৫.৫")).toEqual({ ok: true, value: 1_245_500n });
    expect(parseWeightInput("12 qtl 45.5 kg")).toEqual({ ok: true, value: 1_245_500n });
    expect(parseWeightInput("12 qtl")).toEqual({ ok: true, value: 1_200_000n });
    expect(parseWeightInput("1245.5")).toEqual({ ok: true, value: 1_245_500n });
  });
  it("split and format", () => {
    expect(quintalsAndKg(1_212_500n)).toEqual({ quintals: 12n, remainderG: 12_500n });
    expect(formatKgNumber(1_212_500n)).toBe("1,212.500");
    expect(formatKgNumber(1_212_500n, "bn")).toBe("১,২১২.৫০০");
    expect(formatQuintalNumber(1_212_500n)).toBe("12.13");
    expect(formatQuintalNumber(1_212_400n)).toBe("12.12");
  });
  it("litres → ml", () => expect(parseLitres("45.5")).toEqual({ ok: true, value: 45_500n }));
});

describe("scaled decimals", () => {
  it("formatScaled", () => {
    expect(formatScaled(5n, 3)).toBe("0.005");
    expect(formatScaled(-12_345n, 2)).toBe("-123.45");
  });
  it("parseScaled pads", () => expect(parseScaled("1.2", 3)).toEqual({ ok: true, value: 1_200n }));
});

describe("allocateProportional", () => {
  it("sums exactly to the total", () => {
    const parts = allocateProportional(100n, [1n, 1n, 1n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(parts).toEqual([34n, 33n, 33n]);
  });
  it("handles negative totals and zero weights", () => {
    expect(allocateProportional(-10n, [1n, 1n])).toEqual([-5n, -5n]);
    expect(allocateProportional(7n, [0n, 0n])).toEqual([7n, 0n]);
  });
});

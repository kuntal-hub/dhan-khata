/**
 * Weight units (spec v2 §6.2): kilogram, quintal (100 kg) and mon (মণ, 40 kg by default,
 * configurable per business as whole kilograms). Every quantity is stored as integer grams;
 * units only affect input and display.
 */
import { formatScaledGrouped, parseScaled, type ParseResult } from "./decimal";
import { applyDigits, type DigitStyle } from "./digits";
import { divRoundHalfUp } from "./rounding";

export const WEIGHT_UNITS = ["KG", "QTL", "MON"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const DEFAULT_MON_KG = 40;
export const GRAMS_PER_KG = 1000n;
export const GRAMS_PER_QTL = 100_000n;

/** Grams in one mon for a configured mon size in whole kilograms (1–100). */
export function monGrams(monKg: number = DEFAULT_MON_KG): bigint {
  if (!Number.isInteger(monKg) || monKg < 1 || monKg > 100) {
    throw new RangeError("monKg must be a whole number of kilograms between 1 and 100");
  }
  return BigInt(monKg) * GRAMS_PER_KG;
}

/** Grams in one unit. */
export function unitGrams(unit: WeightUnit, monKg: number = DEFAULT_MON_KG): bigint {
  switch (unit) {
    case "KG":
      return GRAMS_PER_KG;
    case "QTL":
      return GRAMS_PER_QTL;
    case "MON":
      return monGrams(monKg);
  }
}

/**
 * Decimal places accepted when typing a quantity in each unit. Each one is exact in grams:
 * kg → 3 (1 g), quintal → 5 (1 g), mon → 3 (0.001 mon = 40 g for a 40 kg mon).
 */
export const UNIT_INPUT_DECIMALS: Record<WeightUnit, number> = { KG: 3, QTL: 5, MON: 3 };

const UNIT_STRIP = /[\s ]|কেজি|kg|কুইন্টাল|কু\.?|qtl|মণ|mon/gi;

/**
 * Parse a typed quantity in `unit` into grams (Bengali or ASCII digits, commas allowed).
 * Too many decimals is an error (never silent rounding).
 */
export function parseWeightIn(
  input: string,
  unit: WeightUnit,
  monKg: number = DEFAULT_MON_KG,
): ParseResult<bigint> {
  const decimals = UNIT_INPUT_DECIMALS[unit];
  const r = parseScaled(input, decimals, { strip: UNIT_STRIP });
  if (!r.ok) return r;
  // value × unitGrams / 10^decimals is exact for every unit (see UNIT_INPUT_DECIMALS).
  const g = (r.value * unitGrams(unit, monKg)) / 10n ** BigInt(decimals);
  return { ok: true, value: g };
}

/** Grams expressed in `unit`, scaled by 10^decimals and rounded half-up (display only). */
export function gramsToUnitScaled(
  g: bigint,
  unit: WeightUnit,
  decimals = 3,
  monKg: number = DEFAULT_MON_KG,
): bigint {
  return divRoundHalfUp(g * 10n ** BigInt(decimals), unitGrams(unit, monKg));
}

/** Plain ASCII (no grouping) quantity in `unit`, for prefilling an input: 5600000 g, QTL → "56". */
export function gramsToInput(g: bigint, unit: WeightUnit, monKg: number = DEFAULT_MON_KG): string {
  const decimals = UNIT_INPUT_DECIMALS[unit];
  const scaled = (g * 10n ** BigInt(decimals)) / unitGrams(unit, monKg);
  const exact = (scaled * unitGrams(unit, monKg)) / 10n ** BigInt(decimals) === g;
  const value = exact ? scaled : gramsToUnitScaled(g, unit, decimals, monKg);
  const s = value.toString().padStart(decimals + 1, "0");
  const intPart = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${intPart}.${frac}` : intPart;
}

/** Grouped quantity number in `unit` with `decimals` places: 5600000 g, KG → "5,600.000". */
export function formatWeightNumber(
  g: bigint,
  unit: WeightUnit,
  opts: { digits?: DigitStyle; decimals?: number; monKg?: number } = {},
): string {
  const decimals = opts.decimals ?? 3;
  const scaled = gramsToUnitScaled(g, unit, decimals, opts.monKg ?? DEFAULT_MON_KG);
  return applyDigits(formatScaledGrouped(scaled, decimals), opts.digits ?? "en");
}

/** The three-unit line shown under every quantity (numbers only; the UI adds unit labels). */
export function weightTriple(
  g: bigint,
  opts: { digits?: DigitStyle; decimals?: number; monKg?: number } = {},
): Record<WeightUnit, string> {
  return {
    KG: formatWeightNumber(g, "KG", opts),
    QTL: formatWeightNumber(g, "QTL", opts),
    MON: formatWeightNumber(g, "MON", opts),
  };
}

/**
 * Weight: always integer GRAMS (bigint). 1 quintal = 100 kg = 100,000 g.
 * Litres for diesel: integer millilitres.
 */
import { formatScaledGrouped, fromIntString, parseScaled, type ParseResult } from "./decimal";
import { applyDigits, type DigitStyle } from "./digits";
import { GRAMS_PER_QUINTAL } from "./money";
import { divRoundHalfUp } from "./rounding";

declare const brand: unique symbol;
export type Grams = bigint & { readonly [brand]: "Grams" };
export type Millilitres = bigint & { readonly [brand]: "Millilitres" };

export const grams = (v: bigint): Grams => v as Grams;
export const GRAMS_PER_KG = 1000n;
export const KG_PER_QUINTAL = 100n;

/** "1,250.5" kg (Bengali or ASCII digits) → 1250500n grams. Max 3 decimals. */
export function parseKg(input: string): ParseResult<Grams> {
  const r = parseScaled(input, 3, { strip: /[\s ]|কেজি|kg/gi });
  return r.ok ? { ok: true, value: grams(r.value) } : r;
}

/** Quintals typed with up to 5 decimals ("12.125") → grams. */
export function parseQuintals(input: string): ParseResult<Grams> {
  const r = parseScaled(input, 5, { strip: /[\s ]|কু\.?|qtl|q/gi });
  return r.ok ? { ok: true, value: grams(r.value) } : r;
}

/** Litres with up to 3 decimals → millilitres. */
export function parseLitres(input: string): ParseResult<Millilitres> {
  const r = parseScaled(input, 3, { strip: /[\s ]|লিটার|l|ltr|litre|liter/gi });
  return r.ok ? { ok: true, value: r.value as Millilitres } : r;
}

export function quintalsAndKg(g: bigint): { quintals: bigint; remainderG: bigint } {
  const negative = g < 0n;
  const a = negative ? -g : g;
  const quintals = a / GRAMS_PER_QUINTAL;
  const remainderG = a % GRAMS_PER_QUINTAL;
  return negative ? { quintals: -quintals, remainderG: -remainderG } : { quintals, remainderG };
}

/** grams → "1,212.500" (kg, grouped, 3 decimals). */
export function formatKgNumber(g: bigint, digits: DigitStyle = "en"): string {
  return applyDigits(formatScaledGrouped(g, 3), digits);
}

/**
 * grams → quintals string with `decimals` places (0–5), rounded half up for DISPLAY only;
 * stored values always stay exact grams. 1212500n → "12.13" (decimals = 2).
 */
export function formatQuintalNumber(g: bigint, digits: DigitStyle = "en", decimals = 2): string {
  if (!Number.isInteger(decimals)) throw new RangeError("decimals must be an integer");
  const d = decimals < 0 ? 0 : decimals > 5 ? 5 : decimals;
  const divisor = 10n ** BigInt(5 - d);
  const scaled = divRoundHalfUp(g, divisor);
  return applyDigits(formatScaledGrouped(scaled, d), digits);
}

export function gramsFromJson(s: string): Grams {
  return grams(fromIntString(s));
}

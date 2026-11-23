/**
 * Money: always integer PAISE (bigint). Rates: integer paise per quintal. Percent: basis points.
 * No floating point (spec §6). JSON/IndexedDB form = decimal string of the integer.
 */
import { divRoundHalfUp } from "./rounding";
import { formatScaledGrouped, fromIntString, parseScaled, type ParseResult } from "./decimal";
import { applyDigits, type DigitStyle } from "./digits";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type Paise = Brand<bigint, "Paise">;
export type RatePaisePerQtl = Brand<bigint, "RatePaisePerQtl">;
export type Bps = Brand<bigint, "Bps">;

export const paise = (v: bigint): Paise => v as Paise;
export const ratePerQtl = (v: bigint): RatePaisePerQtl => v as RatePaisePerQtl;
export const bps = (v: bigint): Bps => v as Bps;

export const PAISE_PER_RUPEE = 100n;
export const GRAMS_PER_QUINTAL = 100_000n;
export const BPS_DENOMINATOR = 10_000n;

/** "₹26,068.75" / "২৬,০৬৮.৭৫" → 2606875n. Rejects > 2 decimals (never rounds input). */
export function parseRupees(
  input: string,
  opts: { allowNegative?: boolean } = {},
): ParseResult<Paise> {
  const r = parseScaled(input, 2, opts);
  return r.ok ? { ok: true, value: paise(r.value) } : r;
}

/** Rate per quintal typed in rupees ("2,150" or "2183.50") → paise per quintal. */
export function parseRatePerQtl(input: string): ParseResult<RatePaisePerQtl> {
  const r = parseScaled(input, 2, { strip: /[₹\s /]|কু\.?|qtl|q/gi });
  return r.ok ? { ok: true, value: ratePerQtl(r.value) } : r;
}

/** Percent typed by user ("2.5" or "২.৫%") → basis points (250n). Max 2 decimals. */
export function parsePercent(input: string): ParseResult<Bps> {
  const r = parseScaled(input, 2, { strip: /[%\s ]/g });
  return r.ok ? { ok: true, value: bps(r.value) } : r;
}

export interface FormatMoneyOptions {
  digits?: DigitStyle;
  /** Include the ₹ symbol (default true). */
  symbol?: boolean;
}

/** 2606875n → "₹26,068.75" (en digits) or "₹২৬,০৬৮.৭৫" (bn digits). Negative → "-₹…". */
export function formatPaise(value: bigint, opts: FormatMoneyOptions = {}): string {
  const { digits = "en", symbol = true } = opts;
  const grouped = formatScaledGrouped(value, 2);
  const negative = grouped.startsWith("-");
  const body = negative ? grouped.slice(1) : grouped;
  const s = (negative ? "-" : "") + (symbol ? "₹" : "") + body;
  return applyDigits(s, digits);
}

/** Round to the nearest whole rupee (half up). */
export function nearestRupee(value: bigint): bigint {
  return divRoundHalfUp(value, PAISE_PER_RUPEE) * PAISE_PER_RUPEE;
}

/** amount = net grams × rate (paise/qtl) / 100,000 g, rounded half up (spec §6.3). */
export function amountForWeight(netG: bigint, ratePaisePerQtl: bigint): bigint {
  return divRoundHalfUp(netG * ratePaisePerQtl, GRAMS_PER_QUINTAL);
}

/** value × bps / 10,000 rounded half up. */
export function applyBps(value: bigint, basisPoints: bigint): bigint {
  return divRoundHalfUp(value * basisPoints, BPS_DENOMINATOR);
}

/** Parse a serialized money string from JSON/IndexedDB. */
export function paiseFromJson(s: string): Paise {
  return paise(fromIntString(s));
}

export function paiseToJson(v: bigint): string {
  return v.toString();
}

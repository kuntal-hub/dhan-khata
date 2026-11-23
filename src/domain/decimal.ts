/**
 * Exact decimal-string ⇄ scaled-integer conversion (no floating point anywhere).
 * e.g. parseScaled("26,068.75", 2) → 2606875n ; formatScaled(2606875n, 2) → "26068.75"
 */
import { normalizeDigits } from "./digits";

export type ParseErrorCode =
  | "errors.number.empty"
  | "errors.number.invalid"
  | "errors.number.tooManyDecimals"
  | "errors.number.negativeNotAllowed";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseErrorCode };

export interface ParseScaledOptions {
  allowNegative?: boolean;
  /** Characters stripped before parsing (currency symbols, units). */
  strip?: RegExp;
}

const DEFAULT_STRIP = /[₹\s ]/g;

/**
 * Parse a user-typed decimal string into an integer scaled by 10^scale.
 * Accepts Bengali or ASCII digits and thousands separators in either Indian (1,23,456)
 * or Western (123,456) style in the integer part. Never rounds: more than `scale`
 * decimal places is an error.
 */
export function parseScaled(
  input: string,
  scale: number,
  opts: ParseScaledOptions = {},
): ParseResult<bigint> {
  let s = normalizeDigits(input).replace(opts.strip ?? DEFAULT_STRIP, "");
  if (s === "") return { ok: false, error: "errors.number.empty" };
  let negative = false;
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  const m = /^(\d{1,3}(?:,\d{2,3})*|\d+)?(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === undefined && (m[2] === undefined || m[2] === ""))) {
    return { ok: false, error: "errors.number.invalid" };
  }
  const intPart = (m[1] ?? "0").replace(/,/g, "");
  const frac = m[2] ?? "";
  if (frac.length > scale) return { ok: false, error: "errors.number.tooManyDecimals" };
  if (negative && !opts.allowNegative) {
    return { ok: false, error: "errors.number.negativeNotAllowed" };
  }
  const digits = intPart + frac.padEnd(scale, "0");
  let value = BigInt(digits === "" ? "0" : digits);
  if (negative) value = -value;
  return { ok: true, value };
}

/** Plain ASCII decimal string of a scaled integer, no grouping: 2606875n,2 → "26068.75". */
export function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const absStr = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const intPart = scale > 0 ? absStr.slice(0, -scale) : absStr;
  const frac = scale > 0 ? absStr.slice(-scale) : "";
  return (negative ? "-" : "") + intPart + (scale > 0 ? "." + frac : "");
}

/** Indian digit grouping of an ASCII integer string: "12345678" → "1,23,45,678". */
export function groupIndian(intStr: string): string {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  let rest = intStr.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) groups.unshift(rest);
  return groups.join(",") + "," + last3;
}

/** Grouped (Indian) ASCII decimal string of a scaled integer: 12345678900n,2 → "12,34,56,789.00". */
export function formatScaledGrouped(value: bigint, scale: number): string {
  const plain = formatScaled(value, scale);
  const negative = plain.startsWith("-");
  const body = negative ? plain.slice(1) : plain;
  const [i = "0", f] = body.split(".");
  return (negative ? "-" : "") + groupIndian(i) + (f !== undefined ? "." + f : "");
}

/** Strict integer-string check used for JSON/IndexedDB serialized amounts. */
export const INT_STRING_RE = /^-?\d+$/;
export const NON_NEG_INT_STRING_RE = /^\d+$/;

export function fromIntString(s: string): bigint {
  if (!INT_STRING_RE.test(s)) throw new TypeError(`Not an integer string: ${s}`);
  return BigInt(s);
}

export function toIntString(v: bigint): string {
  return v.toString();
}

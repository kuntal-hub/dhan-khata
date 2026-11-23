/**
 * Form-field parsing for money, weight, rate, percent and counts. Accepts Bengali or ASCII
 * digits, never rounds (too many decimals is an error), and returns i18n error keys.
 */
import { formatScaled, parseScaled } from "@/domain/decimal";
import { normalizeDigits } from "@/domain/digits";
import { parsePercent, parseRatePerQtl, parseRupees } from "@/domain/money";
import type { TKey } from "@/i18n/translate";
import { parseWeightInput } from "@/i18n/parse";

export interface FieldValue {
  /** Parsed value (undefined when empty or invalid). */
  value: bigint | undefined;
  /** i18n error key, or null when valid / empty-and-optional. */
  error: TKey | null;
}

function wrap(
  text: string,
  required: boolean,
  parse: (s: string) => { ok: true; value: bigint } | { ok: false; error: string },
  min?: bigint,
): FieldValue {
  if (text.trim() === "") {
    return { value: undefined, error: required ? "errors.validation.required" : null };
  }
  const r = parse(text);
  if (!r.ok) return { value: undefined, error: r.error as TKey };
  if (min !== undefined && r.value < min) {
    return {
      value: undefined,
      error: min > 0n ? "errors.validation.positive" : "errors.validation.nonNegative",
    };
  }
  return { value: r.value, error: null };
}

export const parseAmountField = (text: string, required = false, min = 0n) =>
  wrap(text, required, (s) => parseRupees(s), min);

export const parseRateField = (text: string, required = false, min = 0n) =>
  wrap(text, required, (s) => parseRatePerQtl(s), min);

export const parsePercentField = (text: string, required = false) =>
  wrap(text, required, (s) => {
    const r = parsePercent(s);
    if (r.ok && r.value > 10_000n) return { ok: false, error: "errors.validation.tooBig" };
    return r;
  });

/** "1245.5" (kg) or "12 কু. 45.5" / "12 qtl 45.5". */
export const parseWeightField = (text: string, required = false, min = 0n) =>
  wrap(text, required, (s) => parseWeightInput(s), min);

/** Whole number (bags). */
export const parseCountField = (text: string, required = false) =>
  wrap(text, required, (s) => parseScaled(s, 0));

/** 2606875n → "26068.75"; 215000n → "2150". For pre-filling inputs. */
export function paiseToInput(p: bigint | string | undefined): string {
  if (p === undefined) return "";
  return trimZeros(formatScaled(BigInt(p), 2));
}

/** grams → kg text ("1212.5"). */
export function gramsToKgInput(g: bigint | string | undefined): string {
  if (g === undefined) return "";
  return trimZeros(formatScaled(BigInt(g), 3));
}

/** basis points → percent text ("2.5"). */
export function bpsToInput(b: number | bigint | undefined): string {
  if (b === undefined) return "";
  return trimZeros(formatScaled(BigInt(b), 2));
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** ASCII digits for phone inputs etc. */
export function asciiDigits(s: string): string {
  return normalizeDigits(s);
}

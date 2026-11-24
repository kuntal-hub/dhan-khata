/**
 * Locale-aware display formatting for money, weight, rate and dates (spec §11.4).
 * Digit style (বাংলা ০১২ / English 012) is independent of the UI language.
 */
import { parseYmd, type Ymd } from "@/domain/dates";
import { applyDigits, type DigitStyle } from "@/domain/digits";
import { formatPaise } from "@/domain/money";
import { formatKgNumber, formatQuintalNumber, quintalsAndKg } from "@/domain/weight";
import { formatScaledGrouped } from "@/domain/decimal";
import { translate, type Lang } from "./translate";

export type WeightDisplay = "qtlKg" | "kg" | "qtl";

export interface FormatPrefs {
  lang: Lang;
  digits: DigitStyle;
  weight?: WeightDisplay;
}

/** ₹26,068.75 / ₹২৬,০৬৮.৭৫ */
export function formatMoney(
  paiseValue: bigint,
  prefs: Pick<FormatPrefs, "digits">,
  symbol = true,
): string {
  return formatPaise(paiseValue, { digits: prefs.digits, symbol });
}

/** Rate per quintal: "₹2,150.00/কু." */
export function formatRate(ratePaisePerQtl: bigint, prefs: FormatPrefs): string {
  return `${formatPaise(ratePaisePerQtl, { digits: prefs.digits })}/${translate(prefs.lang, "units.quintalShort")}`;
}

/**
 * Weight: "12 কু. 12.500 কেজি" (qtlKg), "1,212.500 কেজি" (kg) or "12.13 কু." (qtl).
 */
export function formatWeight(grams: bigint, prefs: FormatPrefs): string {
  const mode = prefs.weight ?? "qtlKg";
  if (mode === "kg") {
    return translate(prefs.lang, "units.weightKg", { kg: formatKgNumber(grams, prefs.digits) });
  }
  if (mode === "qtl") {
    return translate(prefs.lang, "units.weightQtl", {
      q: formatQuintalNumber(grams, prefs.digits, 2),
    });
  }
  const { quintals, remainderG } = quintalsAndKg(grams);
  const negative = grams < 0n;
  const q = applyDigits(formatScaledGrouped(negative ? -quintals : quintals, 0), prefs.digits);
  const kg = formatKgNumber(negative ? -remainderG : remainderG, prefs.digits);
  const s = translate(prefs.lang, "units.weightQtlKg", { q, kg });
  return negative ? `-${s}` : s;
}

/** Percent from basis points: 250n → "2.50%" */
export function formatPercent(bps: bigint, prefs: Pick<FormatPrefs, "digits">): string {
  return `${applyDigits(formatScaledGrouped(bps, 2), prefs.digits)}%`;
}

/** Plain integer/count with Indian grouping. */
export function formatCount(n: number | bigint, prefs: Pick<FormatPrefs, "digits">): string {
  return applyDigits(formatScaledGrouped(BigInt(n), 0), prefs.digits);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * "২৩ নভেম্বর ২০২৬, সোমবার" / "Mon, 23 Nov 2026". Names and order come from the dictionary
 * (`calendar.*`), so no date library or locale data is shipped with the Home route.
 */
export function formatDate(ymd: Ymd, prefs: FormatPrefs, style: "long" | "short" = "long"): string {
  const { y, m, d } = parseYmd(ymd);
  // UTC avoids any device-timezone / DST shift; a calendar date has no time of day.
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const month = MONTHS[m - 1];
  return translate(prefs.lang, `calendar.${style}`, {
    d: applyDigits(String(d), prefs.digits),
    y: applyDigits(String(y), prefs.digits),
    monthLong: translate(prefs.lang, `calendar.monthLong.${month}`),
    monthShort: translate(prefs.lang, `calendar.monthShort.${month}`),
    weekday: translate(prefs.lang, `calendar.weekday.${weekday}`),
  });
}

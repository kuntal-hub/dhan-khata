/**
 * Business dates: `YYYY-MM-DD` strings in IST (Asia/Kolkata), regardless of device timezone.
 * Financial year: April–March ("2026-27"). Seasons from an editable month map.
 */

export const BUSINESS_TZ = "Asia/Kolkata";
export type Ymd = string;
export type Season = "AMAN" | "BORO" | "AUS";
export const SEASONS: readonly Season[] = ["AMAN", "BORO", "AUS"];

/** Month numbers (1–12) belonging to each season. Default spec §24: Aman Nov–Feb, Boro Apr–Jul, Aus Aug–Oct. */
export type SeasonMap = Record<Season, number[]>;
export const DEFAULT_SEASON_MAP: SeasonMap = {
  AMAN: [11, 12, 1, 2],
  BORO: [4, 5, 6, 7],
  AUS: [8, 9, 10],
};

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const istFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's business date in IST. */
export function todayIST(now: Date = new Date()): Ymd {
  return istFormatter.format(now);
}

export function parseYmd(ymd: Ymd): { y: number; m: number; d: number } {
  const match = YMD_RE.exec(ymd);
  if (!match) throw new RangeError(`Invalid date: ${ymd}`);
  return { y: parseInt(match[1]!, 10), m: parseInt(match[2]!, 10), d: parseInt(match[3]!, 10) };
}

export function isValidYmd(ymd: string): boolean {
  const match = YMD_RE.exec(ymd);
  if (!match) return false;
  const y = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  const d = parseInt(match[3]!, 10);
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUtcDays(ymd: Ymd): number {
  const { y, m, d } = parseYmd(ymd);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function fromUtcDays(days: number): Ymd {
  const dt = new Date(days * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(ymd: Ymd, days: number): Ymd {
  return fromUtcDays(toUtcDays(ymd) + days);
}

/** Whole days from `a` to `b` (b − a). */
export function diffDays(a: Ymd, b: Ymd): number {
  return toUtcDays(b) - toUtcDays(a);
}

/** Indian financial year label, e.g. "2026-27". */
export function fyOf(ymd: Ymd): string {
  const { y, m } = parseYmd(ymd);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function fyRange(fy: string): { from: Ymd; to: Ymd } {
  const start = parseInt(fy.slice(0, 4), 10);
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** Season suggested for a date (editable by the user). undefined if the month isn't mapped. */
export function seasonOf(ymd: Ymd, map: SeasonMap = DEFAULT_SEASON_MAP): Season | undefined {
  const { m } = parseYmd(ymd);
  return SEASONS.find((s) => map[s].includes(m));
}

export function compareYmd(a: Ymd, b: Ymd): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

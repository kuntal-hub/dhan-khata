/**
 * Report model (spec §9.14): every report builds plain tables of typed cells. The same model is
 * rendered on screen, printed with the godown letterhead and exported to Excel, so the three
 * always show the same numbers. Labels are already translated (current UI language).
 */
import { addDays, fyOf, fyRange, parseYmd, seasonOf } from "@/domain/dates";
import type { GodownSettings } from "@/domain/schemas";

export type ColKind = "text" | "money" | "qty" | "rate" | "count" | "date";
export type CellValue = string | bigint | number | null;

export interface ReportColumn {
  label: string;
  kind: ColKind;
}

export interface ReportTable {
  title?: string;
  columns: ReportColumn[];
  rows: CellValue[][];
  totals?: CellValue[];
  /** Per-row kind for numeric cells (transposed tables mixing money and quantity). */
  rowKinds?: Array<ColKind | null>;
  /** Optional link per row (opens the voucher / party). */
  links?: Array<string | null>;
}

export interface ReportChart {
  labels: string[];
  series: Array<{ name: string; values: bigint[] }>;
}

export interface ReportModel {
  tables: ReportTable[];
  notes?: Array<{ text: string; tone?: "ok" | "warn" }>;
  chart?: ReportChart;
}

export type Preset = "today" | "yesterday" | "week" | "month" | "season" | "fy" | "custom";
export const PRESETS: readonly Preset[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "season",
  "fy",
  "custom",
];

/** Date range of a preset, relative to `today` (business dates, IST). */
export function presetRange(
  preset: Preset,
  today: string,
  seasonMap?: GodownSettings["seasonMap"],
): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "week": {
      // Monday-based week.
      const { y, m, d } = parseYmd(today);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
      return { from: addDays(today, -((dow + 6) % 7)), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "season": {
      const s = seasonOf(today, seasonMap);
      if (!s) return { from: `${today.slice(0, 7)}-01`, to: today };
      // Walk back to the first day of this season's run of months.
      let from = `${today.slice(0, 7)}-01`;
      for (let i = 0; i < 12; i++) {
        const prev = addDays(from, -1);
        if (seasonOf(prev, seasonMap) !== s) break;
        from = `${prev.slice(0, 7)}-01`;
      }
      return { from, to: today };
    }
    case "fy":
      return { from: fyRange(fyOf(today)).from, to: today };
    case "custom":
      return { from: today, to: today };
  }
}

/** The kind of one cell: the row override (numeric columns) or the column's kind. */
export function cellKind(t: ReportTable, row: number, col: number): ColKind {
  const ck = t.columns[col]?.kind ?? "text";
  const rk = t.rowKinds?.[row];
  return rk && ck !== "text" ? rk : ck;
}

/** Sum of a numeric column (bigint cells only). */
export function sumCol(rows: CellValue[][], i: number): bigint {
  let s = 0n;
  for (const r of rows) {
    const v = r[i];
    if (typeof v === "bigint") s += v;
  }
  return s;
}

/** Search params shared by the screen and the print view. */
export function reportQuery(p: {
  r: string;
  from: string;
  to: string;
  party?: string | undefined;
  account?: string | undefined;
}): string {
  const q = new URLSearchParams({ r: p.r, from: p.from, to: p.to });
  if (p.party) q.set("party", p.party);
  if (p.account) q.set("account", p.account);
  return q.toString();
}

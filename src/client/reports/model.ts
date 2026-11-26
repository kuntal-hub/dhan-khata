/**
 * The one report model (requirement_v2 §13): rendered on screen, printed (A4 / 80 mm), exported
 * to Excel (.xlsx) and CSV, and shared as an image. Values stay exact: money is paise, weight is
 * grams (bigint) until they are formatted or written as exact decimal text.
 */
import { formatScaled } from "@/domain/decimal";

export type CellValue =
  | string
  | { m: bigint } // paise
  | { q: bigint } // grams
  | { n: number } // count
  | { d: string } // YYYY-MM-DD
  | null;

export type ColumnKind = "text" | "money" | "qty" | "count" | "date";

export interface Column {
  label: string;
  kind: ColumnKind;
  /** Not additive (a rate per quintal): the totals row leaves it empty. */
  noTotal?: boolean;
}

export interface ReportModel {
  columns: Column[];
  rows: CellValue[][];
  /** Totals row (first cell = label). Omit for none. */
  totals?: CellValue[];
  /** Optional bar chart (one or two series over the row labels). */
  chart?: { labels: string[]; series: Array<{ name: string; values: bigint[] }> };
  /** Short note under the table (e.g. how a figure is computed). */
  note?: string;
}

/** Totals for every money / qty / count column; `label` in the first column. */
export function autoTotals(
  columns: readonly Column[],
  rows: readonly CellValue[][],
  label: string,
): CellValue[] {
  const big = (v: CellValue | undefined, k: "m" | "q"): bigint =>
    v && typeof v === "object" && k in v ? (v as Record<string, bigint>)[k]! : 0n;
  const int = (v: CellValue | undefined): number =>
    v && typeof v === "object" && "n" in v ? v.n : 0;
  return columns.map((c, i) => {
    if (i === 0) return label;
    if (c.noTotal) return null;
    if (c.kind === "money") return { m: rows.reduce((s, r) => s + big(r[i], "m"), 0n) };
    if (c.kind === "qty") return { q: rows.reduce((s, r) => s + big(r[i], "q"), 0n) };
    if (c.kind === "count") return { n: rows.reduce((s, r) => s + int(r[i]), 0) };
    return null;
  });
}

/** Prefix a "Gola" column (all-Golas view) and merge the per-Gola models. */
export function mergeGolas(
  parts: ReadonlyArray<{ gola: string; model: ReportModel }>,
  golaLabel: string,
  totalLabel: string,
): ReportModel {
  if (parts.length === 1) return parts[0]!.model;
  const first = parts[0]?.model;
  if (!first) return { columns: [], rows: [] };
  const columns: Column[] = [{ label: golaLabel, kind: "text" }, ...first.columns];
  const rows = parts.flatMap((p) => p.model.rows.map((r) => [p.gola, ...r]));
  const hasTotals = parts.some((p) => p.model.totals);
  return {
    columns,
    rows,
    ...(hasTotals ? { totals: autoTotals(columns, rows, totalLabel) } : {}),
    ...(first.note ? { note: first.note } : {}),
  };
}

/** Plain text of a cell for CSV (exact decimals: rupees with 2 dp, quintals with 5 dp). */
export function cellCsv(v: CellValue): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if ("m" in v) return formatScaled(v.m, 2);
  if ("q" in v) return formatScaled(v.q, 5);
  if ("n" in v) return String(v.n);
  return v.d;
}

function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a UTF-8 BOM (Excel opens Bengali text correctly). */
export function modelToCsv(title: string, m: ReportModel): string {
  const lines = [
    csvEscape(title),
    m.columns.map((c) => csvEscape(c.label)).join(","),
    ...m.rows.map((r) => r.map((c) => csvEscape(cellCsv(c))).join(",")),
    ...(m.totals ? [m.totals.map((c) => csvEscape(cellCsv(c))).join(",")] : []),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

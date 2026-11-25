/**
 * Run a report for the active scope: one Gola, or every active Gola (all-Golas view). Section
 * reports are built per Gola and merged with a Gola column; business reports (Gola-wise,
 * combined) are built once over all Golas. Read-only.
 */
import type { CellValue, ReportModel } from "./model";
import { mergeGolas } from "./model";
import type { ReportCtx, ReportDef, T } from "./defs";

export interface RunScope {
  godownIds: string[];
  golaName: (id: string) => string;
  from: string;
  to: string;
  opt?: string;
  t: T;
}

export async function runReport(def: ReportDef, s: RunScope): Promise<ReportModel> {
  const base: Omit<ReportCtx, "godownId"> = {
    godownIds: s.godownIds,
    golaName: s.golaName,
    from: def.period === "date" ? s.to : s.from,
    to: s.to,
    ...(s.opt ? { opt: s.opt } : {}),
    t: s.t,
  };
  if (def.business || s.godownIds.length <= 1) {
    const first = s.godownIds[0];
    if (!first) return { columns: [], rows: [] };
    return def.build({ ...base, godownId: first });
  }
  const parts = [];
  for (const g of s.godownIds) {
    parts.push({ gola: s.golaName(g), model: await def.build({ ...base, godownId: g }) });
  }
  return mergeGolas(parts, s.t("rep.c.gola"), s.t("rep.total"));
}

/** Cells for the Excel writer (exact decimals; dates as text). */
export function excelCell(
  v: CellValue,
  fmtDate: (ymd: string) => string,
): string | number | null | { money: string } | { weight: string } {
  if (v === null) return null;
  if (typeof v === "string") return v;
  if ("m" in v) return { money: v.m.toString() };
  if ("q" in v) return { weight: v.q.toString() };
  if ("n" in v) return v.n;
  return fmtDate(v.d);
}

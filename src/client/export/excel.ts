/**
 * Excel export (spec §9.5 / §17.1). `exceljs` is loaded lazily so it never weighs on first load.
 * Headers and sheet names come from i18n. Money columns are rupees (2 dp), weights quintals.
 */
import { formatScaled } from "@/domain/decimal";

/** A cell that carries its own kind (mixed tables): paise → rupees, grams → quintals. */
export type TypedCell = { money: string } | { weight: string };

export interface SheetSpec {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | null | TypedCell>>;
  /** Optional totals row (bold). */
  totals?: Array<string | number | null | TypedCell>;
  /** Column indexes that hold money (paise strings → rupee numbers, 2 dp). */
  moneyCols?: number[];
  /** Column indexes that hold weights (grams → quintals, 3 dp of kg precision). */
  weightCols?: number[];
}

/**
 * Money/weight cells are written as a formula holding the EXACT decimal text ("=26068.75"):
 * Excel parses the number itself, so no JavaScript floating point ever touches an amount
 * (non-negotiable #1).
 */
function exactCell(v: string | number | null, scale: number): { formula: string } | null {
  if (v === null || v === "") return null;
  return { formula: formatScaled(BigInt(v), scale) };
}
export async function downloadWorkbook(filename: string, sheets: SheetSpec[]): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dhan Khata";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.addRow(s.headers).font = { bold: true };
    const add = (r: Array<string | number | null | TypedCell>, bold = false) => {
      const row = ws.addRow(
        r.map((cell, i) => {
          if (cell !== null && typeof cell === "object") {
            return "money" in cell ? exactCell(cell.money, 2) : exactCell(cell.weight, 5);
          }
          return s.moneyCols?.includes(i)
            ? exactCell(cell, 2)
            : s.weightCols?.includes(i)
              ? exactCell(cell, 5)
              : cell;
        }),
      );
      r.forEach((cell, i) => {
        if (cell !== null && typeof cell === "object") {
          row.getCell(i + 1).numFmt = "money" in cell ? "#,##,##0.00" : "0.00000";
        }
      });
      if (bold) row.font = { bold: true };
    };
    for (const r of s.rows) add(r);
    if (s.totals) add(s.totals, true);
    s.moneyCols?.forEach((i) => (ws.getColumn(i + 1).numFmt = "#,##,##0.00"));
    s.weightCols?.forEach((i) => (ws.getColumn(i + 1).numFmt = "0.00000"));
    ws.columns.forEach((c) => (c.width = 16));
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

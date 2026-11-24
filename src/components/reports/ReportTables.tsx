"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { cn } from "@/lib/utils";
import { db } from "@/client/db/dexie";
import type { SheetSpec, TypedCell } from "@/client/export/excel";
import type { Labels } from "@/client/reports/defs";
import { cellKind, type CellValue, type ColKind, type ReportModel } from "@/client/reports/model";
import { categoryLabel } from "@/client/ui/labels";
import { useVirtualRows } from "@/components/lists/VirtualList";
import { useNames } from "@/components/vouchers/names";
import { useI18n } from "@/i18n/I18nProvider";

/** Display labels for report builders (names of this godown's masters, godown names). */
export function useReportLabels(godownId: string | null): Labels | undefined {
  const { t } = useI18n();
  const names = useNames(godownId);
  const extra = useLiveQuery(async () => {
    const [cats, godowns] = await Promise.all([
      godownId ? db().expenseCategories.where("godownId").equals(godownId).toArray() : [],
      db().godowns.toArray(),
    ]);
    return { cats, godowns };
  }, [godownId]);
  if (!names || !extra) return undefined;
  return {
    t,
    party: names.party,
    variety: names.variety,
    bank: names.bank,
    vehicle: names.vehicle,
    category: (code) => {
      const c = extra.cats.find((x) => x.code === code);
      return c ? categoryLabel(c, t) : code;
    },
    godown: (id) => extra.godowns.find((g) => g._id === id)?.name ?? id,
  };
}

/** Format one cell for screen / print. */
export function useCellFormatter() {
  const { money, weightOf, rate, count, date } = useI18n();
  return (v: CellValue, kind: ColKind): string => {
    if (v === null) return "";
    if (typeof v === "bigint") {
      if (kind === "qty") return weightOf(v);
      if (kind === "rate") return rate(v);
      if (kind === "count") return count(v);
      return money(v);
    }
    if (typeof v === "number") return count(v);
    if (kind === "date") return date(v, "short");
    return v;
  };
}

/** The report tables (screen and print share this renderer). */
export function ReportTables({ model, compact }: { model: ReportModel; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4" data-testid="report-tables">
      {model.tables.map((tbl, ti) => (
        <ReportTable key={ti} tbl={tbl} ti={ti} compact={compact} />
      ))}
    </div>
  );
}

type Table = ReportModel["tables"][number];

/** One table. Long tables (a season's day book) are window-virtualized on screen; the print
 * layout (`compact`) and the browser's print always render every row. */
function ReportTable({ tbl, ti, compact }: { tbl: Table; ti: number; compact?: boolean }) {
  const fmt = useCellFormatter();
  const {
    attach: attachRows,
    measureRow,
    indices: rowIdx,
    padTop,
    padBottom,
  } = useVirtualRows(tbl.rows.length, { disabled: compact });
  const width = tbl.columns.length;
  return (
    <section className="flex flex-col gap-1">
      {tbl.title ? <h3 className="text-sm font-semibold">{tbl.title}</h3> : null}
      <div className={cn("overflow-x-auto rounded-md border", compact ? "border-0" : "")}>
        <table
          className={cn("w-full", compact ? "text-xs" : "text-sm")}
          data-testid={`report-table-${ti}`}
        >
          <thead className="bg-muted/50">
            <tr>
              {tbl.columns.map((col, ci) => (
                <th
                  key={ci}
                  className={cn(
                    "p-2 align-bottom font-medium",
                    col.kind === "text" || col.kind === "date" ? "text-left" : "text-right",
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={attachRows}>
            {padTop > 0 ? (
              <tr aria-hidden>
                <td colSpan={width} style={{ height: padTop, padding: 0 }} />
              </tr>
            ) : null}
            {rowIdx.map((ri) => {
              const row = tbl.rows[ri]!;
              return (
                <tr key={ri} className="border-t align-top" data-index={ri} ref={measureRow}>
                  {row.map((cell, ci) => {
                    const kind = cellKind(tbl, ri, ci);
                    const text = fmt(cell, kind);
                    const link = ci === 0 || ci === 1 ? tbl.links?.[ri] : null;
                    return (
                      <td
                        key={ci}
                        className={cn(
                          "p-2",
                          kind === "text" || kind === "date"
                            ? "text-left"
                            : "tabular text-right whitespace-nowrap",
                          typeof cell === "bigint" && cell < 0n
                            ? "text-red-700 dark:text-red-400"
                            : "",
                        )}
                        data-value={typeof cell === "bigint" ? cell.toString() : undefined}
                      >
                        {link && ci === 1 ? (
                          <Link href={link} className="text-primary underline print:no-underline">
                            {text}
                          </Link>
                        ) : (
                          text
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {padBottom > 0 ? (
              <tr aria-hidden>
                <td colSpan={width} style={{ height: padBottom, padding: 0 }} />
              </tr>
            ) : null}
          </tbody>
          {tbl.totals ? (
            <tfoot>
              <tr className="border-t-2 font-semibold" data-testid={`report-totals-${ti}`}>
                {tbl.totals.map((cell, ci) => {
                  const kind = tbl.columns[ci]?.kind ?? "text";
                  return (
                    <td
                      key={ci}
                      className={cn(
                        "p-2",
                        kind === "text" || kind === "date"
                          ? "text-left"
                          : "tabular text-right whitespace-nowrap",
                      )}
                      data-value={typeof cell === "bigint" ? cell.toString() : undefined}
                    >
                      {fmt(cell, kind)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
function typed(v: CellValue, kind: ColKind): string | number | null | TypedCell {
  if (v === null) return null;
  if (typeof v === "bigint") {
    if (kind === "qty") return { weight: v.toString() };
    if (kind === "count") return v.toString();
    return { money: v.toString() };
  }
  return v;
}

/** The same model as Excel sheets (exact decimals, i18n headers and sheet names). */
export function modelToSheets(model: ReportModel, sheetName: string): SheetSpec[] {
  return model.tables.map((tbl, i) => ({
    name: (tbl.title
      ? `${sheetName} - ${tbl.title}`
      : model.tables.length > 1
        ? `${sheetName} ${i + 1}`
        : sheetName
    )
      .replace(/[\\/?*[\]:]/g, " ")
      .slice(0, 31),
    headers: tbl.columns.map((c) => c.label),
    rows: tbl.rows.map((r, ri) => r.map((cell, ci) => typed(cell, cellKind(tbl, ri, ci)))),
    ...(tbl.totals
      ? { totals: tbl.totals.map((cell, ci) => typed(cell, tbl.columns[ci]?.kind ?? "text")) }
      : {}),
  }));
}

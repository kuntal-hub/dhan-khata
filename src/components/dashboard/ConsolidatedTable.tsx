"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Lock } from "lucide-react";
import { DateNav } from "@/components/daily/DateNav";
import { Loading } from "@/components/lists/common";
import { useActiveGodown } from "@/client/hooks";
import { consolidatedDashboard, type DashboardColumn } from "@/client/queries/consolidated";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

type Row = { key: keyof Omit<DashboardColumn, "godownId">; label: TKey; kind: "money" | "qty" };

const ROWS: Row[] = [
  { key: "cashPaise", label: "dash.cash", kind: "money" },
  { key: "stockQtyG", label: "dash.stock", kind: "qty" },
  { key: "purchaseQtyG", label: "dash.purchase", kind: "qty" },
  { key: "purchaseAmountPaise", label: "dash.purchase", kind: "money" },
  { key: "saleQtyG", label: "dash.sale", kind: "qty" },
  { key: "saleAmountPaise", label: "dash.sale", kind: "money" },
  { key: "expensePaise", label: "dash.expense", kind: "money" },
  { key: "receivablePaise", label: "dashboard.receivableTotal", kind: "money" },
  { key: "payablePaise", label: "dashboard.payableTotal", kind: "money" },
  { key: "interGodownPaise", label: "dash.interGodown", kind: "money" },
];

/**
 * "সব গোডাউন" dashboard (spec §9.1, §1.4 rule 4): one column per godown + a total column.
 * Read-only; tapping a godown column switches to that godown.
 */
export function ConsolidatedTable({ date, onDate }: { date: string; onDate: (d: string) => void }) {
  const { t, money, weightOf } = useI18n();
  const { godowns, select } = useActiveGodown();
  const active = (godowns ?? []).filter((g) => g.status === "active");
  const ids = active.map((g) => g._id);
  const data = useLiveQuery(() => consolidatedDashboard(ids, date), [ids.join(","), date]);
  if (!data) return <Loading />;
  const fmt = (r: Row, v: bigint) => (r.kind === "money" ? money(v) : weightOf(v));
  return (
    <div className="flex flex-col gap-3" data-testid="consolidated">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Lock className="size-4" aria-hidden />
        {t("dash.allTitle")}
      </div>
      <DateNav value={date} onChange={onDate} testId="dash-date" />
      <p className="text-muted-foreground text-xs">{t("dash.tapToSwitch")}</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm" data-testid="consolidated-table">
          <thead className="bg-muted/50">
            <tr>
              <th className="bg-muted/50 sticky left-0 p-2 text-left font-medium" />
              {data.columns.map((c) => {
                const g = active.find((x) => x._id === c.godownId);
                return (
                  <th key={c.godownId} className="p-0 text-right font-medium">
                    <button
                      type="button"
                      className="text-primary min-h-11 w-full px-2 text-right underline"
                      onClick={() => select(c.godownId)}
                      data-testid={`consolidated-col-${g?.code ?? c.godownId}`}
                    >
                      {g?.name ?? ""}
                    </button>
                  </th>
                );
              })}
              <th className="p-2 text-right font-semibold">{t("dash.total")}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => (
              <tr
                key={`${r.key}-${i}`}
                className="border-t"
                data-testid={`consolidated-row-${r.key}`}
              >
                <th className="bg-background sticky left-0 p-2 text-left font-normal whitespace-nowrap">
                  {t(r.label)}{" "}
                  <span className="text-muted-foreground text-xs">
                    {r.kind === "qty" ? t("units.quintalShort") : "₹"}
                  </span>
                </th>
                {data.columns.map((c) => {
                  const g = active.find((x) => x._id === c.godownId);
                  return (
                    <td
                      key={c.godownId}
                      className="tabular p-2 text-right whitespace-nowrap"
                      data-testid={`cell-${r.key}-${g?.code ?? c.godownId}`}
                      data-value={c[r.key].toString()}
                    >
                      {fmt(r, c[r.key])}
                    </td>
                  );
                })}
                <td
                  className="tabular p-2 text-right font-semibold whitespace-nowrap"
                  data-testid={`cell-${r.key}-TOTAL`}
                  data-value={data.total[r.key].toString()}
                >
                  {fmt(r, data.total[r.key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

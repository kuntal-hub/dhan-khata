"use client";

/**
 * Dashboard → দৈনিক হিসাব (requirement_v2 §12.1D): one row per day of the range — money received,
 * paid, expenses, purchase (₹ / qty), sales (₹ / qty), paddy in / out, closing cash, closing
 * paddy (+ rice) — with a totals row and print. `?day=` (or tapping a date / a chart bar) shows
 * that single day's entries.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Printer, Receipt } from "lucide-react";
import { docPath } from "@/components/entry/docPath";
import { docTitle } from "@/components/entry/docLabel";
import { Panel, Skeleton, TxnCard } from "@/components/kit/Kit";
import { Button } from "@/components/ui/button";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { dailyRowsFor } from "@/client/queries/consolidated/dashboard";
import { docsOfDay, type DailyRow } from "@/client/queries/dashboard";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import { RangeBar, useDashRange } from "./range";

function DayEntries({ day, ids }: { day: string; ids: string[] }) {
  const { t, date } = useI18n();
  const router = useRouter();
  const items = useLiveQuery(
    async () => (await Promise.all(ids.map((g) => docsOfDay(g, day)))).flat(),
    [ids.join("|"), day],
  );
  return (
    <div className="flex flex-col gap-3" data-testid="day-entries">
      <Button
        variant="outline"
        className="h-11 self-start"
        onClick={() => router.replace("/?tab=daily")}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("dly.back")}
      </Button>
      <Panel title={t("dly.dayTitle", { date: date(day) })}>
        {items === undefined ? (
          <Skeleton rows={3} />
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("dly.noEntries")}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((r, i) => {
              const d = r.doc;
              const amount =
                "totalPaise" in d
                  ? BigInt(d.totalPaise)
                  : "amountPaise" in d
                    ? BigInt(d.amountPaise)
                    : undefined;
              const href = docPath(d);
              return (
                <li key={d._id}>
                  <TxnCard
                    index={i}
                    icon={Receipt}
                    tone={
                      d.type === "SALE" || (d.type === "PAYMENT" && d.direction === "IN")
                        ? "in"
                        : "gold"
                    }
                    title={docTitle(d, t, r.party?.name, r.source).title}
                    subtitle={docTitle(d, t, r.party?.name, r.source).subtitle}
                    date={d.number}
                    {...(amount !== undefined ? { amountPaise: amount } : {})}
                    {...(href ? { href } : {})}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default function DailyOverview() {
  const { t, money, date, digits } = useI18n();
  const params = useSearchParams();
  const day = params.get("day");
  const { godownId, godowns, consolidated } = useActiveGodown();
  const business = useBusiness();
  const range = useDashRange();
  const ids = consolidated
    ? (godowns ?? []).filter((g) => g.status === "active").map((g) => g._id)
    : godownId
      ? [godownId]
      : [];
  const rows = useLiveQuery(
    () => (ids.length && !day ? dailyRowsFor(ids, range.from, range.to) : Promise.resolve([])),
    [ids.join("|"), range.from, range.to, day],
  );
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) return <DayEntries day={day} ids={ids} />;
  const o = { digits, monKg: business?.monKg };
  const q = (g: bigint) => formatWeightNumber(g, "QTL", o);
  const sum = (k: keyof Omit<DailyRow, "date">) => (rows ?? []).reduce((s, r) => s + r[k], 0n);
  const last = rows && rows.length ? rows[rows.length - 1]! : undefined;
  const cols: Array<{
    key: keyof Omit<DailyRow, "date">;
    label: string;
    kind: "money" | "qty";
    total: "sum" | "last";
  }> = [
    { key: "receivedPaise", label: t("dly.received"), kind: "money", total: "sum" },
    { key: "paidPaise", label: t("dly.paid"), kind: "money", total: "sum" },
    { key: "expensesPaise", label: t("dly.expenses"), kind: "money", total: "sum" },
    { key: "purchasePaise", label: t("dly.purchase"), kind: "money", total: "sum" },
    { key: "purchaseG", label: t("dly.purchase"), kind: "qty", total: "sum" },
    { key: "salesPaise", label: t("dly.sales"), kind: "money", total: "sum" },
    { key: "salesG", label: t("dly.sales"), kind: "qty", total: "sum" },
    { key: "stockInG", label: t("dly.stockIn"), kind: "qty", total: "sum" },
    { key: "stockOutG", label: t("dly.stockOut"), kind: "qty", total: "sum" },
    { key: "closingCashPaise", label: t("dly.closingCash"), kind: "money", total: "last" },
    { key: "closingPaddyG", label: t("dly.closingPaddy"), kind: "qty", total: "last" },
    { key: "closingRiceG", label: t("dly.closingRice"), kind: "qty", total: "last" },
  ];
  const cell = (kind: "money" | "qty", v: bigint) => (kind === "money" ? money(v) : q(v));
  return (
    <div className="flex flex-col gap-4" data-testid="daily-overview">
      <div className="no-print">
        <RangeBar />
      </div>
      <div className="no-print flex justify-end">
        <Button
          variant="outline"
          className="h-11"
          onClick={() => window.print()}
          data-testid="daily-print"
        >
          <Printer className="size-4" aria-hidden />
          {t("dly.print")}
        </Button>
      </div>
      {rows === undefined ? (
        <Skeleton rows={5} />
      ) : (
        <div className="bg-card shadow-card print-sheet overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[960px] text-sm" data-testid="daily-table">
            <thead className="text-muted-foreground bg-muted/40 text-xs">
              <tr>
                <th className="bg-card sticky left-0 px-3 py-2 text-left font-normal">
                  {t("dly.date")}
                </th>
                {cols.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-right font-normal whitespace-nowrap">
                    {c.label}
                    {c.kind === "qty" ? ` (${t("ui.unitQtlShort")})` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...rows].reverse().map((r) => (
                <tr key={r.date} data-testid="daily-row" data-date={r.date}>
                  <td className="bg-card sticky left-0 px-3 py-2 whitespace-nowrap">
                    <Link href={`/?tab=daily&day=${r.date}`} className="text-primary">
                      {date(r.date, "short")}
                    </Link>
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className="tabular px-3 py-2 text-right whitespace-nowrap">
                      {cell(c.kind, r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t font-semibold">
              <tr data-testid="daily-total">
                <td className="bg-card sticky left-0 px-3 py-2">{t("dly.total")}</td>
                {cols.map((c) => (
                  <td key={c.key} className="tabular px-3 py-2 text-right whitespace-nowrap">
                    {c.total === "sum"
                      ? cell(c.kind, sum(c.key))
                      : last
                        ? cell(c.kind, last[c.key])
                        : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

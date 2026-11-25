"use client";

/**
 * Purchase vs Sales by day (requirement_v2 §12.1A): rounded bars in the palette, soft grid,
 * grow-in animation (off with reduced motion), tooltip; tapping a day opens that day's entries.
 * Loaded lazily (recharts never sits on the start-up path). Values are whole rupees for drawing
 * only; the tooltip shows the exact amounts.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/i18n/I18nProvider";

export interface SeriesPoint {
  date: string;
  purchasePaise: bigint;
  salesPaise: bigint;
}

const toRupees = (p: bigint) => Number(p / 100n); // display scale only (bar height)

export default function PurchaseSalesChart({
  series,
  onDay,
}: {
  series: readonly SeriesPoint[];
  onDay: (date: string) => void;
}) {
  const { t, money, date } = useI18n();
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const data = series.map((s) => ({
    date: s.date,
    label: date(s.date, "short").split(" ").slice(0, 2).join(" "),
    purchase: toRupees(s.purchasePaise),
    sales: toRupees(s.salesPaise),
    p: s.purchasePaise,
    s: s.salesPaise,
  }));
  return (
    <div className="h-56 w-full" data-testid="purchase-sales-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
          onClick={(e) => {
            const i = e?.activeTooltipIndex;
            const idx = typeof i === "number" ? i : Number(i);
            const row = Number.isInteger(idx) ? data[idx] : undefined;
            if (row) onDay(row.date);
          }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            interval="preserveStartEnd"
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={({ active, payload }) => {
              const row =
                active && payload?.[0] ? (payload[0].payload as (typeof data)[number]) : null;
              if (!row) return null;
              return (
                <div className="bg-card shadow-lift rounded-xl border p-2.5 text-xs">
                  <p className="mb-1 font-medium">{date(row.date, "short")}</p>
                  <p className="tabular">
                    <span className="bg-gold mr-1.5 inline-block size-2 rounded-full" />
                    {t("dsh.chartPurchase")}: {money(row.p)}
                  </p>
                  <p className="tabular">
                    <span className="bg-primary mr-1.5 inline-block size-2 rounded-full" />
                    {t("dsh.chartSales")}: {money(row.s)}
                  </p>
                </div>
              );
            }}
          />
          <Bar
            dataKey="purchase"
            name={t("dsh.chartPurchase")}
            fill="var(--color-gold, #C9A227)"
            radius={[6, 6, 0, 0]}
            maxBarSize={28}
            isAnimationActive={!reduced}
            animationDuration={350}
          />
          <Bar
            dataKey="sales"
            name={t("dsh.chartSales")}
            fill="var(--primary)"
            radius={[6, 6, 0, 0]}
            maxBarSize={28}
            isAnimationActive={!reduced}
            animationDuration={350}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

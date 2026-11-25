"use client";

/**
 * Bar chart for a report (requirement_v2 §13, §15.2): rounded bars in the palette, soft grid,
 * grow-in (off with reduced motion), tooltip with the exact amounts. Loaded lazily, so recharts is
 * never on the start-up path. Bar heights use whole rupees for drawing only.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/i18n/I18nProvider";

const COLOURS = ["var(--primary)", "var(--color-gold, #C9A227)"];
const toRupees = (p: bigint) => Number(p / 100n); // display scale only (bar height)

export default function ReportChart({
  labels,
  series,
}: {
  labels: readonly string[];
  series: ReadonlyArray<{ name: string; values: readonly bigint[] }>;
}) {
  const { money, date } = useI18n();
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const data = labels.map((l, i) => ({
    label: isDate(l) ? date(l, "short").split(" ").slice(0, 2).join(" ") : l,
    full: isDate(l) ? date(l, "short") : l,
    ...Object.fromEntries(series.map((s, j) => [`s${j}`, toRupees(s.values[i] ?? 0n)])),
    exact: series.map((s) => s.values[i] ?? 0n),
  }));
  return (
    <div className="h-56 w-full" data-testid="report-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
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
                  <p className="mb-1 font-medium">{row.full}</p>
                  {series.map((s, j) => (
                    <p key={s.name} className="tabular">
                      <span
                        className="mr-1.5 inline-block size-2 rounded-full"
                        style={{ background: COLOURS[j % COLOURS.length] }}
                      />
                      {s.name}: {money(row.exact[j] ?? 0n)}
                    </p>
                  ))}
                </div>
              );
            }}
          />
          {series.map((s, j) => (
            <Bar
              key={s.name}
              dataKey={`s${j}`}
              name={s.name}
              fill={COLOURS[j % COLOURS.length]}
              radius={[6, 6, 0, 0]}
              maxBarSize={28}
              isAnimationActive={!reduced}
              animationDuration={350}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

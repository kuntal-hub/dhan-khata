"use client";

/**
 * Grouped bar chart (recharts, lazy). Rounded 4 px data-ends on the baseline, a 2 px gap between
 * neighbouring bars, a zero line when values go negative, a hover / tap tooltip with the exact
 * amounts, and a legend for two or more series. Whole rupees for drawing only.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/i18n/I18nProvider";

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

export interface BarRow {
  key: string;
  label: string;
  values: Record<string, bigint>;
}

const toRupees = (p: bigint) => Number(p / 100n); // display scale only

export default function BarsChart({
  rows,
  series,
  testId,
  height = 220,
}: {
  rows: readonly BarRow[];
  series: readonly BarSeries[];
  testId?: string;
  height?: number;
}) {
  const { money } = useI18n();
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const data = rows.map((r) => {
    const o: Record<string, number | string> = { label: r.label };
    for (const s of series) o[s.key] = toRupees(r.values[s.key] ?? 0n);
    return o;
  });
  const negative = data.some((d) => series.some((s) => (d[s.key] as number) < 0));
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((s) => (
            <li key={s.key} className="text-muted-foreground flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              interval="preserveStartEnd"
              tick={{ fill: "var(--muted-foreground)" }}
            />
            <YAxis hide />
            {negative ? <ReferenceLine y={0} stroke="var(--muted-foreground)" /> : null}
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={({ active, payload }) => {
                const idx = data.findIndex((d) => d === payload?.[0]?.payload);
                const row = active && idx >= 0 ? rows[idx] : undefined;
                if (!row) return null;
                return (
                  <div className="bg-card shadow-lift rounded-xl border p-2.5 text-xs">
                    <p className="mb-1 font-semibold">{row.label}</p>
                    {series.map((s) => (
                      <p key={s.key} className="tabular flex items-center gap-1.5">
                        <span
                          className="inline-block size-2 rounded-full"
                          style={{ background: s.color }}
                        />
                        <span className="text-muted-foreground">{s.label}:</span>
                        <span className="font-semibold">{money(row.values[s.key] ?? 0n)}</span>
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                radius={[4, 4, 0, 0]}
                maxBarSize={26}
                isAnimationActive={!reduced}
                animationDuration={600}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

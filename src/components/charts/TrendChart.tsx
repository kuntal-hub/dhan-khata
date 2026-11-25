"use client";

/**
 * Smooth area / line trend (recharts, loaded lazily: never on the start-up path). Thin 2 px lines
 * with a soft gradient wash, a recessive dashed grid, one shared y-axis (no dual axes), a
 * crosshair + tooltip with the exact amounts, and a legend for two or more series. Values are
 * whole rupees for drawing only; the tooltip shows exact paise-formatted amounts.
 */
import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/i18n/I18nProvider";

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
}

export interface TrendRow {
  date: string;
  values: Record<string, bigint>;
}

const toRupees = (p: bigint) => Number(p / 100n); // display scale only

/** Short axis tick: 1.2L / 35K style, in the active digits (display only). */
function useCompact() {
  const { count, t } = useI18n();
  // One decimal from whole tenths (count() takes integers only).
  const tenths = (n: number) => {
    const x = Math.round(n);
    return x % 10 === 0 ? count(x / 10) : `${count(Math.floor(x / 10))}.${count(x % 10)}`;
  };
  return (v: number) => {
    const a = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (a >= 10_000_000) return `${sign}${tenths(a / 1_000_000)}${t("viz.cr")}`;
    if (a >= 100_000) return `${sign}${tenths(a / 10_000)}${t("viz.l")}`;
    if (a >= 1000) return `${sign}${count(Math.round(a / 1000))}${t("viz.k")}`;
    return `${sign}${count(Math.round(a))}`;
  };
}

export default function TrendChart({
  rows,
  series,
  testId,
  height = 220,
  onDay,
}: {
  rows: readonly TrendRow[];
  series: readonly TrendSeries[];
  testId?: string;
  height?: number;
  onDay?: (date: string) => void;
}) {
  const { money, date } = useI18n();
  const compact = useCompact();
  const uid = useId().replace(/:/g, "");
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const data = rows.map((r) => {
    const o: Record<string, number | string | bigint> = {
      date: r.date,
      label: date(r.date, "short").split(" ").slice(0, 2).join(" "),
    };
    for (const s of series) o[s.key] = toRupees(r.values[s.key] ?? 0n);
    return o;
  });
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((s) => (
            <li key={s.key} className="text-muted-foreground flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 6, bottom: 0, left: -6 }}
            onClick={(e) => {
              if (!onDay) return;
              const i = e?.activeTooltipIndex;
              const idx = typeof i === "number" ? i : Number(i);
              const row = Number.isInteger(idx) ? rows[idx] : undefined;
              if (row) onDay(row.date);
            }}
          >
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              minTickGap={18}
              tick={{ fill: "var(--muted-foreground)" }}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickFormatter={compact}
              tick={{ fill: "var(--muted-foreground)" }}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const idx = data.findIndex((d) => d === payload?.[0]?.payload);
                const row = active && idx >= 0 ? rows[idx] : undefined;
                if (!row) return null;
                return (
                  <div className="bg-card shadow-lift rounded-xl border p-2.5 text-xs">
                    <p className="mb-1 font-semibold">{date(row.date, "short")}</p>
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
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#${uid}-${s.key})`}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={!reduced}
                animationDuration={900}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

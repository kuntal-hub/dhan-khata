"use client";

/**
 * Bar chart for reports (spec §15: recharts lives ONLY in this lazily loaded chunk). Values are
 * converted to whole rupees for drawing only; every figure shown as text stays exact.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportChart as Chart } from "@/client/reports/model";
import { useI18n } from "@/i18n/I18nProvider";

const COLORS = ["#15803d", "#b45309", "#1d4ed8"];

export default function ReportChart({ chart }: { chart: Chart }) {
  const { money } = useI18n();
  const data = chart.labels.map((label, i) => {
    const row: Record<string, string | number> = { label };
    for (const s of chart.series) {
      // Chart geometry only (rupees, truncated): never used for any displayed amount.
      row[s.name] = Number((s.values[i] ?? 0n) / 100n);
    }
    return row;
  });
  return (
    <div className="h-64 w-full" data-testid="report-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis width={60} />
          <Tooltip formatter={(v) => money(BigInt(Math.trunc(Number(v))) * 100n)} />
          <Legend />
          {chart.series.map((s, i) => (
            <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

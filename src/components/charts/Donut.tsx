"use client";

/**
 * Donut chart (pure SVG, no chart library): slices draw in clockwise on mount (stroke-dashoffset,
 * off with reduced motion), a 2 px surface gap between slices, and the centre shows the total or
 * the tapped / hovered slice. A legend with label, exact amount and share sits beside it, so
 * identity is never colour alone. Colours come from the validated categorical order
 * (`--chart-1…8`); the caller keeps each entity's position stable. More than 7 slices fold into
 * "Other" (neutral grey). Geometry uses whole basis points (display only, never money math).
 */
import { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

export interface DonutItem {
  key: string;
  label: string;
  /** Non-negative magnitude (paise, grams, …); only the shares are drawn. */
  value: bigint;
  /** Exact value text for the legend and centre (already formatted). */
  display: string;
  /** Override colour (CSS colour); default = categorical slot by position. */
  color?: string;
}

const SLOTS = 7;
const OTHER = "var(--muted-foreground)";
export const chartColor = (i: number) => `var(--chart-${(i % 8) + 1})`;

export function Donut({
  items,
  total,
  centerLabel,
  otherLabel,
  testId,
  size = 168,
}: {
  items: readonly DonutItem[];
  /** Formatted total for the centre. */
  total: string;
  centerLabel: string;
  /** Label for the folded tail (> 7 slices). */
  otherLabel?: string;
  testId?: string;
  size?: number;
}) {
  const { count } = useI18n();
  const [active, setActive] = useState<string | null>(null);
  const positive = items.filter((i) => i.value > 0n);
  const shown: Array<DonutItem & { color: string }> = positive
    .slice(0, SLOTS)
    .map((it, i) => ({ ...it, color: it.color ?? chartColor(i) }));
  if (positive.length > SLOTS) {
    const rest = positive.slice(SLOTS);
    shown.push({
      key: "__other",
      label: otherLabel ?? "",
      value: rest.reduce((s, r) => s + r.value, 0n),
      display: "",
      color: OTHER,
    });
  }
  const sum = shown.reduce((s, r) => s + r.value, 0n);
  if (sum <= 0n) return null;

  const r = 42;
  const C = 2 * Math.PI * r; // float-ok: SVG geometry, not money
  const gap = shown.length > 1 ? 1.6 : 0;
  const bpsOf = shown.map((it) => Number((it.value * 10_000n) / sum)); // display only
  const arcs = shown.map((it, i) => {
    const bps = bpsOf[i]!;
    const offset = (bpsOf.slice(0, i).reduce((s, b) => s + b, 0) / 10_000) * C;
    const len = (bps / 10_000) * C;
    return { it, bps, offset, len: Math.max(0, len - gap) };
  });
  const focus = arcs.find((a) => a.it.key === active);
  const pct = (bps: number) => `${count(Math.round(bps / 100))}%`;

  return (
    <div
      className="flex flex-col items-center gap-4 min-[420px]:flex-row min-[420px]:items-center"
      data-testid={testId}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--muted)" strokeWidth="12" />
          {arcs.map((a, i) => (
            <circle
              key={a.it.key}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={a.it.color}
              strokeWidth={active === a.it.key ? 15 : 12}
              strokeDasharray={`${a.len} ${C - a.len}`}
              strokeDashoffset={-a.offset}
              className="cursor-pointer transition-[stroke-width,opacity] duration-200"
              style={{
                opacity: active && active !== a.it.key ? 0.35 : 1,
                animation: `dg-donut 900ms var(--ease-premium) ${i * 70}ms backwards`,
              }}
              onMouseEnter={() => setActive(a.it.key)}
              onMouseLeave={() => setActive(null)}
              onClick={() => setActive((k) => (k === a.it.key ? null : a.it.key))}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <span className="text-muted-foreground line-clamp-1 text-[11px] leading-tight font-medium">
            {focus ? focus.it.label : centerLabel}
          </span>
          <span className="tabular text-[15px] leading-tight font-bold">
            {focus ? focus.it.display || pct(focus.bps) : total}
          </span>
          {focus ? (
            <span className="text-muted-foreground tabular text-[11px]">{pct(focus.bps)}</span>
          ) : null}
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-1 flex-col gap-1">
        {arcs.map((a) => (
          <li key={a.it.key}>
            <button
              type="button"
              onClick={() => setActive((k) => (k === a.it.key ? null : a.it.key))}
              aria-pressed={active === a.it.key}
              className={cn(
                "flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
                active === a.it.key ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <span
                className="size-3 shrink-0 rounded-[4px]"
                style={{ background: a.it.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{a.it.label}</span>
              {a.it.display ? (
                <span className="tabular shrink-0 font-semibold">{a.it.display}</span>
              ) : null}
              <span className="text-muted-foreground tabular w-10 shrink-0 text-right text-xs">
                {pct(a.bps)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Donut;

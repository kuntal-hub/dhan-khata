"use client";

/**
 * Dashboard date filter (requirement_v2 §12.1): আজ, গতকাল, এই সপ্তাহ (Mon–Sun), এই মাস, custom.
 * Kept for the session (sessionStorage) so Overview and Daily Overview share it.
 */
import { useSyncExternalStore } from "react";
import { addDays, parseYmd, todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

export type Preset = "today" | "yesterday" | "week" | "month" | "custom";
export interface DashRange {
  preset: Preset;
  from: string;
  to: string;
}

const KEY = "dg.dashRange.v1";
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: DashRange } | null = null;

/** Monday of the week of `ymd` (IST calendar). */
function monday(ymd: string): string {
  const { y, m, d } = parseYmd(ymd);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

export function rangeOf(preset: Preset, today = todayIST()): { from: string; to: string } {
  switch (preset) {
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "week":
      return { from: monday(today), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    default:
      return { from: today, to: today };
  }
}

function read(): DashRange {
  const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(KEY);
  if (cache && cache.raw === raw) return cache.value;
  let value: DashRange = { preset: "today", ...rangeOf("today") };
  try {
    const p = raw ? (JSON.parse(raw) as DashRange) : null;
    if (p && p.preset === "custom" && p.from && p.to) value = p;
    else if (p && p.preset) value = { preset: p.preset, ...rangeOf(p.preset) };
  } catch {
    // keep the default
  }
  cache = { raw, value };
  return value;
}

export function setDashRange(r: DashRange): void {
  sessionStorage.setItem(KEY, JSON.stringify(r));
  for (const l of listeners) l();
}

export function useDashRange(): DashRange {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    read,
  );
}

const PRESETS: readonly Preset[] = ["today", "yesterday", "week", "month", "custom"];

export function RangeBar() {
  const { t } = useI18n();
  const r = useDashRange();
  const today = todayIST();
  return (
    <div className="flex flex-col gap-2" data-testid="dash-range">
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={r.preset === p}
            data-testid={`dash-range-${p}`}
            onClick={() =>
              setDashRange(
                p === "custom" ? { ...r, preset: "custom" } : { preset: p, ...rangeOf(p) },
              )
            }
            className={cn(
              "press min-h-10 shrink-0 rounded-full border px-4 text-sm",
              r.preset === p ? "bg-primary text-primary-foreground border-primary" : "bg-card",
            )}
          >
            {t(`dsh.range.${p}`)}
          </button>
        ))}
      </div>
      {r.preset === "custom" ? (
        <div className="flex flex-wrap gap-2">
          <label className="bg-card flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm">
            {t("dsh.from")}
            <input
              type="date"
              className="bg-transparent"
              value={r.from}
              max={r.to}
              onChange={(e) => e.target.value && setDashRange({ ...r, from: e.target.value })}
              data-testid="dash-from"
            />
          </label>
          <label className="bg-card flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm">
            {t("dsh.to")}
            <input
              type="date"
              className="bg-transparent"
              value={r.to}
              min={r.from}
              max={today}
              onChange={(e) => e.target.value && setDashRange({ ...r, to: e.target.value })}
              data-testid="dash-to"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

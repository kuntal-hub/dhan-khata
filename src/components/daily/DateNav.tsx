"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDays, todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

/** ◀ date ▶ selector (spec §9.1): browse past days; never beyond today. */
export function DateNav({
  value,
  onChange,
  testId = "date-nav",
}: {
  value: string;
  onChange: (date: string) => void;
  testId?: string;
}) {
  const { t, date } = useI18n();
  const today = todayIST();
  return (
    <div className="flex items-center gap-1" data-testid={testId}>
      <Button
        variant="outline"
        size="icon"
        className="size-11"
        aria-label={t("dash.prevDay")}
        onClick={() => onChange(addDays(value, -1))}
        data-testid={`${testId}-prev`}
      >
        <ChevronLeft className="size-5" aria-hidden />
      </Button>
      <label className="relative flex min-h-11 flex-1 items-center justify-center rounded-md border px-2 text-sm font-medium">
        <span data-testid={`${testId}-label`} data-date={value}>
          {value === today ? `${t("common.today")} · ${date(value, "short")}` : date(value)}
        </span>
        <input
          type="date"
          className="absolute inset-0 opacity-0"
          value={value}
          max={today}
          aria-label={t("common.date")}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
      </label>
      <Button
        variant="outline"
        size="icon"
        className="size-11"
        aria-label={t("dash.nextDay")}
        disabled={value >= today}
        onClick={() => onChange(addDays(value, 1))}
        data-testid={`${testId}-next`}
      >
        <ChevronRight className="size-5" aria-hidden />
      </Button>
    </div>
  );
}

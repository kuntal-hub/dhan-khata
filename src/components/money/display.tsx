"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

/** Formatted money (tabular, right-aligned by the caller). `tone` adds colour AND text sign. */
export function Money({
  paise,
  className,
  testId,
}: {
  paise: bigint;
  className?: string;
  testId?: string;
}) {
  const { money } = useI18n();
  return (
    <span className={cn("tabular", className)} data-testid={testId} data-paise={paise.toString()}>
      {money(paise)}
    </span>
  );
}

export function Qty({
  grams,
  className,
  testId,
}: {
  grams: bigint;
  className?: string;
  testId?: string;
}) {
  const { weightOf } = useI18n();
  return (
    <span className={cn("tabular", className)} data-testid={testId} data-grams={grams.toString()}>
      {weightOf(grams)}
    </span>
  );
}

/**
 * Party balance with colour AND words (never colour alone, spec §11.1):
 * > 0 পাওনা (green), < 0 দেনা (red), 0 = settled.
 */
export function Balance({ paise, testId }: { paise: bigint; testId?: string }) {
  const { t, money } = useI18n();
  if (paise === 0n) {
    return (
      <span className="text-muted-foreground tabular" data-testid={testId} data-paise="0">
        {t("due.settledBalance")}
      </span>
    );
  }
  const receivable = paise > 0n;
  return (
    <span
      className={cn(
        "tabular font-medium",
        receivable ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
      )}
      data-testid={testId}
      data-paise={paise.toString()}
    >
      {receivable ? t("due.receivable") : t("due.payable")} {money(receivable ? paise : -paise)}
    </span>
  );
}

/** A computed value that shows its formula when tapped (spec §11.3). */
export function Computed({
  label,
  value,
  formula,
  testId,
  large,
}: {
  label: string;
  value: string;
  formula?: string;
  testId?: string;
  large?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className="flex min-h-11 w-full min-w-0 flex-col items-start rounded-md text-left"
      onClick={() => formula && setOpen((o) => !o)}
      aria-expanded={formula ? open : undefined}
      title={formula ? t("form.tapForFormula") : undefined}
    >
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={cn("tabular font-semibold", large ? "text-xl" : "text-base")}
        data-testid={testId}
      >
        {value}
      </span>
      {open && formula ? (
        <span className="text-muted-foreground tabular text-xs">{formula}</span>
      ) : null}
    </button>
  );
}

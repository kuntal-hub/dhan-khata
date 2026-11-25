"use client";

/**
 * Dhan Gola UI kit (requirement_v2 §15.2, §15.6): metric cards (count-up), transaction cards,
 * status pills, three-unit quantity, empty state, delayed skeleton. White cards on ivory,
 * rounded-2xl, warm borders, soft shadow; money green in / red out, always with words or signs.
 */
import Link from "next/link";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { StaggerItem, useCountUp } from "@/components/motion/Motion";
import { formatWeightNumber } from "@/domain/units";
import { useBusiness } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

export type MetricValue =
  { kind: "money"; paise: bigint } | { kind: "qty"; grams: bigint } | { kind: "count"; n: bigint };

/** Big count-up number + label + sub-line; tap → drill-down (`href`) or `onClick`. */
export function MetricCard({
  icon: IconC,
  label,
  value,
  sub,
  tone = "green",
  href,
  onClick,
  testId,
  index = 0,
}: {
  icon: Icon;
  label: string;
  value: MetricValue;
  sub?: ReactNode;
  tone?: "green" | "gold" | "in" | "out" | "warn";
  href?: string;
  onClick?: () => void;
  testId?: string;
  index?: number;
}) {
  const { t, money, count, digits } = useI18n();
  const business = useBusiness();
  const raw = value.kind === "money" ? value.paise : value.kind === "qty" ? value.grams : value.n;
  const shown = useCountUp(raw);
  const text =
    value.kind === "money"
      ? money(shown)
      : value.kind === "qty"
        ? formatWeightNumber(shown, "QTL", { digits, monKg: business?.monKg })
        : count(shown);
  const tile =
    tone === "gold"
      ? "bg-gold-100 text-gold-600"
      : tone === "in"
        ? "bg-emerald-50 text-emerald-700"
        : tone === "out"
          ? "bg-red-50 text-red-700"
          : tone === "warn"
            ? "bg-amber-50 text-amber-700"
            : "bg-forest-100 text-forest";
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("flex size-10 items-center justify-center rounded-xl", tile)}>
          <IconC className="size-5" strokeWidth={1.75} />
        </span>
        {href || onClick ? (
          <ChevronRight className="text-muted-foreground/60 size-4" aria-hidden />
        ) : null}
      </div>
      <span className="text-muted-foreground mt-3 text-sm leading-snug">{label}</span>
      <span
        className="tabular mt-0.5 text-[26px] leading-tight font-semibold tracking-tight sm:text-[28px]"
        data-testid={testId}
        data-value={raw.toString()}
      >
        {text}
        {value.kind === "qty" ? (
          <span className="text-muted-foreground ml-1 text-sm font-normal">
            {t("ui.unitQtlShort")}
          </span>
        ) : null}
      </span>
      {sub ? <span className="text-muted-foreground mt-1 text-xs">{sub}</span> : null}
    </>
  );
  const cls =
    "press lift bg-card flex min-h-[132px] flex-col rounded-2xl border p-4 text-left shadow-card transition-shadow";
  return (
    <StaggerItem i={index}>
      {href ? (
        <Link href={href} className={cls}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(cls, "w-full")}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </StaggerItem>
  );
}

/** A quantity in quintals; tap to see kg / quintal / mon (§6.2). */
export function QtyTriple({
  grams,
  className,
  testId,
}: {
  grams: bigint;
  className?: string;
  testId?: string;
}) {
  const { t, digits } = useI18n();
  const business = useBusiness();
  const [open, setOpen] = useState(false);
  const o = { digits, monKg: business?.monKg };
  return (
    <button
      type="button"
      onClick={() => setOpen((x) => !x)}
      aria-expanded={open}
      title={t("ui.tapForUnits")}
      className={cn("tabular inline-flex min-h-8 flex-col items-start text-left", className)}
      data-testid={testId}
      data-grams={grams.toString()}
    >
      <span>
        {formatWeightNumber(grams, "QTL", o)} {t("ui.unitQtlShort")}
      </span>
      {open ? (
        <span className="text-muted-foreground text-xs">
          {formatWeightNumber(grams, "KG", o)} {t("ui.unitKg")} ·{" "}
          {formatWeightNumber(grams, "QTL", o)} {t("ui.unitQtlShort")} ·{" "}
          {formatWeightNumber(grams, "MON", o)} {t("ui.unitMon")}
        </span>
      ) : null}
    </button>
  );
}

export type PillStatus = "PAID" | "PARTIAL" | "UNPAID" | "OVERDUE" | "VOID" | "ORDER" | "CONFIRMED";

export function StatusPill({ status }: { status: PillStatus }) {
  const { t } = useI18n();
  const cls: Record<PillStatus, string> = {
    PAID: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
    PARTIAL: "bg-amber-50 text-amber-800 ring-amber-600/20",
    UNPAID: "bg-red-50 text-red-800 ring-red-600/15",
    OVERDUE: "bg-red-100 text-red-900 ring-red-700/25",
    VOID: "bg-muted text-muted-foreground ring-border line-through",
    ORDER: "bg-gold-100 text-accent-foreground ring-gold/30",
    CONFIRMED: "bg-forest-100 text-forest ring-forest/20",
  };
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ring-1 ring-inset",
        cls[status],
      )}
    >
      {t(`ui.status.${status}` as TKey)}
    </span>
  );
}

/** Mobile list row for any transaction (§15.2). Amount: green = in, red = out. */
export function TxnCard({
  icon: IconC,
  tone = "green",
  title,
  subtitle,
  date,
  amountPaise,
  direction,
  status,
  href,
  index = 0,
  testId,
  extra,
}: {
  icon: Icon;
  tone?: "green" | "gold" | "in" | "out";
  title: string;
  subtitle?: string;
  date?: string;
  amountPaise?: bigint;
  direction?: "IN" | "OUT";
  status?: PillStatus;
  href?: string;
  index?: number;
  testId?: string;
  extra?: ReactNode;
}) {
  const { money } = useI18n();
  const tile =
    tone === "gold"
      ? "bg-gold-100 text-gold-600"
      : tone === "in"
        ? "bg-emerald-50 text-emerald-700"
        : tone === "out"
          ? "bg-red-50 text-red-700"
          : "bg-forest-100 text-forest";
  const body = (
    <>
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", tile)}>
        <IconC className="size-5" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium">{title}</span>
        {subtitle ? (
          <span className="text-muted-foreground truncate text-sm">{subtitle}</span>
        ) : null}
        {date ? <span className="text-muted-foreground text-xs">{date}</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {amountPaise !== undefined ? (
          <span
            className={cn(
              "tabular text-[15px] font-semibold",
              direction === "IN" ? "text-money-in" : direction === "OUT" ? "text-money-out" : "",
              status === "VOID" && "text-muted-foreground line-through",
            )}
          >
            {direction === "IN" ? "+" : direction === "OUT" ? "−" : ""}
            {money(amountPaise)}
          </span>
        ) : null}
        {status ? <StatusPill status={status} /> : null}
        {extra}
      </span>
    </>
  );
  const cls =
    "press lift bg-card flex min-h-[72px] items-center gap-3 rounded-2xl border px-3 py-3 shadow-card";
  return (
    <StaggerItem i={index}>
      {href ? (
        <Link href={href} className={cls} data-testid={testId}>
          {body}
        </Link>
      ) : (
        <div className={cls} data-testid={testId}>
          {body}
        </div>
      )}
    </StaggerItem>
  );
}

/** Friendly empty state with the primary action (§15.6). */
export function EmptyState({
  icon: IconC,
  title,
  hint,
  action,
  testId = "empty-state",
}: {
  icon: Icon;
  title: string;
  hint?: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="bg-card/60 flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center"
      data-testid={testId}
    >
      <span className="bg-gold-100 text-gold-600 flex size-16 items-center justify-center rounded-2xl">
        <IconC className="size-8" strokeWidth={1.5} />
      </span>
      <p className="text-base font-medium">{title}</p>
      {hint ? <p className="text-muted-foreground max-w-sm text-sm">{hint}</p> : null}
      {action}
    </div>
  );
}

/** Skeleton blocks, shown only if loading takes longer than 150 ms (§15.3). */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShow(true), 150);
    return () => window.clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-[72px] rounded-2xl" />
      ))}
    </div>
  );
}

/** Section card with a title row. */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-card shadow-card rounded-2xl border p-4", className)}>
      {title || action ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

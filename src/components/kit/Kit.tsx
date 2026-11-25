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
export type Tone = "green" | "gold" | "in" | "out" | "warn" | "blue" | "violet";

/** Empty-state art: the icon on layered accent rings with a few floating grains. */
export function EmptyArt({ icon: IconC, small = false }: { icon: Icon; small?: boolean }) {
  return (
    <span
      className={cn(
        "tone-gold relative flex items-center justify-center",
        small ? "size-20" : "size-28",
      )}
      aria-hidden
    >
      <span className="bg-accent-grad absolute inset-0 rounded-full opacity-10" />
      <span className="bg-accent-grad absolute inset-[14%] rounded-full opacity-15" />
      <span
        className={cn(
          "tile-accent anim-pop relative flex items-center justify-center rounded-[1.25rem]",
          small ? "size-11" : "size-14",
        )}
      >
        <IconC className={small ? "size-5" : "size-7"} strokeWidth={1.8} />
      </span>
      <span className="bg-gold anim-pop absolute top-[12%] left-[16%] size-2 rounded-full [animation-delay:120ms]" />
      <span className="anim-pop absolute top-[22%] right-[10%] size-1.5 rounded-full bg-emerald-500 [animation-delay:200ms]" />
      <span className="anim-pop absolute bottom-[14%] left-[24%] size-1.5 rounded-full bg-sky-500 [animation-delay:260ms]" />
    </span>
  );
}

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
  tone?: Tone;
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
  const body = (
    <>
      <span
        className="pointer-events-none absolute -top-10 -right-10 size-28 rounded-full bg-[radial-gradient(closest-side,var(--sb),transparent)] opacity-25"
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-2">
        <span className="tile-accent flex size-11 items-center justify-center rounded-2xl">
          <IconC className="size-5" strokeWidth={2} />
        </span>
        {href || onClick ? (
          <span className="bg-muted text-muted-foreground group-hover:bg-accent-grad flex size-7 items-center justify-center rounded-full transition-colors group-hover:text-white">
            <ChevronRight className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <span className="text-muted-foreground relative mt-3 text-sm leading-snug font-medium">
        {label}
      </span>
      <span
        className="tabular relative mt-0.5 text-[24px] leading-tight font-bold tracking-tight min-[400px]:text-[26px] sm:text-[28px]"
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
      {sub ? <span className="text-muted-foreground relative mt-1 text-xs">{sub}</span> : null}
      <span
        className="bg-accent-grad anim-grow-x absolute inset-x-0 bottom-0 h-[3px] opacity-80"
        aria-hidden
      />
    </>
  );
  const cls = cn(
    "press lift group bg-card shadow-card relative flex min-h-[136px] flex-col overflow-hidden rounded-[1.25rem] border p-4 text-left",
    `tone-${tone}`,
  );
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
    PAID: "bg-emerald-50 text-emerald-800 ring-emerald-600/25 dark:bg-emerald-950/60 dark:text-emerald-300",
    PARTIAL:
      "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-950/60 dark:text-amber-300",
    UNPAID: "bg-rose-50 text-rose-800 ring-rose-600/20 dark:bg-rose-950/60 dark:text-rose-300",
    OVERDUE: "bg-red-600 text-white ring-red-700/40",
    VOID: "bg-muted text-muted-foreground ring-border line-through",
    ORDER: "bg-gold-100 text-accent-foreground ring-gold/40",
    CONFIRMED: "bg-sky-50 text-sky-800 ring-sky-600/25 dark:bg-sky-950/60 dark:text-sky-300",
  };
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset",
        cls[status],
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden />
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
  tone?: Tone;
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
  const body = (
    <>
      <span
        className={cn(
          "tile-accent flex size-11 shrink-0 items-center justify-center rounded-2xl",
          `tone-${tone}`,
        )}
      >
        <IconC className="size-5" strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold">{title}</span>
        {subtitle ? (
          <span className="text-muted-foreground truncate text-sm">{subtitle}</span>
        ) : null}
        {date ? <span className="text-muted-foreground text-xs">{date}</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {amountPaise !== undefined ? (
          <span
            className={cn(
              "tabular text-base font-bold",
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
    "press lift bg-card shadow-card flex min-h-[76px] items-center gap-3 rounded-[1.25rem] border px-3 py-3";
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
      className="bg-card/70 anim-zoom flex flex-col items-center gap-3 rounded-[1.5rem] border border-dashed px-6 py-12 text-center"
      data-testid={testId}
    >
      <EmptyArt icon={IconC} />
      <p className="text-base font-semibold">{title}</p>
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
        <div key={i} className="skeleton h-[76px] rounded-[1.25rem]" />
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
  icon: IconC,
  tone = "green",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: Icon;
  tone?: Tone;
}) {
  return (
    <section
      className={cn(
        "bg-card shadow-card anim-rise min-w-0 rounded-[1.25rem] border p-4 sm:p-5",
        `tone-${tone}`,
        className,
      )}
    >
      {title || action ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h2 className="flex min-w-0 items-center gap-2.5 text-lg font-bold">
              {IconC ? (
                <span className="tile-accent flex size-8 shrink-0 items-center justify-center rounded-xl">
                  <IconC className="size-4" strokeWidth={2.2} />
                </span>
              ) : (
                <span className="bg-accent-grad h-5 w-1.5 shrink-0 rounded-full" aria-hidden />
              )}
              <span className="min-w-0">{title}</span>
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

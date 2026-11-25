"use client";

/**
 * Dashboard → সারাংশ (requirement_v2 §12.1A). Date filter (আজ / গতকাল / এই সপ্তাহ / এই মাস / custom)
 * for the active Gola or all Golas combined (read-only sum). Balances = position at the end of the
 * range; flows = totals within it. Metric cards (count-up), purchase vs sales chart (tap → that
 * day), money flow (cash / bank), stock summary by variety, recent transactions, due alerts with
 * WhatsApp, low-stock alerts, quick actions. Loaded lazily from the Home page.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  BellRing,
  Clock,
  Factory,
  Landmark,
  Package,
  PieChart,
  Receipt,
  Scale,
  ShoppingCart,
  TrendingUp,
  Truck,
  Wallet,
  Wheat,
  HandCoins,
  Zap,
} from "lucide-react";
import { useCountUp } from "@/components/motion/Motion";
import { Donut } from "@/components/charts/Donut";
import { LazyTrendChart } from "@/components/charts/lazy";
import { docPath } from "@/components/entry/docPath";
import { docTitle, timeIST } from "@/components/entry/docLabel";
import { MetricCard, Panel, Skeleton, TxnCard } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { QUICK_ACTIONS, SECTION_OF } from "@/components/shell/QuickAdd";
import { useWriteGodown } from "@/components/system/page";
import { varietyName } from "@/components/entry/Variety";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import {
  alertsFor,
  overviewFor,
  recentFor,
  trendFor,
} from "@/client/queries/consolidated/dashboard";
import type { FlowSummary, TrendPoint } from "@/client/queries/dashboard";
import { diffDays, todayIST } from "@/domain/dates";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { RangeBar, useDashRange } from "./range";

const PurchaseSalesChart = dynamic(() => import("./PurchaseSalesChart"), {
  ssr: false,
  loading: () => <div className="bg-muted/40 h-56 animate-pulse rounded-xl" />,
});

function pct(v: bigint, max: bigint): number {
  if (max <= 0n) return 0;
  const a = v < 0n ? -v : v;
  return Number((a * 100n) / max); // bar width (display only)
}

function FlowPanel({ cash, bank }: { cash: FlowSummary; bank: FlowSummary }) {
  const { t, money } = useI18n();
  const [which, setWhich] = useState<"cash" | "bank">("cash");
  const f = which === "cash" ? cash : bank;
  const rows: Array<[string, bigint, string]> = [
    [t("dsh.opening"), f.openingPaise, "bg-linear-to-r from-slate-300 to-slate-400"],
    [t("dsh.received"), f.receivedPaise, "bg-linear-to-r from-emerald-400 to-emerald-600"],
    [t("dsh.paid"), -f.paidPaise, "bg-linear-to-r from-rose-400 to-rose-600"],
    [t("dsh.spent"), -f.expensesPaise, "bg-linear-to-r from-amber-300 to-orange-500"],
    ...(f.otherPaise !== 0n
      ? ([[t("dsh.other"), f.otherPaise, "bg-linear-to-r from-slate-300 to-slate-500"]] as Array<
          [string, bigint, string]
        >)
      : []),
    [
      t("dsh.closing"),
      f.closingPaise,
      "bg-linear-to-r from-[var(--primary-hi)] to-[var(--primary)]",
    ],
  ];
  const max = rows.reduce((m, r) => {
    const a = r[1] < 0n ? -r[1] : r[1];
    return a > m ? a : m;
  }, 0n);
  return (
    <Panel
      title={t("dsh.cashflow")}
      icon={Activity}
      tone="blue"
      action={
        <div className="seg" role="tablist">
          {(["cash", "bank"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={which === k}
              onClick={() => setWhich(k)}
              className="min-h-9"
            >
              {k === "cash" ? t("dsh.cashTab") : t("dsh.bankTab")}
            </button>
          ))}
        </div>
      }
    >
      <ul className="flex flex-col gap-3" data-testid="cashflow">
        {rows.map(([label, v, color], i) => (
          <li key={label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className={i === rows.length - 1 ? "font-semibold" : "text-muted-foreground"}>
                {label}
              </span>
              <span className={cn("tabular", i === rows.length - 1 && "font-semibold")}>
                {v < 0n ? `− ${money(-v)}` : money(v)}
              </span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className={cn(
                  "anim-grow-x h-full rounded-full transition-[width] duration-500",
                  color,
                )}
                style={{ width: `${pct(v, max)}%`, animationDelay: `${i * 70}ms` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** "Money in hand" hero: cash + bank at the range end, with the range's cash in / out. */
function MoneyHero({
  cash,
  bank,
  cashIn,
  cashOut,
}: {
  cash: bigint;
  bank: bigint;
  cashIn: bigint;
  cashOut: bigint;
}) {
  const { t, money } = useI18n();
  const shown = useCountUp(cash + bank);
  return (
    <div
      className="hero accent-forest anim-zoom rounded-[1.75rem] p-5 sm:p-6"
      data-testid="money-hero"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-white/85">
        <span className="flex size-8 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
          <Wallet className="size-4" aria-hidden />
        </span>
        {t("viz.inHand")}
      </p>
      <p className="tabular mt-2 text-[30px] leading-tight font-bold tracking-tight drop-shadow-sm min-[400px]:text-[34px]">
        {money(shown)}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {(
          [
            [t("dsh.cashTab"), cash, Wallet],
            [t("dsh.bankTab"), bank, Landmark],
          ] as const
        ).map(([label, v, I]) => (
          <Link
            key={label}
            href="/?tab=cashbook"
            className="press flex min-w-0 flex-col rounded-2xl bg-white/12 p-3 ring-1 ring-white/20 hover:bg-white/20"
          >
            <span className="flex items-center gap-1.5 text-xs text-white/80">
              <I className="size-3.5" aria-hidden />
              {label}
            </span>
            <span className="tabular truncate text-base font-bold">{money(v)}</span>
          </Link>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
        <span className="tabular flex items-center gap-1 rounded-full bg-emerald-400/25 px-2.5 py-1 ring-1 ring-emerald-200/30">
          <ArrowDownLeft className="size-3.5" aria-hidden />
          {t("dsh.cashIn")} {money(cashIn)}
        </span>
        <span className="tabular flex items-center gap-1 rounded-full bg-rose-400/25 px-2.5 py-1 ring-1 ring-rose-200/30">
          <ArrowUpRight className="size-3.5" aria-hidden />
          {t("dsh.cashOut")} {money(cashOut)}
        </span>
      </div>
    </div>
  );
}

/** 30-day trend ending at the range end: balances (cash / bank) or trade (purchase / sales). */
function TrendPanel({
  trend,
  onDay,
}: {
  trend: readonly TrendPoint[];
  onDay: (date: string) => void;
}) {
  const { t } = useI18n();
  const [which, setWhich] = useState<"balance" | "trade">("balance");
  const series =
    which === "balance"
      ? [
          { key: "cash", label: t("dsh.cashTab"), color: "var(--chart-1)" },
          { key: "bank", label: t("dsh.bankTab"), color: "var(--chart-3)" },
        ]
      : [
          { key: "purchase", label: t("dsh.chartPurchase"), color: "var(--chart-2)" },
          { key: "sales", label: t("dsh.chartSales"), color: "var(--chart-1)" },
        ];
  const rows = trend.map((p) => ({
    date: p.date,
    values: (which === "balance"
      ? { cash: p.cashPaise, bank: p.bankPaise }
      : { purchase: p.purchasePaise, sales: p.salesPaise }) as Record<string, bigint>,
  }));
  return (
    <Panel
      title={t("viz.trend")}
      icon={TrendingUp}
      tone="green"
      action={
        <div className="seg" role="tablist">
          {(["balance", "trade"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={which === k}
              onClick={() => setWhich(k)}
              className="min-h-9 text-sm"
              data-testid={`trend-${k}`}
            >
              {k === "balance" ? t("viz.balance") : t("viz.trade")}
            </button>
          ))}
        </div>
      }
    >
      <LazyTrendChart rows={rows} series={series} testId="trend-chart" onDay={onDay} />
      <p className="text-muted-foreground mt-1 text-xs">{t("dsh.chartHint")}</p>
    </Panel>
  );
}

export function Overview() {
  const { t, money, date, digits, count } = useI18n();
  const router = useRouter();
  const { godownId, godowns, consolidated } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const range = useDashRange();
  const ids = consolidated
    ? (godowns ?? []).filter((g) => g.status === "active").map((g) => g._id)
    : godownId
      ? [godownId]
      : [];
  const key = ids.join("|");
  const data = useLiveQuery(async () => {
    if (ids.length === 0) return null;
    const [ov, recent, alerts, varieties, trend] = await Promise.all([
      overviewFor(ids, range.from, range.to),
      recentFor(ids, 10),
      alertsFor(ids),
      db().varieties.where("godownId").anyOf(ids).toArray(),
      trendFor(ids, range.to, 30),
    ]);
    return {
      ov,
      recent,
      alerts,
      trend,
      varieties: new Map(varieties.map((v) => [v._id, v] as const)),
    };
  }, [key, range.from, range.to]);
  if (data === undefined) return <Skeleton rows={6} />;
  if (data === null) return null;
  const { ov, recent, alerts, varieties, trend } = data;
  const o = ov.total;
  const opts = { digits, monKg: business?.monKg };
  const qty = (g: bigint) => t("dsh.qty", { qty: formatWeightNumber(g, "QTL", opts) });
  const golaName = (id: string) => (godowns ?? []).find((g) => g._id === id)?.name ?? "";
  const today = todayIST();
  const cards = [
    {
      id: "m-purchase",
      icon: ShoppingCart,
      label: t("dsh.purchase"),
      value: { kind: "money", paise: o.purchasePaise },
      sub: qty(o.purchaseG),
      tone: "gold",
      href: "/purchase",
    },
    {
      id: "m-sales",
      icon: HandCoins,
      label: t("dsh.sales"),
      value: { kind: "money", paise: o.salesPaise },
      sub: qty(o.salesG),
      tone: "green",
      href: "/sales",
    },
    {
      id: "m-expenses",
      icon: Receipt,
      label: t("dsh.expenses"),
      value: { kind: "money", paise: o.expensesPaise },
      sub:
        o.vehicleCostPaise > 0n
          ? t("dsh.withVehicle", { amount: money(o.vehicleCostPaise) })
          : undefined,
      tone: "out",
      href: "/expenses",
    },
    {
      id: "m-cash",
      icon: Wallet,
      label: t("dsh.cash"),
      value: { kind: "money", paise: o.cashPaise },
      tone: "green",
      href: "/?tab=cashbook",
    },
    {
      id: "m-bank",
      icon: Landmark,
      label: t("dsh.bank"),
      value: { kind: "money", paise: o.bankPaise },
      sub:
        o.banks.length > 1
          ? o.banks.map((b) => `${b.name} ${money(b.paise)}`).join(" · ")
          : undefined,
      tone: "green",
      href: "/?tab=cashbook",
    },
    {
      id: "m-paddy",
      icon: Wheat,
      label: t("dsh.paddy"),
      value: { kind: "qty", grams: o.paddyG },
      tone: "gold",
      href: "/?tab=stock",
    },
    {
      id: "m-rice",
      icon: Package,
      label: t("dsh.rice"),
      value: { kind: "qty", grams: o.riceG },
      tone: "gold",
      href: "/?tab=stock&product=RICE",
    },
    {
      id: "m-mill",
      icon: Factory,
      label: t("dsh.mill"),
      value: { kind: "qty", grams: o.millPaddyG },
      sub: o.mills.length ? o.mills.map((m) => `${m.name} ${qty(m.g)}`).join(" · ") : undefined,
      tone: "gold",
      href: "/?tab=stock",
    },
    {
      id: "m-receivable",
      icon: Scale,
      label: t("dsh.receivable"),
      value: { kind: "money", paise: o.receivablePaise },
      tone: "in",
      href: "/dues?tab=receivable",
    },
    {
      id: "m-payable",
      icon: Scale,
      label: t("dsh.farmerPayable"),
      value: { kind: "money", paise: o.farmerPayablePaise },
      tone: "out",
      href: "/dues?tab=payable",
    },
    {
      id: "m-mill-payable",
      icon: Factory,
      label: t("dsh.millPayable"),
      value: { kind: "money", paise: o.millPayablePaise },
      tone: "out",
      href: "/dues?tab=mill",
    },
    {
      id: "m-vehicle",
      icon: Truck,
      label: t("dsh.vehicleIncome"),
      value: { kind: "money", paise: o.vehicleIncomePaise },
      tone: "green",
      href: "/vehicles",
    },
    {
      id: "m-cash-in",
      icon: ArrowDownLeft,
      label: t("dsh.cashIn"),
      value: { kind: "money", paise: o.cashInPaise },
      tone: "in",
      href: "/?tab=cashbook",
    },
    {
      id: "m-cash-out",
      icon: ArrowUpRight,
      label: t("dsh.cashOut"),
      value: { kind: "money", paise: o.cashOutPaise },
      tone: "out",
      href: "/?tab=cashbook",
    },
  ] as const;
  const hasSeries = o.series.some((s) => s.purchasePaise > 0n || s.salesPaise > 0n);
  const maxVariety = o.paddyByVariety.reduce((m, v) => (v.g > m ? v.g : m), 0n);
  const quick = QUICK_ACTIONS.filter((a) => a.ready);
  // Stable colour per variety (creation order), whatever the ranking.
  const varietyIndex = new Map([...varieties.keys()].map((id, i) => [id, i] as const));
  const varietyLabel = (id: string) =>
    id ? varietyName(varieties.get(id), t) : t("dsh.unknownVariety");
  return (
    <div className="flex flex-col gap-4">
      <RangeBar />
      {consolidated ? (
        <p className="bg-gold-100 text-accent-foreground rounded-xl px-3 py-2 text-sm">
          {t("dsh.combinedNote")}
        </p>
      ) : null}
      <MoneyHero
        cash={o.cashPaise}
        bank={o.bankPaise}
        cashIn={o.cashInPaise}
        cashOut={o.cashOutPaise}
      />
      <div
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
        data-testid="overview-cards"
      >
        {cards.map((c, i) => (
          <MetricCard
            key={c.id}
            index={i}
            icon={c.icon}
            label={c.label}
            value={c.value}
            tone={c.tone}
            testId={c.id}
            href={c.href}
            {...("sub" in c && c.sub ? { sub: c.sub } : {})}
          />
        ))}
      </div>
      {consolidated && ov.perGola.length > 1 ? (
        <Panel title={t("dsh.perGola")} icon={Package}>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-sm" data-testid="per-gola">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="py-2 text-left font-normal">{t("gola.switcher")}</th>
                  <th className="py-2 text-right font-normal">{t("dsh.cash")}</th>
                  <th className="py-2 text-right font-normal">{t("dsh.paddy")}</th>
                  <th className="py-2 text-right font-normal">{t("dsh.purchase")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ov.perGola.map((p) => (
                  <tr key={p.godownId}>
                    <td className="py-2">{golaName(p.godownId)}</td>
                    <td className="tabular py-2 text-right">{money(p.data.cashPaise)}</td>
                    <td className="tabular py-2 text-right">{qty(p.data.paddyG)}</td>
                    <td className="tabular py-2 text-right">{money(p.data.purchasePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("dsh.chart")} icon={BarChart3} tone="gold">
          {hasSeries ? (
            <>
              <PurchaseSalesChart
                series={o.series}
                onDay={(d) => router.push(`/?tab=daily&day=${d}`)}
              />
              <p className="text-muted-foreground mt-1 text-xs">{t("dsh.chartHint")}</p>
            </>
          ) : (
            <p className="text-muted-foreground py-6 text-center text-sm">{t("dsh.chartEmpty")}</p>
          )}
        </Panel>
        <TrendPanel trend={trend} onDay={(d) => router.push(`/?tab=daily&day=${d}`)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <FlowPanel cash={o.cashflow.cash} bank={o.cashflow.bank} />
        <Panel title={t("viz.duesMix")} icon={PieChart} tone="violet">
          <Donut
            testId="dues-donut"
            centerLabel={t("viz.total")}
            total={money(o.receivablePaise + o.farmerPayablePaise + o.millPayablePaise)}
            items={[
              {
                key: "rec",
                label: t("dsh.receivable"),
                value: o.receivablePaise,
                display: money(o.receivablePaise),
                color: "var(--chart-1)",
              },
              {
                key: "pay",
                label: t("dsh.farmerPayable"),
                value: o.farmerPayablePaise,
                display: money(o.farmerPayablePaise),
                color: "var(--chart-4)",
              },
              {
                key: "mill",
                label: t("dsh.millPayable"),
                value: o.millPayablePaise,
                display: money(o.millPayablePaise),
                color: "var(--chart-3)",
              },
            ]}
          />
          {o.receivablePaise + o.farmerPayablePaise + o.millPayablePaise === 0n ? (
            <p className="text-muted-foreground py-6 text-center text-sm">{t("dsh.noDues")}</p>
          ) : null}
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("dsh.stockSummary")} icon={Wheat} tone="gold">
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {(
              [
                ["/?tab=stock", t("dsh.paddy"), o.paddyG, Wheat],
                ["/?tab=stock", t("dsh.mill"), o.millPaddyG, Factory],
                ["/?tab=stock&product=RICE", t("dsh.rice"), o.riceG, Package],
              ] as const
            ).map(([href, label, g, I], i) => (
              <Link
                key={i}
                href={href}
                className="press lift from-gold-100 flex flex-col items-center gap-1 rounded-2xl border border-[color-mix(in_oklab,var(--gold)_30%,transparent)] bg-linear-to-b to-transparent p-2.5"
              >
                <I className="text-gold-600 size-5" strokeWidth={2} aria-hidden />
                <span className="text-muted-foreground block text-xs">{label}</span>
                <span className="tabular text-[13px] font-bold">{qty(g)}</span>
              </Link>
            ))}
          </div>
          {o.paddyByVariety.length > 1 ? (
            <div className="mt-4">
              <p className="text-muted-foreground mb-2 text-xs font-medium">{t("viz.stockMix")}</p>
              <Donut
                testId="stock-donut"
                size={150}
                centerLabel={t("dsh.paddy")}
                total={qty(o.paddyByVariety.reduce((s, v) => s + (v.g > 0n ? v.g : 0n), 0n))}
                otherLabel={t("viz.other")}
                items={o.paddyByVariety.map((v) => ({
                  key: v.varietyId || "none",
                  label: varietyLabel(v.varietyId),
                  value: v.g > 0n ? v.g : 0n,
                  display: qty(v.g),
                  color: `var(--chart-${((varietyIndex.get(v.varietyId) ?? 7) % 8) + 1})`,
                }))}
              />
            </div>
          ) : null}
          <p className="text-muted-foreground mt-4 mb-1 text-xs font-medium">
            {t("dsh.byVariety")}
          </p>
          {o.paddyByVariety.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dsh.noStock")}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="stock-by-variety">
              {o.paddyByVariety.slice(0, 8).map((v) => (
                <li key={v.varietyId} className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between">
                    <span>{varietyLabel(v.varietyId)}</span>
                    <span className="tabular font-semibold">{qty(v.g)}</span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="anim-grow-x h-full rounded-full bg-linear-to-r from-[var(--gold-300)] to-[var(--gold-600)]"
                      style={{ width: `${pct(v.g, maxVariety)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t("dsh.dueAlerts")} icon={BellRing} tone="out">
          {alerts.lowStock.length ? (
            <ul className="mb-3 flex flex-col gap-1.5" data-testid="low-stock">
              {alerts.lowStock.map((l, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <span className="font-medium">{t("dsh.lowStock")} · </span>
                    {t("dsh.lowStockLine", {
                      name: l.varietyId
                        ? varietyName(varieties.get(l.varietyId), t)
                        : t("dsh.lowStockTotal"),
                      have: formatWeightNumber(l.haveG, "QTL", opts),
                      th: formatWeightNumber(l.thresholdG, "QTL", opts),
                    })}
                    {consolidated ? ` · ${golaName(l.godownId)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {alerts.dues.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dsh.noDues")}</p>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="due-alerts">
              {alerts.dues.slice(0, 8).map((a) => {
                const href = docPath(a.doc);
                const msg =
                  a.direction === "IN"
                    ? t("wa.collect", {
                        name: a.party?.name ?? "",
                        business: business?.name ?? "",
                        gola: golaName(a.godownId),
                        amount: money(a.duePaise),
                        dueDate: date(a.dueDate, "short"),
                      })
                    : t("wa.pay", {
                        name: a.party?.name ?? "",
                        business: business?.name ?? "",
                        gola: golaName(a.godownId),
                        amount: money(a.duePaise),
                        dueDate: date(a.dueDate, "short"),
                      });
                return (
                  <li key={`${a.doc._id}:${a.dueDate}`} className="flex items-center gap-2 py-2">
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
                        a.direction === "IN"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
                      )}
                    >
                      {a.direction === "IN" ? (
                        <ArrowDownLeft className="size-3" aria-hidden />
                      ) : (
                        <ArrowUpRight className="size-3" aria-hidden />
                      )}
                      {a.direction === "IN" ? t("dsh.collect") : t("dsh.pay")}
                    </span>
                    {href ? (
                      <Link href={href} className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {a.party?.name ?? ""}
                        </span>
                        <span
                          className={cn(
                            "text-xs",
                            "flex items-center gap-1",
                            a.overdue ? "font-semibold text-red-700" : "text-muted-foreground",
                          )}
                        >
                          <Clock className="size-3" aria-hidden />
                          {a.overdue
                            ? t("dsh.overdue", { days: count(diffDays(a.dueDate, today)) })
                            : t("dsh.dueOn", { date: date(a.dueDate, "short") })}
                        </span>
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm">{a.party?.name ?? ""}</span>
                    )}
                    <span className="tabular text-sm font-semibold">{money(a.duePaise)}</span>
                    <WhatsAppButton
                      phone={a.party?.phone}
                      text={msg}
                      className="h-10 px-2"
                      testId="due-whatsapp"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title={t("dsh.recent")} icon={Clock} tone="blue">
        {recent.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("dsh.recentEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2.5" data-testid="recent">
            {recent.map((r, i) => {
              const d = r.doc;
              const amount =
                "totalPaise" in d
                  ? BigInt(d.totalPaise)
                  : "amountPaise" in d
                    ? BigInt(d.amountPaise)
                    : undefined;
              const dir =
                d.type === "SALE" || (d.type === "PAYMENT" && d.direction === "IN")
                  ? "IN"
                  : d.type === "PURCHASE" || d.type === "EXPENSE" || d.type === "PAYMENT"
                    ? "OUT"
                    : undefined;
              const href = docPath(d);
              return (
                <li key={d._id}>
                  <TxnCard
                    index={i}
                    icon={
                      d.type === "SALE"
                        ? HandCoins
                        : d.type === "EXPENSE"
                          ? Receipt
                          : d.type === "PAYMENT"
                            ? Wallet
                            : Wheat
                    }
                    tone={dir === "IN" ? "in" : dir === "OUT" ? "out" : "gold"}
                    title={docTitle(d, t, r.party?.name, r.source).title}
                    subtitle={`${docTitle(d, t, r.party?.name, r.source).subtitle}${consolidated ? ` · ${golaName(r.godownId)}` : ""}`}
                    date={`${date(d.entryDate, "short")} · ${timeIST(d.createdAt, digits)}`}
                    {...(amount !== undefined ? { amountPaise: amount } : {})}
                    {...(dir ? { direction: dir } : {})}
                    {...(href ? { href } : {})}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {!readOnly && quick.length ? (
        <Panel title={t("dsh.quick")} icon={Zap} tone="gold">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-testid="dash-quick">
            {quick.map((a) => (
              <Link
                key={a.key}
                href={a.href}
                className={`press lift bg-card accent-${SECTION_OF[a.key]} flex min-h-14 items-center gap-2.5 rounded-2xl border px-2.5 text-sm font-semibold shadow-[0_2px_0_var(--border)]`}
              >
                <span className="tile-accent flex size-9 shrink-0 items-center justify-center rounded-xl">
                  <a.icon className="size-[18px]" strokeWidth={2} aria-hidden />
                </span>
                <span className="min-w-0 leading-tight">{t(a.label)}</span>
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

export default Overview;

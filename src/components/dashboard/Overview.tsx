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
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Factory,
  Landmark,
  Package,
  Receipt,
  Scale,
  ShoppingCart,
  Truck,
  Wallet,
  Wheat,
  HandCoins,
} from "lucide-react";
import { docPath } from "@/components/entry/docPath";
import { docTitle, timeIST } from "@/components/entry/docLabel";
import { MetricCard, Panel, Skeleton, TxnCard } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { QUICK_ACTIONS } from "@/components/shell/QuickAdd";
import { useWriteGodown } from "@/components/system/page";
import { varietyName } from "@/components/entry/Variety";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { alertsFor, overviewFor, recentFor } from "@/client/queries/consolidated/dashboard";
import type { FlowSummary } from "@/client/queries/dashboard";
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
    [t("dsh.opening"), f.openingPaise, "bg-forest-100"],
    [t("dsh.received"), f.receivedPaise, "bg-emerald-500/70"],
    [t("dsh.paid"), -f.paidPaise, "bg-red-500/60"],
    [t("dsh.spent"), -f.expensesPaise, "bg-amber-500/70"],
    ...(f.otherPaise !== 0n
      ? ([[t("dsh.other"), f.otherPaise, "bg-slate-400/60"]] as Array<[string, bigint, string]>)
      : []),
    [t("dsh.closing"), f.closingPaise, "bg-primary"],
  ];
  const max = rows.reduce((m, r) => {
    const a = r[1] < 0n ? -r[1] : r[1];
    return a > m ? a : m;
  }, 0n);
  return (
    <Panel
      title={t("dsh.cashflow")}
      action={
        <div className="bg-muted flex rounded-full p-1 text-sm" role="tablist">
          {(["cash", "bank"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={which === k}
              onClick={() => setWhich(k)}
              className={cn(
                "min-h-9 rounded-full px-3",
                which === k ? "bg-card shadow-card font-medium" : "text-muted-foreground",
              )}
            >
              {k === "cash" ? t("dsh.cashTab") : t("dsh.bankTab")}
            </button>
          ))}
        </div>
      }
    >
      <ul className="flex flex-col gap-2" data-testid="cashflow">
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
            <div className="bg-muted/50 h-1.5 overflow-hidden rounded-full">
              <div
                className={cn("h-full rounded-full transition-[width] duration-500", color)}
                style={{ width: `${pct(v, max)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
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
    const [ov, recent, alerts, varieties] = await Promise.all([
      overviewFor(ids, range.from, range.to),
      recentFor(ids, 10),
      alertsFor(ids),
      db().varieties.where("godownId").anyOf(ids).toArray(),
    ]);
    return { ov, recent, alerts, varieties: new Map(varieties.map((v) => [v._id, v] as const)) };
  }, [key, range.from, range.to]);
  if (data === undefined) return <Skeleton rows={6} />;
  if (data === null) return null;
  const { ov, recent, alerts, varieties } = data;
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
  return (
    <div className="flex flex-col gap-4">
      <RangeBar />
      {consolidated ? (
        <p className="bg-gold-100 text-accent-foreground rounded-xl px-3 py-2 text-sm">
          {t("dsh.combinedNote")}
        </p>
      ) : null}
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
        <Panel title={t("dsh.perGola")}>
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
        <Panel title={t("dsh.chart")}>
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
        <FlowPanel cash={o.cashflow.cash} bank={o.cashflow.bank} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("dsh.stockSummary")}>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <Link href="/?tab=stock" className="bg-gold-100/60 rounded-xl p-2">
              <span className="text-muted-foreground block text-xs">{t("dsh.paddy")}</span>
              <span className="tabular font-semibold">{qty(o.paddyG)}</span>
            </Link>
            <Link href="/?tab=stock" className="bg-gold-100/60 rounded-xl p-2">
              <span className="text-muted-foreground block text-xs">{t("dsh.mill")}</span>
              <span className="tabular font-semibold">{qty(o.millPaddyG)}</span>
            </Link>
            <Link href="/?tab=stock&product=RICE" className="bg-gold-100/60 rounded-xl p-2">
              <span className="text-muted-foreground block text-xs">{t("dsh.rice")}</span>
              <span className="tabular font-semibold">{qty(o.riceG)}</span>
            </Link>
          </div>
          <p className="text-muted-foreground mt-3 mb-1 text-xs">{t("dsh.byVariety")}</p>
          {o.paddyByVariety.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dsh.noStock")}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="stock-by-variety">
              {o.paddyByVariety.slice(0, 8).map((v) => (
                <li key={v.varietyId} className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between">
                    <span>
                      {v.varietyId
                        ? varietyName(varieties.get(v.varietyId), t)
                        : t("dsh.unknownVariety")}
                    </span>
                    <span className="tabular">{qty(v.g)}</span>
                  </div>
                  <div className="bg-muted/50 h-1.5 overflow-hidden rounded-full">
                    <div
                      className="bg-gold h-full rounded-full"
                      style={{ width: `${pct(v.g, maxVariety)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t("dsh.dueAlerts")}>
          {alerts.lowStock.length ? (
            <ul className="mb-3 flex flex-col gap-1.5" data-testid="low-stock">
              {alerts.lowStock.map((l, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"
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
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        a.direction === "IN"
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-red-50 text-red-800",
                      )}
                    >
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
                            a.overdue ? "text-red-700" : "text-muted-foreground",
                          )}
                        >
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
      <Panel title={t("dsh.recent")}>
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
        <Panel title={t("dsh.quick")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="dash-quick">
            {quick.map((a) => (
              <Link
                key={a.key}
                href={a.href}
                className="press bg-forest-100/60 text-forest flex min-h-12 items-center gap-2 rounded-xl px-3 text-sm font-medium"
              >
                <a.icon className="size-5" aria-hidden />
                {t(a.label)}
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

export default Overview;

"use client";

/**
 * Dashboard → সারাংশ (requirement_v2 §12.1A). v2 Phase 4 shows the balance cards (position now);
 * Phase 8 adds the date filters, flow cards, charts, alerts and recent transactions.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { Factory, Landmark, Scale, Wallet, Wheat, Package } from "lucide-react";
import { MetricCard, Skeleton } from "@/components/kit/Kit";
import { combinedTotals, golaTotals, type GolaTotals } from "@/client/queries/consolidated/totals";
import { useActiveGodown } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";

export function Overview() {
  const { t } = useI18n();
  const { godownId, godowns, consolidated } = useActiveGodown();
  const ids = consolidated
    ? (godowns ?? []).filter((g) => g.status === "active").map((g) => g._id)
    : godownId
      ? [godownId]
      : [];
  const totals = useLiveQuery(async (): Promise<Omit<GolaTotals, "godownId"> | null> => {
    if (ids.length === 0) return null;
    if (ids.length === 1) return golaTotals(ids[0]!);
    return (await combinedTotals(ids)).total;
  }, [ids.join("|")]);
  if (totals === undefined) return <Skeleton rows={4} />;
  if (totals === null) return null;
  const cards = [
    {
      icon: Wallet,
      label: t("dashOverview.cash"),
      value: { kind: "money", paise: totals.cashPaise },
      tone: "green",
      id: "m-cash",
    },
    {
      icon: Landmark,
      label: t("dashOverview.bank"),
      value: { kind: "money", paise: totals.bankPaise },
      tone: "green",
      id: "m-bank",
    },
    {
      icon: Wheat,
      label: t("dashOverview.paddy"),
      value: { kind: "qty", grams: totals.paddyG },
      tone: "gold",
      id: "m-paddy",
    },
    {
      icon: Package,
      label: t("dashOverview.rice"),
      value: { kind: "qty", grams: totals.riceG },
      tone: "gold",
      id: "m-rice",
    },
    {
      icon: Factory,
      label: t("dashOverview.mill"),
      value: { kind: "qty", grams: totals.millPaddyG },
      tone: "gold",
      id: "m-mill",
    },
    {
      icon: Scale,
      label: t("dashOverview.receivable"),
      value: { kind: "money", paise: totals.receivablePaise },
      tone: "in",
      id: "m-receivable",
    },
    {
      icon: Scale,
      label: t("dashOverview.payable"),
      value: { kind: "money", paise: totals.payablePaise },
      tone: "out",
      id: "m-payable",
    },
  ] as const;
  return (
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
        />
      ))}
    </div>
  );
}

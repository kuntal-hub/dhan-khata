"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  Car,
  HandCoins,
  Plus,
  Receipt,
  ShoppingCart,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { InstallButton } from "@/components/pwa/InstallButton";
import { Loading } from "@/components/lists/common";
import { mayOpenPath } from "@/client/access";
import { useActiveGodown, useGodownRole } from "@/client/hooks";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

// Owner-only "All godowns" table: loaded when that mode is chosen (spec §15 Home JS budget).
const ConsolidatedTable = dynamic(
  () => import("@/components/dashboard/ConsolidatedTable").then((m) => m.ConsolidatedTable),
  { ssr: false, loading: () => <Loading /> },
);

interface QuickAction {
  label: TKey;
  href: string;
  icon: LucideIcon;
  testId: string;
}

/** Quick actions (spec §9.1). */
export const QUICK_ACTIONS: QuickAction[] = [
  { label: "home.newPurchase", href: "/purchase/new", icon: ShoppingCart, testId: "qa-purchase" },
  { label: "home.newSaleLoad", href: "/load/new", icon: Truck, testId: "qa-load" },
  { label: "home.newSale", href: "/sale/new", icon: Receipt, testId: "qa-sale" },
  {
    label: "payment.paymentGiven",
    href: "/payment/new?type=PAYMENT",
    icon: Wallet,
    testId: "qa-payment",
  },
  {
    label: "payment.moneyReceived",
    href: "/payment/new?type=RECEIPT",
    icon: HandCoins,
    testId: "qa-receipt",
  },
  { label: "home.newExpense", href: "/expense/new", icon: Plus, testId: "qa-expense" },
  { label: "home.newTrip", href: "/trip/new", icon: Car, testId: "qa-trip" },
];

const SHORTCUTS: Record<string, string> = {
  purchase: "/purchase/new",
  sale: "/sale/new",
  expense: "/expense/new",
};

function ShortcutRedirect() {
  const router = useRouter();
  const sc = useSearchParams().get("shortcut");
  useEffect(() => {
    if (sc && SHORTCUTS[sc]) router.replace(SHORTCUTS[sc]);
  }, [sc, router]);
  return null;
}

export default function HomePage() {
  const { t } = useI18n();
  const router = useRouter();
  const { godownId, consolidated } = useActiveGodown();
  const role = useGodownRole();
  const [fab, setFab] = useState(false);
  const [date, setDate] = useState(todayIST());
  const writable = !!godownId && !consolidated && role !== null && role !== "viewer";
  // The `entry` role sees only the entries it may create (purchase, load, expense).
  const actions = QUICK_ACTIONS.filter((a) => mayOpenPath(role, a.href));

  const go = (a: QuickAction) => {
    setFab(false);
    router.push(a.href);
  };

  const quickActions = writable ? (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="quick-actions">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Button
            key={a.testId}
            variant="outline"
            className="h-16 justify-start gap-3 text-base whitespace-normal"
            onClick={() => go(a)}
            data-testid={a.testId}
          >
            <Icon className="text-primary size-6 shrink-0" aria-hidden />
            <span className="text-left leading-tight">{t(a.label)}</span>
          </Button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Suspense fallback={null}>
        <ShortcutRedirect />
      </Suspense>
      <InstallButton />
      {consolidated ? (
        <ConsolidatedTable date={date} onDate={setDate} />
      ) : godownId ? (
        <Dashboard godownId={godownId} date={date} onDate={setDate} quickActions={quickActions} />
      ) : (
        <Loading />
      )}
      <Link href="/sync" className="text-muted-foreground min-h-11 py-3 text-sm underline">
        {t("nav.sync")}
      </Link>
      {writable ? (
        <Button
          className="fixed right-4 bottom-20 z-30 size-14 rounded-full shadow-lg md:bottom-6"
          aria-label={t("home.quickActions")}
          onClick={() => setFab(true)}
          data-testid="fab"
        >
          <Plus className="size-7" aria-hidden />
        </Button>
      ) : null}
      <BottomSheet open={fab} onOpenChange={setFab} title={t("home.quickActions")}>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <Button
                key={a.testId}
                variant="outline"
                className="h-16 justify-start gap-3 whitespace-normal"
                onClick={() => go(a)}
              >
                <Icon className="text-primary size-6 shrink-0" aria-hidden />
                <span className="text-left leading-tight">{t(a.label)}</span>
              </Button>
            );
          })}
        </div>
      </BottomSheet>
    </div>
  );
}

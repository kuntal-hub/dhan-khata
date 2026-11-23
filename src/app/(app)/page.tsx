"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
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
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BottomSheet } from "@/components/forms/BottomSheet";
import { InstallButton } from "@/components/pwa/InstallButton";
import { EmptyState } from "@/components/lists/common";
import { VoucherRow } from "@/components/vouchers/VoucherList";
import { useNames } from "@/components/vouchers/names";
import { useActiveGodown } from "@/client/hooks";
import { accountBalance } from "@/client/queries/ledger";
import { vouchersOfDay } from "@/client/queries/vouchers";
import { todayIST } from "@/domain/dates";
import { ACC } from "@/domain/posting/accounts";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

interface QuickAction {
  label: TKey;
  href: string | null;
  icon: LucideIcon;
  testId: string;
}

/** Quick actions (spec §9.1): the dashboard cards arrive in Phase 4. */
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
  { label: "home.newExpense", href: null, icon: Plus, testId: "qa-expense" },
  { label: "home.newTrip", href: null, icon: Car, testId: "qa-trip" },
];

const SHORTCUTS: Record<string, string> = { purchase: "/purchase/new", sale: "/sale/new" };

function ShortcutRedirect() {
  const router = useRouter();
  const sc = useSearchParams().get("shortcut");
  useEffect(() => {
    if (sc && SHORTCUTS[sc]) router.replace(SHORTCUTS[sc]);
  }, [sc, router]);
  return null;
}

export default function HomePage() {
  const { t, money } = useI18n();
  const router = useRouter();
  const { godownId, consolidated } = useActiveGodown();
  const names = useNames(godownId);
  const [fab, setFab] = useState(false);
  const today = todayIST();
  const data = useLiveQuery(async () => {
    if (!godownId) return null;
    const [list, cash] = await Promise.all([
      vouchersOfDay(godownId, today),
      accountBalance(godownId, ACC.CASH),
    ]);
    return { list, cash };
  }, [godownId, today]);
  const writable = !!godownId && !consolidated;

  const go = (a: QuickAction) => {
    setFab(false);
    if (a.href) router.push(a.href);
    else toast(t("common.comingSoon"));
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Suspense fallback={null}>
        <ShortcutRedirect />
      </Suspense>
      <header className="flex flex-col">
        <h1 className="text-primary text-2xl font-semibold">{t("common.appName")}</h1>
        <p className="text-muted-foreground line-clamp-2 text-sm">{t("common.appTagline")}</p>
      </header>
      <InstallButton />
      {data ? (
        <Card>
          <CardContent className="flex flex-col pt-6">
            <span className="text-muted-foreground text-sm">{t("account.CASH")}</span>
            <span
              className="tabular text-3xl font-semibold"
              data-testid="home-cash"
              data-paise={data.cash.toString()}
            >
              {money(data.cash)}
            </span>
          </CardContent>
        </Card>
      ) : null}
      {writable ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="quick-actions">
          {QUICK_ACTIONS.map((a) => {
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
      ) : null}
      <section className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t("home.todayList")}</h2>
        {!data || !names ? null : data.list.length === 0 ? (
          <EmptyState text={t("home.todayEmpty")} />
        ) : (
          <ul data-testid="today-list">
            {data.list.map((v) => (
              <li key={v._id}>
                <VoucherRow
                  v={v}
                  partyName={names.party(
                    "partyId" in v
                      ? (v.partyId as string)
                      : v.type === "LOAD"
                        ? v.toMillPartyId
                        : undefined,
                  )}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
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
          {QUICK_ACTIONS.map((a) => {
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

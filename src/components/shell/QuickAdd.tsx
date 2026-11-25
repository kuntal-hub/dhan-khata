"use client";

/**
 * Floating quick-add button (requirement_v2 §11) on the Dashboard and the Purchase / Sales lists:
 * নতুন কেনা, নতুন বিক্রি, খরচ, পেমেন্ট দিলাম, টাকা পেলাম, লোড, মিলে পাঠানো, গাড়ির ট্রিপ.
 * Only actions whose screen exists are offered (`ready`); later phases switch them on.
 * Hidden in read-only modes (all Golas combined / archived Gola).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { closeThenNavigate } from "@/client/ui/backStack";
import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ClipboardList,
  Factory,
  HandCoins,
  Plus,
  Receipt,
  Truck,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { useWriteGodown } from "@/components/system/page";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

export interface QuickAction {
  key: string;
  label: TKey;
  href: string;
  icon: LucideIcon;
  ready: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { key: "purchase", label: "quick.purchase", href: "/purchase/new", icon: Wheat, ready: true },
  { key: "sale", label: "quick.sale", href: "/sales/new", icon: HandCoins, ready: true },
  { key: "expense", label: "quick.expense", href: "/expenses/new", icon: Receipt, ready: true },
  {
    key: "paid",
    label: "quick.paid",
    href: "/dues/pay?direction=OUT",
    icon: ArrowUpRight,
    ready: true,
  },
  {
    key: "received",
    label: "quick.received",
    href: "/dues/pay?direction=IN",
    icon: ArrowDownLeft,
    ready: true,
  },
  { key: "load", label: "quick.load", href: "/loads/new", icon: ClipboardList, ready: true },
  {
    key: "dispatch",
    label: "quick.dispatch",
    href: "/mill/dispatch/new",
    icon: Factory,
    ready: true,
  },
  { key: "trip", label: "quick.trip", href: "/vehicles/trip/new", icon: Truck, ready: true },
];

/** Section colour of each quick action (tile accent). */
export const SECTION_OF: Record<string, string> = {
  purchase: "purchase",
  sale: "sales",
  expense: "expenses",
  paid: "dues",
  received: "dues",
  load: "loads",
  dispatch: "mill",
  trip: "vehicles",
};

export function QuickAddFab() {
  const { t } = useI18n();
  const { readOnly } = useWriteGodown();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ready = QUICK_ACTIONS.filter((a) => a.ready);
  if (ready.length === 0 || readOnly) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("quick.open")}
        data-testid="quick-add"
        className="press anim-pop fixed right-4 bottom-24 z-30 flex size-15 items-center justify-center rounded-[1.25rem] border border-[var(--gold-600)] bg-linear-to-br from-[var(--gold-300)] via-[var(--gold)] to-[var(--gold-600)] text-[#2b1f02] shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_3px_0_var(--gold-600),0_14px_30px_-8px_rgb(183_128_10/0.75)] hover:brightness-105 active:translate-y-0.5 lg:right-8 lg:bottom-8 print:hidden"
      >
        <Plus className="size-8 transition-transform duration-300" strokeWidth={2.5} aria-hidden />
      </button>
      {open ? (
        <BottomSheet
          open={open}
          onOpenChange={setOpen}
          title={t("quick.title")}
          testId="quick-sheet"
        >
          <ul className="grid grid-cols-2 gap-3 pb-2 sm:grid-cols-4">
            {ready.map((a) => (
              <li key={a.key} className={`accent-${SECTION_OF[a.key]}`}>
                <Link
                  href={a.href}
                  onClick={(e) => {
                    e.preventDefault();
                    const href = e.currentTarget.getAttribute("href") ?? "/";
                    closeThenNavigate(
                      () => setOpen(false),
                      () => router.push(href),
                    );
                  }}
                  data-testid={`qa-${a.key}`}
                  className="press lift bg-card shadow-card anim-rise flex min-h-24 flex-col items-start justify-between gap-2 rounded-2xl border p-3.5"
                >
                  <span className="tile-accent flex size-11 items-center justify-center rounded-xl">
                    <a.icon className="size-5" strokeWidth={2} aria-hidden />
                  </span>
                  <span className="text-[15px] font-semibold">{t(a.label)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </BottomSheet>
      ) : null}
    </>
  );
}

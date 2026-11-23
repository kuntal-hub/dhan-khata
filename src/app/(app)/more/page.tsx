"use client";

import Link from "next/link";
import {
  BarChart3,
  Bell,
  Boxes,
  Car,
  Landmark,
  ReceiptText,
  RefreshCw,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/system/page";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

interface Item {
  label: TKey;
  href: string | null;
  icon: LucideIcon;
}

/** "আরও" menu (spec §11.2): later modules show a "coming soon" badge until their phase. */
const ITEMS: Item[] = [
  { label: "due.title", href: "/due", icon: Wallet },
  { label: "nav.expenses", href: null, icon: ReceiptText },
  { label: "nav.vehicles", href: null, icon: Car },
  { label: "nav.stock", href: null, icon: Boxes },
  { label: "nav.cashBank", href: null, icon: Landmark },
  { label: "nav.reports", href: null, icon: BarChart3 },
  { label: "nav.reminders", href: null, icon: Bell },
  { label: "nav.settings", href: "/settings", icon: Settings },
  { label: "nav.sync", href: "/sync", icon: RefreshCw },
];

export default function MorePage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("nav.more")} />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const body = (
            <>
              <Icon className="text-primary size-6" aria-hidden />
              <span className="text-sm leading-tight">{t(item.label)}</span>
              {!item.href ? <Badge variant="secondary">{t("common.comingSoon")}</Badge> : null}
            </>
          );
          return (
            <li key={item.label}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="hover:bg-muted flex min-h-24 flex-col items-start gap-2 rounded-lg border p-3"
                >
                  {body}
                </Link>
              ) : (
                <div
                  className="flex min-h-24 flex-col items-start gap-2 rounded-lg border p-3 opacity-70"
                  aria-disabled
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

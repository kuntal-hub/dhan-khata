"use client";

import Link from "next/link";
import {
  BarChart3,
  Bell,
  Boxes,
  CalendarCheck,
  Car,
  Landmark,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/system/page";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";
import type { TKey } from "@/i18n/translate";

interface Item {
  label: TKey;
  href: string | null;
  icon: LucideIcon;
  ownerOnly?: boolean;
}

/** "আরও" menu (spec §11.2): later modules show a "coming soon" badge until their phase. */
const ITEMS: Item[] = [
  { label: "due.title", href: "/due", icon: Wallet },
  { label: "nav.expenses", href: "/expense", icon: ReceiptText },
  { label: "nav.cashBank", href: "/cashbank", icon: Landmark },
  { label: "nav.dayClose", href: "/day-close", icon: CalendarCheck },
  { label: "nav.stock", href: "/stock", icon: Boxes },
  { label: "nav.vehicles", href: "/vehicle", icon: Car },
  { label: "nav.search", href: "/search", icon: Search },
  { label: "nav.godowns", href: "/godowns", icon: Warehouse, ownerOnly: true },
  { label: "nav.reports", href: "/reports", icon: BarChart3 },
  { label: "nav.reminders", href: "/reminders", icon: Bell },
  { label: "nav.settings", href: "/settings", icon: Settings },
  { label: "nav.sync", href: "/sync", icon: RefreshCw },
];

export default function MorePage() {
  const { t } = useI18n();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("nav.more")} />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ITEMS.filter((i) => !i.ownerOnly || isOwner).map((item) => {
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
                  data-testid={`more-${item.href.slice(1)}`}
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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Home, LayoutGrid, ShoppingCart, Truck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

export interface NavItem {
  href: string;
  label: TKey;
  icon: LucideIcon;
  /** Other path prefixes that belong to this tab. */
  match: string[];
}

/** হোম · ক্রয় · বিক্রি/লোড · খাতা · আরও (spec §11.2). */
export const TABS: NavItem[] = [
  { href: "/", label: "nav.home", icon: Home, match: [] },
  { href: "/purchase", label: "nav.purchase", icon: ShoppingCart, match: ["/purchase"] },
  { href: "/sale", label: "nav.saleLoad", icon: Truck, match: ["/sale", "/load"] },
  { href: "/party", label: "nav.khata", icon: BookOpen, match: ["/party", "/due", "/payment"] },
  {
    href: "/more",
    label: "nav.more",
    icon: LayoutGrid,
    match: [
      "/more",
      "/settings",
      "/sync",
      "/expense",
      "/cashbank",
      "/day-close",
      "/stock",
      "/transfer",
      "/vehicle",
      "/trip",
      "/godowns",
      "/search",
      "/voucher",
      "/reminders",
      "/reports",
    ],
  },
];

function isActive(item: NavItem, path: string): boolean {
  if (item.href === "/") return path === "/";
  return item.match.some((m) => path === m || path.startsWith(`${m}/`));
}

/** Mobile bottom tab bar. */
export function BottomTabs() {
  const { t } = useI18n();
  const path = usePathname();
  return (
    <nav
      className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur md:hidden print:hidden"
      aria-label={t("nav.main")}
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map((item) => {
          const active = isActive(item, path);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                data-testid={`tab-${item.href === "/" ? "home" : item.href.slice(1)}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight",
                  active ? "text-primary font-semibold" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span className="line-clamp-1 text-center">{t(item.label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Desktop sidebar (md and up). */
export function Sidebar() {
  const { t } = useI18n();
  const path = usePathname();
  return (
    <nav
      className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-52 shrink-0 border-r p-2 md:block print:hidden"
      aria-label={t("nav.main")}
    >
      <ul className="flex flex-col gap-1">
        {TABS.map((item) => {
          const active = isActive(item, path);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm",
                  active ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {t(item.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

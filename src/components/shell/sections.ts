/**
 * The EXACTLY EIGHT main sections (requirement_v2 §11). Every other screen (profile, business,
 * Gola management, sessions, sync) lives in the header and is never a section. Tabs are search
 * params on the section's static route (offline precache: no dynamic segments).
 */
import {
  ClipboardList,
  Factory,
  HandCoins,
  LayoutDashboard,
  Receipt,
  Scale,
  Truck,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import type { TKey } from "@/i18n/translate";

export interface SectionTab {
  key: string;
  label: TKey;
  /** A tab that opens another page (e.g. "নতুন কেনা" → the purchase form). */
  href?: string;
}

export interface Section {
  key: "dashboard" | "purchase" | "sales" | "expenses" | "loads" | "dues" | "vehicles" | "mill";
  href: string;
  label: TKey;
  short: TKey;
  icon: LucideIcon;
  /** One of the four mobile bottom-bar sections. */
  primary: boolean;
  /** Path prefixes that belong to this section (sub-pages, forms, detail views). */
  match: string[];
  tabs: SectionTab[];
}

export const SECTIONS: readonly Section[] = [
  {
    key: "dashboard",
    href: "/",
    label: "sections.dashboard",
    short: "sections.short.dashboard",
    icon: LayoutDashboard,
    primary: true,
    match: [],
    tabs: [
      { key: "overview", label: "sections.dashboardTabs.overview" },
      { key: "cashbook", label: "sections.dashboardTabs.cashbook" },
      { key: "stock", label: "sections.dashboardTabs.stock" },
      { key: "daily", label: "sections.dashboardTabs.daily" },
      { key: "reports", label: "sections.dashboardTabs.reports" },
    ],
  },
  {
    key: "purchase",
    href: "/purchase",
    label: "sections.purchase",
    short: "sections.short.purchase",
    icon: Wheat,
    primary: true,
    match: ["/purchase"],
    tabs: [
      { key: "list", label: "sections.purchaseTabs.list" },
      { key: "new", label: "sections.purchaseTabs.new", href: "/purchase/new" },
      { key: "farmers", label: "sections.purchaseTabs.farmers" },
      { key: "varieties", label: "sections.purchaseTabs.varieties" },
      { key: "reports", label: "sections.purchaseTabs.reports" },
    ],
  },
  {
    key: "sales",
    href: "/sales",
    label: "sections.sales",
    short: "sections.short.sales",
    icon: HandCoins,
    primary: true,
    match: ["/sales"],
    tabs: [
      { key: "list", label: "sections.salesTabs.list" },
      { key: "new", label: "sections.salesTabs.new", href: "/sales/new" },
      { key: "customers", label: "sections.salesTabs.customers" },
      { key: "delivery", label: "sections.salesTabs.delivery" },
      { key: "reports", label: "sections.salesTabs.reports" },
    ],
  },
  {
    key: "expenses",
    href: "/expenses",
    label: "sections.expenses",
    short: "sections.short.expenses",
    icon: Receipt,
    primary: false,
    match: ["/expenses"],
    tabs: [
      { key: "today", label: "sections.expensesTabs.today" },
      { key: "all", label: "sections.expensesTabs.all" },
      { key: "unpaid", label: "sections.expensesTabs.unpaid" },
      { key: "reports", label: "sections.expensesTabs.reports" },
    ],
  },
  {
    key: "loads",
    href: "/loads",
    label: "sections.loads",
    short: "sections.short.loads",
    icon: ClipboardList,
    primary: false,
    match: ["/loads"],
    tabs: [
      { key: "date", label: "sections.loadsTabs.date" },
      { key: "party", label: "sections.loadsTabs.party" },
      { key: "mill", label: "sections.loadsTabs.mill" },
      { key: "vehicle", label: "sections.loadsTabs.vehicle" },
      { key: "reports", label: "sections.loadsTabs.reports" },
    ],
  },
  {
    key: "dues",
    href: "/dues",
    label: "sections.dues",
    short: "sections.short.dues",
    icon: Scale,
    primary: true,
    match: ["/dues"],
    tabs: [
      { key: "summary", label: "sections.duesTabs.summary" },
      { key: "receivable", label: "sections.duesTabs.receivable" },
      { key: "payable", label: "sections.duesTabs.payable" },
      { key: "mill", label: "sections.duesTabs.mill" },
      { key: "advance", label: "sections.duesTabs.advance" },
      { key: "other", label: "sections.duesTabs.other" },
      { key: "reminders", label: "sections.duesTabs.reminders" },
      { key: "reports", label: "sections.duesTabs.reports" },
    ],
  },
  {
    key: "vehicles",
    href: "/vehicles",
    label: "sections.vehicles",
    short: "sections.short.vehicles",
    icon: Truck,
    primary: false,
    match: ["/vehicles"],
    tabs: [
      { key: "trips", label: "sections.vehiclesTabs.trips" },
      { key: "byVehicle", label: "sections.vehiclesTabs.byVehicle" },
      { key: "byCustomer", label: "sections.vehiclesTabs.byCustomer" },
      { key: "pnl", label: "sections.vehiclesTabs.pnl" },
      { key: "reports", label: "sections.vehiclesTabs.reports" },
    ],
  },
  {
    key: "mill",
    href: "/mill",
    label: "sections.mill",
    short: "sections.short.mill",
    icon: Factory,
    primary: false,
    match: ["/mill"],
    tabs: [
      { key: "secondParty", label: "sections.millTabs.secondParty" },
      { key: "dispatch", label: "sections.millTabs.dispatch" },
      { key: "return", label: "sections.millTabs.return" },
      { key: "conversion", label: "sections.millTabs.conversion" },
      { key: "consignment", label: "sections.millTabs.consignment" },
      { key: "reports", label: "sections.millTabs.reports" },
    ],
  },
];

export function sectionOf(path: string): Section | undefined {
  if (path === "/") return SECTIONS[0];
  return SECTIONS.find((s) => s.match.some((m) => path === m || path.startsWith(`${m}/`)));
}

export function sectionByKey(key: Section["key"]): Section {
  return SECTIONS.find((s) => s.key === key)!;
}

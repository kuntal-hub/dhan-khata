/**
 * The EXACTLY EIGHT main sections (requirement_v2 §11). Every other screen (profile, business,
 * Gola management, sessions, sync) lives in the header and is never a section. Tabs are search
 * params on the section's static route (offline precache: no dynamic segments).
 */
import {
  ArrowDownLeft,
  ArrowUpRight,
  ClipboardList,
  Factory,
  HandCoins,
  LayoutDashboard,
  Plus,
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
  /** Only about rice / other products: hidden when rice is off (business profile). */
  rice?: boolean;
}

/**
 * A highlighted "add" button in the section heading that opens an entry form, so every section
 * offers its own forms right where the user is (not only through the floating + button).
 */
export interface SectionAction {
  key: string;
  label: TKey;
  href: string;
  icon: LucideIcon;
  testId: string;
  /** The tabs it shows on (every tab when absent). */
  tabs?: readonly string[];
  /** A rice / other-product form: hidden when rice is off. */
  rice?: boolean;
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
  actions: readonly SectionAction[];
}

const DUE_TABS_IN = ["summary", "receivable", "mill", "advance", "other", "reports"];
const DUE_TABS_OUT = ["summary", "payable", "advance", "other", "reports"];

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
    // The dashboard keeps the floating + (every form in one place).
    actions: [],
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
      { key: "farmers", label: "sections.purchaseTabs.farmers" },
      { key: "varieties", label: "sections.purchaseTabs.varieties" },
      { key: "fares", label: "sections.purchaseTabs.fares" },
      { key: "reports", label: "sections.purchaseTabs.reports" },
    ],
    actions: [
      {
        key: "new",
        label: "act.purchase",
        href: "/purchase/new",
        icon: Plus,
        testId: "purchase-new",
      },
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
      { key: "customers", label: "sections.salesTabs.customers" },
      { key: "delivery", label: "sections.salesTabs.delivery" },
      { key: "reports", label: "sections.salesTabs.reports" },
    ],
    actions: [
      { key: "new", label: "act.sale", href: "/sales/new", icon: Plus, testId: "sale-new" },
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
    actions: [
      {
        key: "new",
        label: "act.expense",
        href: "/expenses/new",
        icon: Plus,
        testId: "expense-new",
      },
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
    actions: [
      { key: "new", label: "act.load", href: "/loads/new", icon: Plus, testId: "load-new" },
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
    // Reminders has its own "new reminder" button.
    actions: [
      {
        key: "received",
        label: "quick.received",
        href: "/dues/pay?direction=IN",
        icon: ArrowDownLeft,
        testId: "due-pay-in",
        tabs: DUE_TABS_IN,
      },
      {
        key: "paid",
        label: "quick.paid",
        href: "/dues/pay?direction=OUT",
        icon: ArrowUpRight,
        testId: "due-pay-out",
        tabs: DUE_TABS_OUT,
      },
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
    actions: [
      {
        key: "new",
        label: "act.trip",
        href: "/vehicles/trip/new",
        icon: Plus,
        testId: "trip-new",
      },
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
      { key: "conversion", label: "sections.millTabs.conversion", rice: true },
      { key: "settlement", label: "sections.millTabs.settlement" },
      { key: "reports", label: "sections.millTabs.reports" },
    ],
    // One form per tab (final settlement starts from a dispatch: its own button on each row).
    actions: [
      {
        key: "entry",
        label: "act.entry",
        href: "/mill/entry/new",
        icon: Plus,
        testId: "sp-new",
        tabs: ["secondParty"],
      },
      {
        key: "dispatch",
        label: "act.dispatch",
        href: "/mill/dispatch/new",
        icon: Plus,
        testId: "dispatch-new",
        tabs: ["dispatch", "settlement", "reports"],
      },
      {
        key: "return",
        label: "act.return",
        href: "/mill/return/new",
        icon: Plus,
        testId: "return-new",
        tabs: ["return"],
      },
      {
        key: "conversion",
        label: "act.conversion",
        href: "/mill/conversion/new",
        icon: Plus,
        testId: "conversion-new",
        tabs: ["conversion"],
        rice: true,
      },
    ],
  },
];

/** The heading buttons of `tab` (rice forms only when rice is shown). */
export function actionsOf(section: Section, tab: string, rice: boolean): SectionAction[] {
  return section.actions.filter((a) => (!a.tabs || a.tabs.includes(tab)) && (rice || !a.rice));
}

/** The section's tabs (the rice-only ones only when rice is shown). */
export function tabsOf(section: Section, rice: boolean): SectionTab[] {
  return section.tabs.filter((t) => rice || !t.rice);
}

export function sectionOf(path: string): Section | undefined {
  if (path === "/") return SECTIONS[0];
  return SECTIONS.find((s) => s.match.some((m) => path === m || path.startsWith(`${m}/`)));
}

export function sectionByKey(key: Section["key"]): Section {
  return SECTIONS.find((s) => s.key === key)!;
}

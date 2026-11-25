"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/kit/Kit";
import { InstallButton } from "@/components/pwa/InstallButton";
import { LazyReports } from "@/components/reports/LazyReports";
import { SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

// Each tab loads on demand: the Home start-up JS stays within its budget (CLAUDE.md).
const loading = () => <Skeleton rows={6} />;
const Overview = dynamic(() => import("@/components/dashboard/Overview"), { ssr: false, loading });
const Cashbook = dynamic(() => import("@/components/dashboard/Cashbook"), { ssr: false, loading });
const StockTab = dynamic(() => import("@/components/dashboard/StockTab"), { ssr: false, loading });
const DailyOverview = dynamic(() => import("@/components/dashboard/DailyOverview"), {
  ssr: false,
  loading,
});

/** Section 1 — ড্যাশবোর্ড / Dashboard (requirement_v2 §12.1). */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-4" data-testid="home">
      <SectionPage
        sectionKey="dashboard"
        render={(tab) =>
          tab === "cashbook" ? (
            <Cashbook />
          ) : tab === "stock" ? (
            <StockTab />
          ) : tab === "daily" ? (
            <DailyOverview />
          ) : tab === "reports" ? (
            <LazyReports section="dashboard" />
          ) : (
            <Overview />
          )
        }
      />
      <InstallButton />
      <QuickAddFab />
    </div>
  );
}

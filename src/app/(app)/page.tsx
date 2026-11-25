"use client";

import { Overview } from "@/components/dashboard/Overview";
import { InstallButton } from "@/components/pwa/InstallButton";
import { NotBuiltYet, SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

/** Section 1 — ড্যাশবোর্ড / Dashboard (requirement_v2 §12.1). */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-4" data-testid="home">
      <SectionPage
        sectionKey="dashboard"
        render={(tab) => (tab === "overview" ? <Overview /> : <NotBuiltYet />)}
      />
      <InstallButton />
      <QuickAddFab />
    </div>
  );
}

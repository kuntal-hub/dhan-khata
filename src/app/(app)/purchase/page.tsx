"use client";

import { FarmerList, PurchaseList, VarietyManager } from "@/components/purchase/PurchaseTabs";
import { LazyReports } from "@/components/reports/LazyReports";
import { SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

/** Section 2 — ধান কেনা / Purchase (requirement_v2 §12.2). */
export default function PurchasePage() {
  return (
    <>
      <SectionPage
        sectionKey="purchase"
        render={(tab) =>
          tab === "farmers" ? (
            <FarmerList />
          ) : tab === "varieties" ? (
            <VarietyManager />
          ) : tab === "reports" ? (
            <LazyReports section="purchase" />
          ) : (
            <PurchaseList />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

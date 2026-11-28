"use client";

import { FarmerList, PurchaseList, VarietyManager } from "@/components/purchase/PurchaseTabs";
import { VehicleOwnerList } from "@/components/fares/FareTabs";
import { LazyReports } from "@/components/reports/LazyReports";
import { SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

/** Section 2 — ধান কেনা / Purchase (requirement_v2 §12.2; vehicle fare tab: D56). */
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
          ) : tab === "fares" ? (
            <VehicleOwnerList />
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

"use client";

import { FarmerList, PurchaseList, VarietyManager } from "@/components/purchase/PurchaseTabs";
import { NotBuiltYet, SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

/** Section 2 — ধান কেনা / Purchase (requirement_v2 §12.2). Reports arrive in Phase 11. */
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
            <NotBuiltYet />
          ) : (
            <PurchaseList />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

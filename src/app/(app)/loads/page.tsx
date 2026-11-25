"use client";

import { LoadGroups } from "@/components/loads/LoadTabs";
import { QuickAddFab } from "@/components/shell/QuickAdd";
import { NotBuiltYet, SectionPage } from "@/components/shell/SectionPage";

/** Section 5 — দৈনিক লোড খাতা / Daily Load Khata (requirement_v2 §12.5). Reports: Phase 11. */
export default function LoadsPage() {
  return (
    <>
      <SectionPage
        sectionKey="loads"
        render={(tab) =>
          tab === "party" ? (
            <LoadGroups by="party" />
          ) : tab === "mill" ? (
            <LoadGroups by="mill" />
          ) : tab === "vehicle" ? (
            <LoadGroups by="vehicle" />
          ) : tab === "reports" ? (
            <NotBuiltYet />
          ) : (
            <LoadGroups by="date" />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

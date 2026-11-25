"use client";

import { LoadGroups } from "@/components/loads/LoadTabs";
import { QuickAddFab } from "@/components/shell/QuickAdd";
import { LazyReports } from "@/components/reports/LazyReports";
import { SectionPage } from "@/components/shell/SectionPage";

/** Section 5 — দৈনিক লোড খাতা / Daily Load Khata (requirement_v2 §12.5). */
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
            <LazyReports section="loads" />
          ) : (
            <LoadGroups by="date" />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

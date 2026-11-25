"use client";

import {
  ConsignmentList,
  ConversionList,
  DispatchList,
  ReturnList,
  SecondPartyList,
} from "@/components/mill/MillTabs";
import { LazyReports } from "@/components/reports/LazyReports";
import { SectionPage } from "@/components/shell/SectionPage";

/** Section 8 — মিল ও পার্টির হিসাব / Mill & Second Party (requirement_v2 §12.8). */
export default function MillPage() {
  return (
    <SectionPage
      sectionKey="mill"
      render={(tab) =>
        tab === "dispatch" ? (
          <DispatchList />
        ) : tab === "return" ? (
          <ReturnList />
        ) : tab === "conversion" ? (
          <ConversionList />
        ) : tab === "consignment" ? (
          <ConsignmentList />
        ) : tab === "reports" ? (
          <LazyReports section="mill" />
        ) : (
          <SecondPartyList />
        )
      }
    />
  );
}

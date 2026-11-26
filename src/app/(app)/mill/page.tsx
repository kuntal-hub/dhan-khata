"use client";

import {
  ConversionList,
  DispatchList,
  ReturnList,
  SecondPartyList,
  SettlementList,
} from "@/components/mill/MillTabs";
import { LazyReports } from "@/components/reports/LazyReports";
import { SectionPage } from "@/components/shell/SectionPage";

/** Section 8 — মিল ও পার্টির হিসাব / Mill & Second Party (requirement_v2.1 §12.8). */
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
        ) : tab === "settlement" ? (
          <SettlementList />
        ) : tab === "reports" ? (
          <LazyReports section="mill" />
        ) : (
          <SecondPartyList />
        )
      }
    />
  );
}

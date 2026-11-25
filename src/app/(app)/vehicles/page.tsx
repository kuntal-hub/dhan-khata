"use client";

import { QuickAddFab } from "@/components/shell/QuickAdd";
import { LazyReports } from "@/components/reports/LazyReports";
import { SectionPage } from "@/components/shell/SectionPage";
import { ByCustomer, ByVehicle, PnlTab, TripList } from "@/components/vehicles/VehicleTabs";

/** Section 7 — গাড়ির ব্যবসা / Vehicle Business (requirement_v2 §12.7). */
export default function VehiclesPage() {
  return (
    <>
      <SectionPage
        sectionKey="vehicles"
        render={(tab) =>
          tab === "byVehicle" ? (
            <ByVehicle />
          ) : tab === "byCustomer" ? (
            <ByCustomer />
          ) : tab === "pnl" ? (
            <PnlTab />
          ) : tab === "reports" ? (
            <LazyReports section="vehicles" />
          ) : (
            <TripList />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

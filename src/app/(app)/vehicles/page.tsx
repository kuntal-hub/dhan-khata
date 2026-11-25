"use client";

import { QuickAddFab } from "@/components/shell/QuickAdd";
import { NotBuiltYet, SectionPage } from "@/components/shell/SectionPage";
import { ByCustomer, ByVehicle, PnlTab, TripList } from "@/components/vehicles/VehicleTabs";

/** Section 7 — গাড়ির ব্যবসা / Vehicle Business (requirement_v2 §12.7). Reports: Phase 11. */
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
            <NotBuiltYet />
          ) : (
            <TripList />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

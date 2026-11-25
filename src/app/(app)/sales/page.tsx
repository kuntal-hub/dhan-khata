"use client";

import { CustomerList, DeliveryBoard, SalesList } from "@/components/sales/SalesTabs";
import { LazyReports } from "@/components/reports/LazyReports";
import { SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

/** Section 3 — ধান বিক্রি / Sales (requirement_v2 §12.3). */
export default function SalesPage() {
  return (
    <>
      <SectionPage
        sectionKey="sales"
        render={(tab) =>
          tab === "customers" ? (
            <CustomerList />
          ) : tab === "delivery" ? (
            <DeliveryBoard />
          ) : tab === "reports" ? (
            <LazyReports section="sales" />
          ) : (
            <SalesList />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

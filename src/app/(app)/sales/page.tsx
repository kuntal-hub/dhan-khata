"use client";

import { CustomerList, DeliveryBoard, SalesList } from "@/components/sales/SalesTabs";
import { NotBuiltYet, SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

/** Section 3 — ধান বিক্রি / Sales (requirement_v2 §12.3). Reports arrive in Phase 11. */
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
            <NotBuiltYet />
          ) : (
            <SalesList />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

"use client";

import { AllExpenses, TodayExpenses, UnpaidExpenses } from "@/components/expenses/ExpenseTabs";
import { LazyReports } from "@/components/reports/LazyReports";
import { SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

/** Section 4 — দৈনিক খরচ / Daily Expenses (requirement_v2 §12.4). */
export default function ExpensesPage() {
  return (
    <>
      <SectionPage
        sectionKey="expenses"
        render={(tab) =>
          tab === "all" ? (
            <AllExpenses />
          ) : tab === "unpaid" ? (
            <UnpaidExpenses />
          ) : tab === "reports" ? (
            <LazyReports section="expenses" />
          ) : (
            <TodayExpenses />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

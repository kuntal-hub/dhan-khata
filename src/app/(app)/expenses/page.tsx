"use client";

import { AllExpenses, TodayExpenses, UnpaidExpenses } from "@/components/expenses/ExpenseTabs";
import { NotBuiltYet, SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

/** Section 4 — দৈনিক খরচ / Daily Expenses (requirement_v2 §12.4). Reports arrive in Phase 11. */
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
            <NotBuiltYet />
          ) : (
            <TodayExpenses />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

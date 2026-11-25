"use client";

import { DueCategoryList, DueSummaryTab, RemindersTab } from "@/components/dues/DueTabs";
import { QuickAddFab } from "@/components/shell/QuickAdd";
import { NotBuiltYet, SectionPage } from "@/components/shell/SectionPage";

/** Section 6 — বাকি ও অগ্রিম / Due & Advance (requirement_v2 §12.6). Reports: Phase 11. */
export default function DuesPage() {
  return (
    <>
      <SectionPage
        sectionKey="dues"
        render={(tab) =>
          tab === "receivable" ||
          tab === "payable" ||
          tab === "mill" ||
          tab === "advance" ||
          tab === "other" ? (
            <DueCategoryList category={tab} />
          ) : tab === "reminders" ? (
            <RemindersTab />
          ) : tab === "reports" ? (
            <NotBuiltYet />
          ) : (
            <DueSummaryTab />
          )
        }
      />
      <QuickAddFab />
    </>
  );
}

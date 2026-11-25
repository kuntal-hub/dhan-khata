"use client";

import { NotBuiltYet, SectionPage } from "@/components/shell/SectionPage";

/** Section 4 — দৈনিক খরচ / Daily Expenses (requirement_v2 §12.4). */
export default function ExpensesPage() {
  return (
    <>
      <SectionPage sectionKey="expenses" render={() => <NotBuiltYet />} />
    </>
  );
}

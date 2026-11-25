"use client";

import { NotBuiltYet, SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

/** Section 3 — ধান বিক্রি / Sales (requirement_v2 §12.3). */
export default function SalesPage() {
  return (
    <>
      <SectionPage sectionKey="sales" render={() => <NotBuiltYet />} />
      <QuickAddFab />
    </>
  );
}

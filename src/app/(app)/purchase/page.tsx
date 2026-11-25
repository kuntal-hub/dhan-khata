"use client";

import { NotBuiltYet, SectionPage } from "@/components/shell/SectionPage";
import { QuickAddFab } from "@/components/shell/QuickAdd";

/** Section 2 — ধান কেনা / Purchase (requirement_v2 §12.2). */
export default function PurchasePage() {
  return (
    <>
      <SectionPage sectionKey="purchase" render={() => <NotBuiltYet />} />
      <QuickAddFab />
    </>
  );
}

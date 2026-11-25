"use client";

import { PurchaseForm } from "@/components/purchase/PurchaseForm";
import { Fresh, ReadOnlyNotice, useWriteGodown } from "@/components/system/page";

export default function NewPurchasePage() {
  const { godown, readOnly } = useWriteGodown();
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <Fresh>
      <PurchaseForm godown={godown} />
    </Fresh>
  );
}

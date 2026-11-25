"use client";

import { SaleForm } from "@/components/sales/SaleForm";
import { Fresh, ReadOnlyNotice, useWriteGodown } from "@/components/system/page";

export default function NewSalePage() {
  const { godown, readOnly } = useWriteGodown();
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <Fresh>
      <SaleForm godown={godown} />
    </Fresh>
  );
}

"use client";

import { StockAdjustForm } from "@/components/daily/StockAdjustForm";
import { Fresh, PageSuspense, useParam } from "@/components/system/page";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <StockAdjustForm {...(id ? { editId: id } : {})} />
    </Fresh>
  );
}

/** Physical stock count (`?id=` to edit an adjustment). */
export default function StockAdjustPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

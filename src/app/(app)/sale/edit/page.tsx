"use client";

import { Fresh, PageSuspense, useParam } from "@/components/system/page";
import { SaleForm } from "@/components/trade/SaleForm";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <SaleForm {...(id ? { editId: id } : {})} />
    </Fresh>
  );
}

export default function EditSalePage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

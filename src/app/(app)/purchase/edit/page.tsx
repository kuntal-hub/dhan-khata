"use client";

import { Fresh, PageSuspense, useParam } from "@/components/system/page";
import { PurchaseForm } from "@/components/trade/PurchaseForm";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <PurchaseForm {...(id ? { editId: id } : {})} />
    </Fresh>
  );
}

export default function EditPurchasePage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

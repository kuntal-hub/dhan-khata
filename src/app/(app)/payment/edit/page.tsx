"use client";

import { Fresh, PageSuspense, useParam } from "@/components/system/page";
import { MoneyForm } from "@/components/trade/MoneyForm";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <MoneyForm kind="PAYMENT" {...(id ? { editId: id } : {})} />
    </Fresh>
  );
}

export default function EditPaymentPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

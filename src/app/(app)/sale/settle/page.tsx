"use client";

import { Fresh, PageSuspense, useParam } from "@/components/system/page";
import { SettlementForm } from "@/components/trade/SettlementForm";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <SettlementForm {...(id ? { saleId: id } : {})} />
    </Fresh>
  );
}

export default function SettleSalePage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

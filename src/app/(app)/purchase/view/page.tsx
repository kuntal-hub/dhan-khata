"use client";

import { PageSuspense, useParam } from "@/components/system/page";
import { VoucherView } from "@/components/vouchers/VoucherView";

function Inner() {
  return <VoucherView id={useParam("id")} />;
}

export default function ViewPurchasePage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

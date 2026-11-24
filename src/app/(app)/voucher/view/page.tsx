"use client";

import { PageSuspense, useParam } from "@/components/system/page";
import { VoucherView } from "@/components/vouchers/VoucherView";

function Inner() {
  return <VoucherView id={useParam("id")} />;
}

/** Any voucher type without its own view route (expense, trip, contra, stock, day close…). */
export default function ViewVoucherPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

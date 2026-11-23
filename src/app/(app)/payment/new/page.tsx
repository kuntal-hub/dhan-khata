"use client";

import { Fresh, PageSuspense, useParam } from "@/components/system/page";
import { MoneyForm } from "@/components/trade/MoneyForm";

function Inner() {
  const type = useParam("type") === "RECEIPT" ? "RECEIPT" : "PAYMENT";
  const partyId = useParam("partyId");
  const purpose = useParam("purpose");
  return (
    <Fresh>
      <MoneyForm kind={type} {...(partyId ? { partyId } : {})} {...(purpose ? { purpose } : {})} />
    </Fresh>
  );
}

/** New payment / receipt: `?type=PAYMENT|RECEIPT&partyId=&purpose=ADVANCE`. */
export default function NewPaymentPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

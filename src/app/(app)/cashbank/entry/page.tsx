"use client";

import { ContraForm } from "@/components/daily/ContraForm";
import { Fresh, PageSuspense, useParam } from "@/components/system/page";

function Inner() {
  const id = useParam("id");
  const kind = useParam("kind");
  const receipt = useParam("receipt");
  return (
    <Fresh>
      <ContraForm
        {...(id ? { editId: id } : {})}
        {...(kind ? { kind } : {})}
        {...(receipt ? { receiptId: receipt } : {})}
      />
    </Fresh>
  );
}

/** Cash/bank entry: `?kind=CASH_DEPOSIT|…&receipt=<cheque receipt id>` or `?id=` to edit. */
export default function CashBankEntryPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

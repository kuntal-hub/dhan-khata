"use client";

import { TransferForm } from "@/components/daily/TransferForm";
import { Fresh, PageSuspense, useParam } from "@/components/system/page";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <TransferForm {...(id ? { editId: id } : {})} />
    </Fresh>
  );
}

/** Inter-godown transfer wizard (`?id=<either side's voucher id>` to edit). */
export default function TransferPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

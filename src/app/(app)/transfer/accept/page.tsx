"use client";

import { AcceptTransfer } from "@/components/daily/AcceptTransfer";
import { Fresh, PageSuspense, useParam } from "@/components/system/page";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <AcceptTransfer {...(id ? { id } : {})} />
    </Fresh>
  );
}

/** Accept a pending receipt from another godown: `?id=<transfer id>`. */
export default function AcceptTransferPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

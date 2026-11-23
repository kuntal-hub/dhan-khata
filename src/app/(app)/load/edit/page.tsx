"use client";

import { Fresh, PageSuspense, useParam } from "@/components/system/page";
import { LoadForm } from "@/components/trade/LoadForm";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <LoadForm {...(id ? { editId: id } : {})} />
    </Fresh>
  );
}

export default function EditLoadPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

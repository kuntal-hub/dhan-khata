"use client";

import { Fresh, PageSuspense, useParam } from "@/components/system/page";
import { PartyForm } from "@/components/party/PartyForm";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <PartyForm {...(id ? { editId: id } : {})} />
    </Fresh>
  );
}

export default function EditPartyPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

"use client";

import { TripForm } from "@/components/daily/TripForm";
import { Fresh, PageSuspense, useParam } from "@/components/system/page";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <TripForm {...(id ? { editId: id } : {})} />
    </Fresh>
  );
}

export default function EditTripPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

"use client";

import { DayClose } from "@/components/daily/DayClose";
import { Fresh, PageSuspense, useParam } from "@/components/system/page";

function Inner() {
  const date = useParam("date");
  return (
    <Fresh>
      <DayClose {...(date ? { initialDate: date } : {})} />
    </Fresh>
  );
}

/** দিন শেষ: `?date=YYYY-MM-DD` (default today). */
export default function DayClosePage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

"use client";

import { ExpenseForm } from "@/components/daily/ExpenseForm";
import { Fresh, PageSuspense, useParam } from "@/components/system/page";

function Inner() {
  const categoryCode = useParam("category");
  const vehicleId = useParam("vehicleId");
  return (
    <Fresh>
      <ExpenseForm
        {...(categoryCode ? { categoryCode } : {})}
        {...(vehicleId ? { vehicleId } : {})}
      />
    </Fresh>
  );
}

/** New expense: `?category=LABOUR&vehicleId=`. */
export default function NewExpensePage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

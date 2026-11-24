"use client";

import { ExpenseForm } from "@/components/daily/ExpenseForm";
import { Fresh, PageSuspense, useParam } from "@/components/system/page";

function Inner() {
  const id = useParam("id");
  return (
    <Fresh>
      <ExpenseForm {...(id ? { editId: id } : {})} />
    </Fresh>
  );
}

export default function EditExpensePage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

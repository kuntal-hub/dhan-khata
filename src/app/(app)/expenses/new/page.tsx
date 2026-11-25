"use client";

import { ExpenseForm } from "@/components/expenses/ExpenseForm";
import {
  Fresh,
  PageSuspense,
  ReadOnlyNotice,
  useParam,
  useWriteGodown,
} from "@/components/system/page";

function New() {
  const { godown, readOnly } = useWriteGodown();
  const category = useParam("category") ?? undefined;
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <Fresh>
      <ExpenseForm godown={godown} {...(category ? { presetCategory: category } : {})} />
    </Fresh>
  );
}

export default function NewExpensePage() {
  return (
    <PageSuspense>
      <New />
    </PageSuspense>
  );
}

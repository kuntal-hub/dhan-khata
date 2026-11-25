"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ExpenseForm } from "@/components/expenses/ExpenseForm";
import { Loading } from "@/components/lists/common";
import {
  Fresh,
  PageSuspense,
  ReadOnlyNotice,
  useParam,
  useWriteGodown,
} from "@/components/system/page";
import { db } from "@/client/db/dexie";

function Edit() {
  const id = useParam("id");
  const { godown, readOnly } = useWriteGodown();
  const doc = useLiveQuery(() => (id ? db().vouchers.get(id) : undefined), [id]);
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  if (doc === undefined) return <Loading />;
  if (doc.type !== "EXPENSE" || doc.godownId !== godown._id || doc.status !== "active") {
    return <ReadOnlyNotice reason="notFound" />;
  }
  return (
    <Fresh>
      <ExpenseForm godown={godown} existing={doc} />
    </Fresh>
  );
}

export default function EditExpensePage() {
  return (
    <PageSuspense>
      <Edit />
    </PageSuspense>
  );
}

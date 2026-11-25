"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Loading } from "@/components/lists/common";
import { ReturnForm } from "@/components/mill/ReturnForm";
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
  if (doc.type !== "MILL_RETURN" || doc.godownId !== godown._id || doc.status !== "active") {
    return <ReadOnlyNotice reason="notFound" />;
  }
  return (
    <Fresh>
      <ReturnForm godown={godown} existing={doc} />
    </Fresh>
  );
}

export default function EditReturnPage() {
  return (
    <PageSuspense>
      <Edit />
    </PageSuspense>
  );
}

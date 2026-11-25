"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Loading } from "@/components/lists/common";
import { LoadForm } from "@/components/loads/LoadForm";
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
  if (doc.type !== "LOAD" || doc.godownId !== godown._id || doc.status !== "active") {
    return <ReadOnlyNotice reason="notFound" />;
  }
  return (
    <Fresh>
      <LoadForm godown={godown} existing={doc} />
    </Fresh>
  );
}

export default function EditLoadPage() {
  return (
    <PageSuspense>
      <Edit />
    </PageSuspense>
  );
}

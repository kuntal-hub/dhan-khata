"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { SaleForm } from "@/components/sales/SaleForm";
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
  // A Gola transfer is edited only by voiding and entering it again (both Golas change together).
  if (
    doc.type !== "SALE" ||
    doc.godownId !== godown._id ||
    doc.status !== "active" ||
    doc.interGola ||
    doc.consignmentDispatchId
  ) {
    return <ReadOnlyNotice reason="notFound" />;
  }
  return (
    <Fresh>
      <SaleForm godown={godown} existing={doc} />
    </Fresh>
  );
}

export default function EditSalePage() {
  return (
    <PageSuspense>
      <Edit />
    </PageSuspense>
  );
}

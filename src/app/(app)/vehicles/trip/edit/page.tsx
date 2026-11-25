"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Loading } from "@/components/lists/common";
import {
  Fresh,
  PageSuspense,
  ReadOnlyNotice,
  useParam,
  useWriteGodown,
} from "@/components/system/page";
import { TripForm } from "@/components/vehicles/TripForm";
import { db } from "@/client/db/dexie";

function Edit() {
  const id = useParam("id");
  const { godown, readOnly } = useWriteGodown();
  const doc = useLiveQuery(() => (id ? db().vouchers.get(id) : undefined), [id]);
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  if (doc === undefined) return <Loading />;
  if (doc.type !== "TRIP" || doc.godownId !== godown._id || doc.status !== "active") {
    return <ReadOnlyNotice reason="notFound" />;
  }
  return (
    <Fresh>
      <TripForm godown={godown} existing={doc} />
    </Fresh>
  );
}

export default function EditTripPage() {
  return (
    <PageSuspense>
      <Edit />
    </PageSuspense>
  );
}

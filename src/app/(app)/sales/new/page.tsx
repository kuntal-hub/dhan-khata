"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Loading } from "@/components/lists/common";
import { SaleForm } from "@/components/sales/SaleForm";
import {
  Fresh,
  PageSuspense,
  ReadOnlyNotice,
  useParam,
  useWriteGodown,
} from "@/components/system/page";
import { db } from "@/client/db/dexie";

function New() {
  const loadId = useParam("load");
  const { godown, readOnly } = useWriteGodown();
  // `?load=` creates the sale from a load khata entry (§12.5); null = no load.
  const load = useLiveQuery(
    async () => (loadId ? ((await db().vouchers.get(loadId)) ?? null) : null),
    [loadId],
  );
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  if (load === undefined) return <Loading />;
  if (load && (load.type !== "LOAD" || load.godownId !== godown._id || load.status !== "active"))
    return <ReadOnlyNotice reason="notFound" />;
  return (
    <Fresh>
      <SaleForm godown={godown} {...(load?.type === "LOAD" ? { fromLoad: load } : {})} />
    </Fresh>
  );
}

export default function NewSalePage() {
  return (
    <PageSuspense>
      <New />
    </PageSuspense>
  );
}

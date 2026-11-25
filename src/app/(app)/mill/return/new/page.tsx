"use client";

import { ReturnForm } from "@/components/mill/ReturnForm";
import {
  Fresh,
  PageSuspense,
  ReadOnlyNotice,
  useParam,
  useWriteGodown,
} from "@/components/system/page";

function New() {
  const dispatch = useParam("dispatch");
  const { godown, readOnly } = useWriteGodown();
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <Fresh>
      <ReturnForm godown={godown} {...(dispatch ? { dispatchId: dispatch } : {})} />
    </Fresh>
  );
}

export default function NewReturnPage() {
  return (
    <PageSuspense>
      <New />
    </PageSuspense>
  );
}

"use client";

import { ConversionForm } from "@/components/mill/ConversionForm";
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
      <ConversionForm godown={godown} {...(dispatch ? { dispatchId: dispatch } : {})} />
    </Fresh>
  );
}

export default function NewConversionPage() {
  return (
    <PageSuspense>
      <New />
    </PageSuspense>
  );
}

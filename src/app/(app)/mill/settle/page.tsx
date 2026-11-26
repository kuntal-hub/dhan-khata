"use client";

import { FinalSettlementForm } from "@/components/mill/SettleForm";
import {
  Fresh,
  PageSuspense,
  ReadOnlyNotice,
  useParam,
  useWriteGodown,
} from "@/components/system/page";

function Settle() {
  const dispatch = useParam("dispatch");
  const { godown, readOnly } = useWriteGodown();
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <Fresh>
      <FinalSettlementForm godown={godown} {...(dispatch ? { dispatchId: dispatch } : {})} />
    </Fresh>
  );
}

export default function SettlePage() {
  return (
    <PageSuspense>
      <Settle />
    </PageSuspense>
  );
}

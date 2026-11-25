"use client";

import { SecondPartyForm } from "@/components/mill/SecondPartyForm";
import {
  Fresh,
  PageSuspense,
  ReadOnlyNotice,
  useParam,
  useWriteGodown,
} from "@/components/system/page";

function New() {
  const party = useParam("party");
  const { godown, readOnly } = useWriteGodown();
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <Fresh>
      <SecondPartyForm godown={godown} {...(party ? { partyId: party } : {})} />
    </Fresh>
  );
}

export default function NewSecondPartyEntryPage() {
  return (
    <PageSuspense>
      <New />
    </PageSuspense>
  );
}

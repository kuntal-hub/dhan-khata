"use client";

import { PartyProfile } from "@/components/party/PartyProfile";
import { PageSuspense, useParam } from "@/components/system/page";

function Inner() {
  return <PartyProfile id={useParam("id")} tab={useParam("tab")} />;
}

export default function ViewPartyPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

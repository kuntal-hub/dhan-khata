"use client";

import { DispatchForm } from "@/components/mill/DispatchForm";
import { Fresh, ReadOnlyNotice, useWriteGodown } from "@/components/system/page";

export default function NewDispatchPage() {
  const { godown, readOnly } = useWriteGodown();
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <Fresh>
      <DispatchForm godown={godown} />
    </Fresh>
  );
}

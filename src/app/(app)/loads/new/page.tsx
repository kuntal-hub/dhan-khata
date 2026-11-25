"use client";

import { LoadForm } from "@/components/loads/LoadForm";
import { Fresh, ReadOnlyNotice, useWriteGodown } from "@/components/system/page";

export default function NewLoadPage() {
  const { godown, readOnly } = useWriteGodown();
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <Fresh>
      <LoadForm godown={godown} />
    </Fresh>
  );
}

"use client";

import { Fresh, ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { TripForm } from "@/components/vehicles/TripForm";

export default function NewTripPage() {
  const { godown, readOnly } = useWriteGodown();
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <Fresh>
      <TripForm godown={godown} />
    </Fresh>
  );
}

"use client";

import { TripForm } from "@/components/daily/TripForm";
import { Fresh, PageSuspense, useParam } from "@/components/system/page";

function Inner() {
  const vehicleId = useParam("vehicleId");
  return (
    <Fresh>
      <TripForm {...(vehicleId ? { vehicleId } : {})} />
    </Fresh>
  );
}

/** New trip: `?vehicleId=`. */
export default function NewTripPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

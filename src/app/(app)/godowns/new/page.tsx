"use client";

import { GodownWizard } from "@/components/godown/GodownWizard";
import { Fresh, PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { useAppSelector } from "@/store";

function Inner() {
  const id = useParam("id");
  const isOwner = useAppSelector((s) => s.session.isOwner);
  if (!isOwner) return <ReadOnlyNotice reason="viewer" />;
  return (
    <Fresh>
      <GodownWizard {...(id ? { resumeId: id } : {})} />
    </Fresh>
  );
}

/** Add-godown wizard (owner): `?id=` resumes the opening-balance steps of an existing godown. */
export default function NewGodownPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

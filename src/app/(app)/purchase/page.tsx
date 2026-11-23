"use client";

import { PageHeader, ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { VoucherList } from "@/components/vouchers/VoucherList";
import { useActiveGodown } from "@/client/hooks";
import { useT } from "@/i18n/I18nProvider";

/** Purchase list (spec §9.2). */
export default function PurchaseListPage() {
  const t = useT();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  if (!godownId) return <ReadOnlyNotice reason="noGodown" />;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("purchase.title")} />
      <VoucherList
        godownId={godownId}
        type="PURCHASE"
        {...(readOnly ? {} : { newHref: "/purchase/new" })}
      />
    </div>
  );
}

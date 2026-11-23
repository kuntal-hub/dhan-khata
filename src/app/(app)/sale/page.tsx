"use client";

import Link from "next/link";
import { Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { VoucherList } from "@/components/vouchers/VoucherList";
import { useActiveGodown } from "@/client/hooks";
import { useT } from "@/i18n/I18nProvider";

/** Sales list with settled / pending badges (spec §9.3), link to the load khata. */
export default function SaleListPage() {
  const t = useT();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  if (!godownId) return <ReadOnlyNotice reason="noGodown" />;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("sale.title")}
        actions={
          <Button asChild variant="outline" className="h-11">
            <Link href="/load" data-testid="go-load">
              <Truck className="size-4" aria-hidden />
              {t("load.title")}
            </Link>
          </Button>
        }
      />
      {!readOnly ? (
        <Button asChild variant="secondary" className="h-11 self-start">
          <Link href="/load/new" data-testid="new-load">
            <Plus className="size-4" aria-hidden />
            {t("load.newShort")}
          </Link>
        </Button>
      ) : null}
      <VoucherList
        godownId={godownId}
        type="SALE"
        showStatusFilter="settlement"
        {...(readOnly ? {} : { newHref: "/sale/new" })}
      />
    </div>
  );
}

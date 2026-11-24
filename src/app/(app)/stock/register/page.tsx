"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { EmptyState, Loading } from "@/components/lists/common";
import { Money, Qty } from "@/components/money/display";
import { PageHeader, PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { useNames } from "@/components/vouchers/names";
import { viewPathOf } from "@/components/vouchers/VoucherView";
import { useActiveGodown } from "@/client/hooks";
import { stockRegister } from "@/client/queries/stock";
import { dot } from "@/client/ui/text";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

function Inner() {
  const { t, date } = useI18n();
  const varietyId = useParam("varietyId");
  const { godownId, consolidated } = useActiveGodown();
  const names = useNames(godownId);
  const rows = useLiveQuery(
    async () => (godownId && varietyId ? stockRegister(godownId, varietyId) : null),
    [godownId, varietyId],
  );
  if (consolidated) return <ReadOnlyNotice reason="consolidated" />;
  if (!rows || !names) return <Loading />;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={dot(t("stockPage.register"), names.variety(varietyId))} />
      {rows.length === 0 ? (
        <EmptyState text={t("stockPage.noStock")} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="stock-register">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-medium">{t("common.date")}</th>
                <th className="p-2 text-right font-medium">{t("stockPage.movement")}</th>
                <th className="p-2 text-right font-medium">{t("stockPage.balance")}</th>
                <th className="p-2 text-right font-medium">{t("stockPage.value")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.voucherId}-${i}`} className="border-t">
                  <td className="p-2">
                    {r.voucher ? (
                      <Link href={viewPathOf(r.voucher)} className="text-primary underline">
                        {dot(date(r.date, "short"), t(`voucherType.${r.voucher.type}` as TKey))}
                      </Link>
                    ) : (
                      date(r.date, "short")
                    )}
                  </td>
                  <td
                    className={`tabular p-2 text-right whitespace-nowrap ${r.qtyG < 0n ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
                  >
                    <Qty grams={r.qtyG} />
                  </td>
                  <td className="tabular p-2 text-right whitespace-nowrap">
                    <Qty grams={r.balanceQtyG} />
                  </td>
                  <td className="tabular p-2 text-right whitespace-nowrap">
                    <Money paise={r.balanceValuePaise} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Stock register of one variety with running balance: `?varietyId=`. */
export default function StockRegisterPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

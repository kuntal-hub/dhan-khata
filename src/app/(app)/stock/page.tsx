"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRightLeft, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Loading } from "@/components/lists/common";
import { Money, Qty } from "@/components/money/display";
import { PageHeader, PageSuspense, ReadOnlyNotice } from "@/components/system/page";
import { useNames } from "@/components/vouchers/names";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useGodownRole } from "@/client/hooks";
import { stockSummary } from "@/client/queries/stock";
import { dot } from "@/client/ui/text";
import { useI18n } from "@/i18n/I18nProvider";

function Inner() {
  const { t, money, rate, count, weightOf, date } = useI18n();
  const { godownId, godown, consolidated } = useActiveGodown();
  const role = useGodownRole();
  const names = useNames(godownId);
  const data = useLiveQuery(async () => {
    if (!godownId) return null;
    const [rows, pending] = await Promise.all([
      stockSummary(godownId),
      db().transfers.where("[godownId+status]").equals([godownId, "pending"]).toArray(),
    ]);
    return { rows, pending };
  }, [godownId]);
  if (consolidated) return <ReadOnlyNotice reason="consolidated" />;
  if (!data || !names) return <Loading />;
  const writable = role !== null && role !== "viewer" && godown?.status === "active";
  const canTransfer = role === "owner" || role === "manager";
  let qty = 0n;
  let value = 0n;
  for (const r of data.rows) {
    qty += r.qtyG;
    value += r.valuePaise;
  }
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("stockPage.title", { godown: godown?.name ?? "" })} />
      {writable ? (
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline" className="h-auto min-h-12 whitespace-normal">
            <Link href="/stock/adjust" data-testid="stock-adjust">
              <ClipboardCheck className="size-5" aria-hidden />
              {t("stockPage.adjust")}
            </Link>
          </Button>
          {canTransfer ? (
            <Button asChild variant="outline" className="h-auto min-h-12 whitespace-normal">
              <Link href="/transfer" data-testid="stock-transfer">
                <ArrowRightLeft className="size-5" aria-hidden />
                {t("stockPage.transfer")}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {data.pending.length > 0 ? (
        <Card id="pending" data-testid="pending-receipts">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("transfer.pendingTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {data.pending.map((p) => (
              <div
                key={p._id}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {t("transfer.from", { godown: p.fromGodownName })}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {dot(
                      date(p.date, "short"),
                      p.kind === "PADDY" && p.qtyG ? weightOf(BigInt(p.qtyG)) : null,
                      money(BigInt(p.amountPaise)),
                    )}
                  </span>
                </div>
                {writable ? (
                  <Button asChild className="h-11">
                    <Link href={`/transfer/accept?id=${p._id}`} data-testid="pending-accept">
                      {t("transfer.accept")}
                    </Link>
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {data.rows.length === 0 ? (
        <EmptyState text={t("stockPage.noStock")} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="stock-table">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-medium">{t("stockPage.variety")}</th>
                <th className="p-2 text-right font-medium">{t("stockPage.qty")}</th>
                <th className="p-2 text-right font-medium">{t("stockPage.bags")}</th>
                <th className="p-2 text-right font-medium">{t("stockPage.avgCost")}</th>
                <th className="p-2 text-right font-medium">{t("stockPage.value")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.varietyId} className="border-t">
                  <td className="p-2">
                    <Link
                      href={`/stock/register?varietyId=${r.varietyId}`}
                      className="text-primary underline"
                    >
                      {names.variety(r.varietyId)}
                    </Link>
                  </td>
                  <td className="tabular p-2 text-right whitespace-nowrap">
                    <Qty grams={r.qtyG} />
                  </td>
                  <td className="tabular p-2 text-right">
                    {r.bagsEstimate !== null ? count(r.bagsEstimate) : t("stockPage.unknown")}
                  </td>
                  <td className="tabular p-2 text-right whitespace-nowrap">
                    {r.avgCostPerQtl !== null ? rate(r.avgCostPerQtl) : t("stockPage.unknown")}
                  </td>
                  <td className="tabular p-2 text-right whitespace-nowrap">
                    <Money paise={r.valuePaise} />
                  </td>
                </tr>
              ))}
              <tr className="border-t font-semibold">
                <td className="p-2">{t("stockPage.total")}</td>
                <td className="tabular p-2 text-right whitespace-nowrap">
                  <Qty grams={qty} testId="stock-total-qty" />
                </td>
                <td />
                <td />
                <td className="tabular p-2 text-right whitespace-nowrap">
                  <Money paise={value} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** স্টক (spec §9.11): STORE stock of the active godown by variety. */
export default function StockPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VehiclePnlCard } from "@/components/daily/VehiclePnl";
import { EmptyState, Loading } from "@/components/lists/common";
import { Money } from "@/components/money/display";
import { PageHeader, PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { VoucherRow } from "@/components/vouchers/VoucherList";
import { useNames } from "@/components/vouchers/names";
import { viewPathOf } from "@/components/vouchers/VoucherView";
import { useActiveGodown, useGodownRole } from "@/client/hooks";
import { vehicleKhata, vehicleSummary } from "@/client/queries/vehicles";
import { vehicleLabel } from "@/client/ui/labels";
import { dot } from "@/client/ui/text";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

function Inner() {
  const { t, date: fmtDate } = useI18n();
  const id = useParam("id");
  const initialMonth = useParam("month");
  const { godownId, consolidated, godown } = useActiveGodown();
  const role = useGodownRole();
  const names = useNames(godownId);
  const [ym, setYm] = useState(initialMonth ?? todayIST().slice(0, 7));
  const data = useLiveQuery(async () => {
    if (!godownId || !id) return null;
    const [summary, khata] = await Promise.all([
      vehicleSummary(godownId, id, { from: `${ym}-01`, to: `${ym}-31` }),
      vehicleKhata(godownId, id),
    ]);
    return { summary, khata };
  }, [godownId, id, ym]);
  if (consolidated) return <ReadOnlyNotice reason="consolidated" />;
  if (!data || !names) return <Loading />;
  if (!data.summary) return <ReadOnlyNotice reason="notFound" />;
  const { summary, khata } = data;
  const writable = role !== null && role !== "viewer" && godown?.status === "active";
  return (
    <div className="flex flex-col gap-3" data-testid="vehicle-view">
      <PageHeader
        title={vehicleLabel(summary.vehicle)}
        actions={
          writable ? (
            <Button asChild className="h-11">
              <Link href={`/trip/new?vehicleId=${summary.vehicle._id}`}>
                <Plus className="size-4" aria-hidden />
                {t("home.newTrip")}
              </Link>
            </Button>
          ) : null
        }
      />
      <label className="flex flex-col gap-1 text-sm">
        {t("fleet.month")}
        <input
          type="month"
          className="border-input h-12 rounded-md border px-3 text-base"
          value={ym}
          max={todayIST().slice(0, 7)}
          onChange={(e) => e.target.value && setYm(e.target.value)}
        />
      </label>
      <Card>
        <CardContent className="pt-6">
          <VehiclePnlCard pnl={summary.pnl} detailed />
        </CardContent>
      </Card>
      <Tabs defaultValue="trips">
        <TabsList className="w-full">
          <TabsTrigger value="trips" className="min-h-11 flex-1">
            {t("fleet.tripsList")}
          </TabsTrigger>
          <TabsTrigger value="khata" className="min-h-11 flex-1">
            {t("fleet.khata")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="trips">
          {summary.trips.length === 0 ? (
            <EmptyState text={t("fleet.noTrips")} />
          ) : (
            <ul>
              {summary.trips.map((v) => (
                <li key={v._id}>
                  <VoucherRow
                    v={v}
                    partyName={dot(v.loadingPlace, v.unloadingPlace) || names.party(v.hirerPartyId)}
                  />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="khata">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("fleet.khata")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-medium">{t("common.date")}</th>
                    <th className="p-2 text-right font-medium">{t("fleet.income")}</th>
                    <th className="p-2 text-right font-medium">{t("fleet.expense")}</th>
                    <th className="p-2 text-right font-medium">{t("fleet.net")}</th>
                  </tr>
                </thead>
                <tbody>
                  {khata.map((r) => (
                    <tr key={r.voucherId} className="border-t">
                      <td className="p-2">
                        {r.voucher ? (
                          <Link href={viewPathOf(r.voucher)} className="text-primary underline">
                            {dot(
                              fmtDate(r.date, "short"),
                              t(`voucherType.${r.voucher.type}` as TKey),
                            )}
                          </Link>
                        ) : (
                          fmtDate(r.date, "short")
                        )}
                      </td>
                      <td className="tabular p-2 text-right">
                        {r.incomePaise ? <Money paise={r.incomePaise} /> : null}
                      </td>
                      <td className="tabular p-2 text-right">
                        {r.expensePaise ? <Money paise={r.expensePaise} /> : null}
                      </td>
                      <td className="tabular p-2 text-right">
                        <Money paise={r.netPaise} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Per-vehicle khata and P&L: `?id=&month=YYYY-MM`. */
export default function VehicleViewPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VehiclePnlCard } from "@/components/daily/VehiclePnl";
import { EmptyState, Loading } from "@/components/lists/common";
import { PageHeader, PageSuspense, ReadOnlyNotice } from "@/components/system/page";
import { useActiveGodown, useGodownRole } from "@/client/hooks";
import { vehicleSummaries } from "@/client/queries/vehicles";
import { vehicleLabel } from "@/client/ui/labels";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

function monthRange(ym: string): { from: string; to: string } {
  return { from: `${ym}-01`, to: `${ym}-31` };
}

function Inner() {
  const { t } = useI18n();
  const { godownId, consolidated, godown } = useActiveGodown();
  const role = useGodownRole();
  const [ym, setYm] = useState(todayIST().slice(0, 7));
  const list = useLiveQuery(
    async () => (godownId ? vehicleSummaries(godownId, monthRange(ym)) : null),
    [godownId, ym],
  );
  if (consolidated) return <ReadOnlyNotice reason="consolidated" />;
  if (!godownId || !list) return <Loading />;
  const writable = role !== null && role !== "viewer" && godown?.status === "active";
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("fleet.title")}
        actions={
          writable ? (
            <Button asChild className="h-11">
              <Link href="/trip/new" data-testid="trip-new">
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
      {list.length === 0 ? (
        <EmptyState
          text={t("fleet.noVehicles")}
          action={
            <Button asChild variant="outline" className="h-11">
              <Link href="/settings/masters?tab=vehicles">{t("fleet.manage")}</Link>
            </Button>
          }
        />
      ) : (
        list.map((s) => (
          <Card key={s.vehicle._id} data-testid="vehicle-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <Link href={`/vehicle/view?id=${s.vehicle._id}&month=${ym}`} className="underline">
                  {vehicleLabel(s.vehicle)}
                </Link>
                <Badge variant={s.vehicle.ownership === "own" ? "default" : "secondary"}>
                  {t(
                    s.vehicle.ownership === "own"
                      ? "masters.vehicleOwn"
                      : "masters.vehicleExternal",
                  )}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <VehiclePnlCard pnl={s.pnl} />
            </CardContent>
          </Card>
        ))
      )}
      <Button asChild variant="outline" className="h-11 self-start">
        <Link href="/settings/masters?tab=vehicles">{t("fleet.manage")}</Link>
      </Button>
    </div>
  );
}

/** গাড়ির হিসাব (spec §9.7): this month's figures per vehicle. */
export default function VehiclesPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

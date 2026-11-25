"use client";

/**
 * Vehicle Business tabs (requirement_v2 §12.7): ট্রিপ (all trips with income, costs and net
 * profit), গাড়ি অনুযায়ী (each vehicle: trips, income, costs by kind, linked daily expenses, net;
 * add / edit vehicles), খদ্দের অনুযায়ী (customers: income, received, due), আয়-খরচ (by day or by
 * month, optionally one vehicle).
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useDeferredValue, useState } from "react";
import { BarChart3, Pencil, Plus, Truck, Users } from "lucide-react";
import { LazyBarsChart } from "@/components/charts/lazy";
import { Segmented } from "@/components/entry/Fields";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { EmptyState, Panel, Skeleton, TxnCard } from "@/components/kit/Kit";
import { SearchBox } from "@/components/sales/SalesTabs";
import { useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { useActiveGodown } from "@/client/hooks";
import {
  pnlByPeriod,
  tripCustomerSummaries,
  tripRows,
  vehicleSummaries,
  type PnL,
} from "@/client/queries/vehicles";
import { applyDigits } from "@/domain/digits";
import type { Vehicle } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { VehicleForm } from "./VehiclePicker";

function NewTrip() {
  const { t } = useI18n();
  const { readOnly } = useWriteGodown();
  if (readOnly) return null;
  return (
    <Button asChild className="h-12 self-start">
      <Link href="/vehicles/trip/new" data-testid="trip-new">
        {t("quick.trip")}
      </Link>
    </Button>
  );
}

export function TripList() {
  const { t, date, money } = useI18n();
  const { godownId } = useActiveGodown();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const rows = useLiveQuery(() => (godownId ? tripRows(godownId, { q: dq }) : []), [godownId, dq]);
  return (
    <div className="flex flex-col gap-3">
      <NewTrip />
      <SearchBox value={q} onChange={setQ} placeholder={t("veh.search")} testId="trip-search" />
      {rows === undefined ? (
        <Skeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Truck} title={t("veh.empty")} hint={t("veh.emptyHint")} />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="trip-list">
          {rows.map((r, i) => (
            <li key={r.doc._id}>
              <TxnCard
                index={i}
                icon={Truck}
                tone="gold"
                title={`${r.vehicle?.number ?? ""}${r.customer ? ` · ${r.customer.name}` : ""}`}
                subtitle={`${r.doc.loadingLocation} → ${r.doc.destination}`}
                date={`${date(r.doc.transactionDate, "short")} · ${r.doc.number}`}
                amountPaise={BigInt(r.doc.totalIncomePaise)}
                direction="IN"
                {...(r.doc.status === "void"
                  ? { status: "VOID" as const }
                  : r.income
                    ? { status: r.income.status }
                    : {})}
                href={`/vehicles/trip/view?id=${r.doc._id}`}
                testId="trip-row"
                extra={
                  r.doc.status === "active" ? (
                    <span
                      className={`tabular text-xs ${r.netPaise < 0n ? "text-money-out" : "text-emerald-800"}`}
                    >
                      {t("veh.netShort", { amount: money(r.netPaise) })}
                    </span>
                  ) : null
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PnlLines({ p }: { p: PnL }) {
  const { t, money, count } = useI18n();
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-muted-foreground text-xs">{t("veh.trips")}</dt>
        <dd className="tabular">{count(p.trips)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">{t("veh.income")}</dt>
        <dd className="tabular">{money(p.incomePaise)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">{t("veh.cost.DRIVER")}</dt>
        <dd className="tabular">{money(p.cost.DRIVER)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">{t("veh.cost.DIESEL")}</dt>
        <dd className="tabular">{money(p.cost.DIESEL)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">{t("veh.cost.OTHER")}</dt>
        <dd className="tabular">{money(p.cost.OTHER)}</dd>
      </div>
      {p.expensePaise ? (
        <div>
          <dt className="text-muted-foreground text-xs">{t("veh.linkedExpenses")}</dt>
          <dd className="tabular">{money(p.expensePaise)}</dd>
        </div>
      ) : null}
      <div>
        <dt className="text-muted-foreground text-xs">{t("veh.dueIn")}</dt>
        <dd className="tabular">{money(p.dueInPaise)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">{t("veh.net")}</dt>
        <dd
          className={`tabular font-semibold ${p.netPaise < 0n ? "text-money-out" : "text-emerald-800"}`}
        >
          {money(p.netPaise)}
        </dd>
      </div>
    </dl>
  );
}

export function ByVehicle() {
  const { t } = useI18n();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const [edit, setEdit] = useState<Vehicle | "new" | null>(null);
  const rows = useLiveQuery(() => (godownId ? vehicleSummaries(godownId) : []), [godownId]);
  return (
    <div className="flex flex-col gap-3">
      {readOnly ? null : (
        <Button
          className="h-12 self-start"
          onClick={() => setEdit("new")}
          data-testid="vehicle-add"
        >
          <Plus className="size-5" aria-hidden />
          {t("veh.addVehicle")}
        </Button>
      )}
      {rows === undefined ? (
        <Skeleton rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Truck} title={t("veh.noVehicles")} />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="vehicle-list">
          {rows.map((r) => (
            <li key={r.vehicle._id}>
              <Panel
                title={`${r.vehicle.number} · ${t(r.vehicle.ownership === "own" ? "veh.own" : "veh.external")}`}
                action={
                  readOnly ? null : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t("veh.editVehicle")}
                      onClick={() => setEdit(r.vehicle)}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                  )
                }
              >
                {r.vehicle.driverName ? (
                  <p className="text-muted-foreground mb-2 text-sm">
                    {r.vehicle.driverName}
                    {r.vehicle.driverMobile ? (
                      <>
                        {" · "}
                        <a className="text-primary" href={`tel:${r.vehicle.driverMobile}`}>
                          {r.vehicle.driverMobile}
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <PnlLines p={r.pnl} />
              </Panel>
            </li>
          ))}
        </ul>
      )}
      {edit && godownId ? (
        <BottomSheet
          open
          onOpenChange={(o) => !o && setEdit(null)}
          title={edit === "new" ? t("veh.addVehicle") : t("veh.editVehicle")}
        >
          <VehicleForm
            godownId={godownId}
            {...(edit === "new" ? {} : { existing: edit })}
            onDone={() => setEdit(null)}
            onCancel={() => setEdit(null)}
          />
        </BottomSheet>
      ) : null}
    </div>
  );
}

export function ByCustomer() {
  const { t, money } = useI18n();
  const { godownId } = useActiveGodown();
  const rows = useLiveQuery(() => (godownId ? tripCustomerSummaries(godownId) : []), [godownId]);
  return (
    <div className="flex flex-col gap-3">
      {rows === undefined ? (
        <Skeleton rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title={t("veh.noCustomers")} />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="trip-customers">
          {rows.map((r, i) => (
            <li key={r.party._id}>
              <TxnCard
                index={i}
                icon={Users}
                title={r.party.name}
                subtitle={t("veh.customerLine", {
                  trips: r.pnl.trips,
                  income: money(r.pnl.incomePaise),
                  received: money(r.pnl.receivedPaise),
                })}
                amountPaise={r.pnl.dueInPaise}
                direction="IN"
                href={`/dues/party?id=${r.party._id}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function PnlTab() {
  const { t, money, date, digits } = useI18n();
  /** "নভেম্বর ২০২৬" from "2026-11". */
  const monthLabel = (ym: string) =>
    `${t(`calendar.monthLong.${MONTHS[Number(ym.slice(5, 7)) - 1]}` as TKey)} ${applyDigits(ym.slice(0, 4), digits)}`; // float-ok: month index
  const { godownId } = useActiveGodown();
  const [by, setBy] = useState<"day" | "month">("month");
  const [vehicleId, setVehicleId] = useState("");
  const vehicles = useLiveQuery(() => (godownId ? vehicleSummaries(godownId) : []), [godownId]);
  const rows = useLiveQuery(
    () => (godownId ? pnlByPeriod(godownId, by, undefined, undefined, vehicleId || undefined) : []),
    [godownId, by, vehicleId],
  );
  const total = (rows ?? []).reduce(
    (a, r) => ({
      income: a.income + r.pnl.incomePaise,
      cost: a.cost + r.pnl.cost.DRIVER + r.pnl.cost.DIESEL + r.pnl.cost.OTHER,
      exp: a.exp + r.pnl.expensePaise,
      net: a.net + r.pnl.netPaise,
    }),
    { income: 0n, cost: 0n, exp: 0n, net: 0n },
  );
  return (
    <div className="flex flex-col gap-3" data-testid="trip-pnl">
      <div className="grid gap-2 sm:grid-cols-2">
        <Segmented
          label={t("veh.period")}
          value={by}
          options={[
            ["day", t("veh.byDay")],
            ["month", t("veh.byMonth")],
          ]}
          onChange={setBy}
          testId="pnl-by"
        />
        <select
          className="bg-card min-h-11 rounded-xl border px-3 text-sm"
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          aria-label={t("veh.vehicle")}
        >
          <option value="">{t("veh.allVehicles")}</option>
          {(vehicles ?? []).map((v) => (
            <option key={v.vehicle._id} value={v.vehicle._id}>
              {v.vehicle.number}
            </option>
          ))}
        </select>
      </div>
      {rows === undefined ? (
        <Skeleton rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Truck} title={t("veh.empty")} />
      ) : (
        <>
          <Panel title={t("viz.pnlChart")} icon={BarChart3} tone="blue">
            <LazyBarsChart
              testId="pnl-chart"
              series={[
                { key: "income", label: t("veh.income"), color: "var(--chart-1)" },
                { key: "cost", label: t("veh.costs"), color: "var(--chart-4)" },
                { key: "net", label: t("veh.net"), color: "var(--chart-8)" },
              ]}
              rows={[...rows]
                .sort((a, b) => (a.period < b.period ? -1 : 1))
                .slice(-12)
                .map((r) => ({
                  key: r.period,
                  label:
                    by === "day"
                      ? date(r.period, "short").split(" ").slice(0, 2).join(" ")
                      : monthLabel(r.period),
                  values: {
                    income: r.pnl.incomePaise,
                    cost: r.pnl.cost.DRIVER + r.pnl.cost.DIESEL + r.pnl.cost.OTHER,
                    net: r.pnl.netPaise,
                  },
                }))}
            />
          </Panel>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="bg-background sticky left-0 py-2 text-left font-normal">
                    {t("veh.period")}
                  </th>
                  <th className="py-2 text-right font-normal">{t("veh.income")}</th>
                  <th className="py-2 text-right font-normal">{t("veh.costs")}</th>
                  <th className="py-2 text-right font-normal">{t("veh.linkedExpenses")}</th>
                  <th className="py-2 text-right font-normal">{t("veh.net")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.period} data-testid="pnl-row">
                    <td className="bg-background sticky left-0 py-2 whitespace-nowrap">
                      {by === "day" ? date(r.period, "short") : monthLabel(r.period)}
                    </td>
                    <td className="tabular py-2 text-right">{money(r.pnl.incomePaise)}</td>
                    <td className="tabular py-2 text-right">
                      {money(r.pnl.cost.DRIVER + r.pnl.cost.DIESEL + r.pnl.cost.OTHER)}
                    </td>
                    <td className="tabular py-2 text-right">{money(r.pnl.expensePaise)}</td>
                    <td className="tabular py-2 text-right font-semibold">
                      {money(r.pnl.netPaise)}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="bg-background sticky left-0 py-2">{t("dly.total")}</td>
                  <td className="tabular py-2 text-right">{money(total.income)}</td>
                  <td className="tabular py-2 text-right">{money(total.cost)}</td>
                  <td className="tabular py-2 text-right">{money(total.exp)}</td>
                  <td className="tabular py-2 text-right" data-testid="pnl-total-net">
                    {money(total.net)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

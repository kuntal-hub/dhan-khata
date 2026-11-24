"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/forms/fields";
import { PartyPicker, VarietyPicker } from "@/components/forms/pickers";
import { EmptyState, Loading } from "@/components/lists/common";
import { PageHeader, ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { useNames } from "@/components/vouchers/names";
import { VoucherList } from "@/components/vouchers/VoucherList";
import { useActiveGodown, useViewScope } from "@/client/hooks";
import { loadRegister, type ListFilter } from "@/client/queries/vouchers";
import { downloadWorkbook } from "@/client/export/excel";
import { normalizeVehicleNumber, formatVehicleNumber } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";

/** Daily load khata register (spec §9.5): date-wise rows, daily totals, filters, Excel. */
export default function LoadRegisterPage() {
  const { t, money, weightOf, rate, date } = useI18n();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const { entryOnly } = useViewScope();
  const names = useNames(godownId);
  const [f, setF] = useState<ListFilter & { vehicle?: string }>({});
  const rows = useLiveQuery(
    async () => (godownId ? loadRegister(godownId, f) : []),
    [godownId, JSON.stringify(f)],
  );
  if (!godownId) return <ReadOnlyNotice reason="noGodown" />;
  // The `entry` role sees its own loads only, not the godown's register (margins, totals).
  if (entryOnly) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title={t("load.title")} />
        <VoucherList
          godownId={godownId}
          type="LOAD"
          {...(readOnly ? {} : { newHref: "/load/new" })}
        />
      </div>
    );
  }
  const vehicleQ = f.vehicle ? normalizeVehicleNumber(f.vehicle) : "";
  const shown = (rows ?? []).filter((r) => !vehicleQ || r.load.vehicleNumber.includes(vehicleQ));
  const days = new Map<string, typeof shown>();
  for (const r of shown) days.set(r.load.date, [...(days.get(r.load.date) ?? []), r]);
  const headers = [
    t("common.date"),
    t("load.loadPlace"),
    t("load.seller"),
    t("trade.variety"),
    t("trade.netWeight"),
    t("load.toMill"),
    t("sale.vehicleNumber"),
    t("common.amount"),
    t("load.partySell"),
    t("load.millRate"),
    t("load.margin"),
  ];

  const exportXlsx = async () => {
    if (!names) return;
    await downloadWorkbook(`load-khata-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        name: t("load.title"),
        headers,
        moneyCols: [7, 8, 9, 10],
        weightCols: [4],
        rows: shown.map(({ load: l, marginPaise }) => [
          l.date,
          names.place(l.loadPlaceId) || l.loadPlaceText || "",
          l.fromStore ? t("load.fromStore") : names.party(l.fromPartyId),
          names.variety(l.varietyId),
          l.netG,
          names.party(l.toMillPartyId),
          formatVehicleNumber(l.vehicleNumber),
          l.mode === "AGENT" ? (l.commission?.amountPaise ?? "0") : l.totalAmountPaise,
          l.partySellRatePaisePerQtl ?? null,
          l.millRatePaisePerQtl ?? null,
          marginPaise.toString(),
        ]),
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("load.title")}
        actions={
          <Button
            variant="outline"
            className="h-11"
            onClick={() => void exportXlsx()}
            disabled={shown.length === 0}
            data-testid="load-export"
          >
            <Download className="size-4" aria-hidden />
            {t("common.excel")}
          </Button>
        }
      />
      {!readOnly ? (
        <Button asChild className="h-11 self-start">
          <Link href="/load/new" data-testid="list-new">
            <Plus className="size-4" aria-hidden />
            {t("load.newShort")}
          </Link>
        </Button>
      ) : null}
      <div className="grid grid-cols-2 gap-2 rounded-md border p-2">
        <DateField
          label={t("filters.from")}
          value={f.from ?? ""}
          optional
          onChange={(from) => setF({ ...f, from: from || undefined })}
        />
        <DateField
          label={t("filters.to")}
          value={f.to ?? ""}
          optional
          onChange={(to) => setF({ ...f, to: to || undefined })}
        />
        <PartyPicker
          godownId={godownId}
          label={t("filters.party")}
          value={f.partyId}
          onChange={(partyId) => setF({ ...f, partyId })}
          allowClear
        />
        <VarietyPicker
          godownId={godownId}
          label={t("trade.variety")}
          value={f.varietyId}
          onChange={(varietyId) => setF({ ...f, varietyId })}
          allowClear
        />
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          {t("sale.vehicleNumber")}
          <input
            className="border-input h-12 rounded-md border px-3 text-base"
            value={f.vehicle ?? ""}
            onChange={(e) => setF({ ...f, vehicle: e.target.value || undefined })}
          />
        </label>
      </div>
      {!rows || !names ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState text={t("filters.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-md border" data-testid="load-register">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/60">
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={h}
                    className={`px-2 py-2 text-left font-medium ${i === 0 ? "bg-muted sticky left-0" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {[...days.entries()].map(([day, list]) => {
                const totalNet = list.reduce((a, r) => a + BigInt(r.load.netG), 0n);
                const totalAmt = list.reduce(
                  (a, r) =>
                    a +
                    BigInt(
                      r.load.mode === "AGENT"
                        ? (r.load.commission?.amountPaise ?? "0")
                        : r.load.totalAmountPaise,
                    ),
                  0n,
                );
                const totalMargin = list.reduce((a, r) => a + r.marginPaise, 0n);
                return [
                  ...list.map(({ load: l, marginPaise }) => (
                    <tr key={l._id} className="border-t">
                      <td className="bg-background sticky left-0 px-2 py-2">
                        <Link href={`/load/view?id=${l._id}`} className="text-primary underline">
                          {date(l.date, "short")}
                        </Link>
                      </td>
                      <td className="px-2 py-2">
                        {names.place(l.loadPlaceId) || l.loadPlaceText || "—"}
                      </td>
                      <td className="px-2 py-2">
                        {l.fromStore ? t("load.fromStore") : names.party(l.fromPartyId)}
                      </td>
                      <td className="px-2 py-2">{names.variety(l.varietyId)}</td>
                      <td className="px-2 py-2 text-right">{weightOf(BigInt(l.netG))}</td>
                      <td className="px-2 py-2">{names.party(l.toMillPartyId)}</td>
                      <td className="px-2 py-2">{formatVehicleNumber(l.vehicleNumber)}</td>
                      <td className="px-2 py-2 text-right">
                        {money(
                          BigInt(
                            l.mode === "AGENT"
                              ? (l.commission?.amountPaise ?? "0")
                              : l.totalAmountPaise,
                          ),
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {l.partySellRatePaisePerQtl
                          ? rate(BigInt(l.partySellRatePaisePerQtl))
                          : "—"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {l.millRatePaisePerQtl ? rate(BigInt(l.millRatePaisePerQtl)) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right">{money(marginPaise)}</td>
                    </tr>
                  )),
                  <tr key={`${day}-total`} className="bg-muted/40 border-t font-semibold">
                    <td className="bg-muted sticky left-0 px-2 py-2">{t("load.dayTotal")}</td>
                    <td colSpan={3} />
                    <td className="px-2 py-2 text-right">{weightOf(totalNet)}</td>
                    <td colSpan={2} />
                    <td className="px-2 py-2 text-right">{money(totalAmt)}</td>
                    <td colSpan={2} />
                    <td className="px-2 py-2 text-right">{money(totalMargin)}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

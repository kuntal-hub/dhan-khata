"use client";

/**
 * Trip detail (requirement_v2 §12.7): route, vehicle, driver, income with its collections
 * ("+ টাকা পেলাম"), each cost with paid / due and "+ দিন", net profit with the formula, WhatsApp,
 * edit, reverse, history.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Pencil, Printer } from "lucide-react";
import { AddPaymentSheet, PaymentList } from "@/components/entry/Payments";
import { Panel, StatusPill } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { Loading } from "@/components/lists/common";
import { Cell, HistoryPanel, ReverseButton } from "@/components/mill/common";
import { PageTitle } from "@/components/shell/PageTitle";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { paymentsOf } from "@/client/queries/purchases";
import { tripRow } from "@/client/queries/vehicles";
import { voidDoc } from "@/client/repo";
import { formatWeightNumber } from "@/domain/units";
import type { Payment } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { displayVehicleNumber } from "@/domain/vehicleNumber";

function Detail() {
  const { t, money, date, digits, count } = useI18n();
  const router = useRouter();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const [paying, setPaying] = useState<{
    sourceId?: string;
    direction: "IN" | "OUT";
    due: bigint;
  } | null>(null);
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const doc = await db().vouchers.get(id);
    if (!doc || doc.type !== "TRIP") return null;
    const [vehicle, customer, payments] = await Promise.all([
      db().vehicles.get(doc.vehicleId),
      doc.customerPartyId ? db().parties.get(doc.customerPartyId) : undefined,
      paymentsOf(doc._id),
    ]);
    const bySource = new Map<string, Payment[]>();
    for (const p of payments.filter((x) => x.status === "active"))
      bySource.set(p.source.id!, [...(bySource.get(p.source.id!) ?? []), p]);
    return { doc, vehicle, customer, payments, row: tripRow(doc, bySource, vehicle, customer) };
  }, [id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, vehicle, customer, payments, row } = data;
  const voided = doc.status === "void";
  const incomePays = payments.filter((p) => p.source.type === "VEHICLE_TRIP");
  const active = payments.filter((p) => p.status === "active");
  const sumKind = (k: string) =>
    doc.costs.filter((c) => c.kind === k).reduce((s, c) => s + BigInt(c.amountPaise), 0n);
  const waText =
    row.income && row.income.duePaise > 0n && customer
      ? t(doc.dueDate ? "wa.collect" : "wa.collectNoDate", {
          name: customer.name,
          business: business?.name ?? "",
          gola: godown.name,
          amount: money(row.income.duePaise),
          dueDate: doc.dueDate ? date(doc.dueDate, "short") : "",
        })
      : "";

  return (
    <div className="flex flex-col gap-4" data-testid="trip-detail">
      <PageTitle
        title={`${vehicle ? displayVehicleNumber(vehicle.number) : ""}${customer ? ` · ${customer.name}` : ""}`}
        subtitle={`${t("veh.title", { number: doc.number })} · ${date(doc.transactionDate)}`}
        back="/vehicles"
        actions={
          voided ? (
            <StatusPill status="VOID" />
          ) : row.income ? (
            <StatusPill status={row.income.status} />
          ) : null
        }
      />
      <Panel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          <Cell label={t("veh.from")}>{doc.loadingLocation}</Cell>
          <Cell label={t("veh.to")}>{doc.destination}</Cell>
          {doc.driverName ? <Cell label={t("veh.driver")}>{doc.driverName}</Cell> : null}
          <Cell label={t("veh.rateMode")}>
            {t(doc.rateMode === "FIXED" ? "veh.FIXED" : "veh.PER_QTL")}
            {doc.rateMode === "PER_QTL" && doc.qtyG
              ? ` · ${formatWeightNumber(BigInt(doc.qtyG), "QTL", { digits, monKg: business?.monKg })} ${t("ui.unitQtlShort")} × ${money(BigInt(doc.ratePaise))}`
              : ""}
          </Cell>
          <Cell label={t("veh.income")} testId="trip-detail-income">
            <span className="tabular">{money(BigInt(doc.totalIncomePaise))}</span>
          </Cell>
          {doc.dueDate ? <Cell label={t("veh.dueDate")}>{date(doc.dueDate, "short")}</Cell> : null}
          {doc.notes ? (
            <Cell label={t("mill.notes")} wide>
              {doc.notes}
            </Cell>
          ) : null}
        </dl>
      </Panel>

      <Panel title={t("veh.net")}>
        <p
          className={`tabular text-3xl font-semibold ${row.netPaise < 0n ? "text-money-out" : "text-emerald-800"}`}
          data-testid="trip-detail-net"
          data-paise={row.netPaise.toString()}
        >
          {money(row.netPaise)}
        </p>
        <p className="text-muted-foreground tabular text-sm">
          {t("veh.netFormula", {
            income: money(BigInt(doc.totalIncomePaise)),
            driver: money(sumKind("DRIVER")),
            diesel: money(sumKind("DIESEL")),
            other: money(sumKind("OTHER")),
          })}
        </p>
      </Panel>

      {row.income ? (
        <Panel
          title={t("veh.collections")}
          action={
            !voided && !readOnly && row.income.duePaise > 0n ? (
              <Button
                className="h-11"
                onClick={() => setPaying({ direction: "IN", due: row.income!.duePaise })}
                data-testid="add-due-payment"
              >
                {t("sl.addCollection")}
              </Button>
            ) : null
          }
        >
          <div className="mb-2 grid grid-cols-2 gap-3">
            <div className="bg-forest-100/60 rounded-xl p-3">
              <span className="text-muted-foreground text-xs">{t("sl.received")}</span>
              <p className="tabular text-xl font-semibold">{money(row.income.paidPaise)}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <span className="text-xs text-emerald-900">{t("sl.remainingDue")}</span>
              <p
                className="tabular text-xl font-semibold text-emerald-800"
                data-testid="detail-due"
                data-paise={row.income.duePaise.toString()}
              >
                {money(row.income.duePaise > 0n ? row.income.duePaise : 0n)}
              </p>
            </div>
          </div>
          <PaymentList payments={incomePays} godownId={godown._id} />
        </Panel>
      ) : null}

      <Panel title={t("veh.costs")}>
        {row.costs.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("mill.none")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {row.costs.map(({ cost, state }) => {
              const sid = `${doc._id}:${cost.id}`;
              return (
                <li
                  key={cost.id}
                  className="flex flex-col gap-2 rounded-xl border p-3"
                  data-testid="trip-cost-row"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {t(`veh.cost.${cost.kind}`)}
                      {cost.payeeText ? ` · ${cost.payeeText}` : ""}
                      {cost.litresMl
                        ? ` · ${t("veh.litresN", { n: formatWeightNumber(BigInt(cost.litresMl), "KG", { digits }) })}`
                        : ""}
                    </span>
                    <span className="tabular font-semibold">{money(BigInt(cost.amountPaise))}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span
                      className="text-muted-foreground tabular"
                      data-testid="trip-cost-due"
                      data-paise={state.duePaise.toString()}
                    >
                      {t("veh.costPaid", {
                        paid: money(state.paidPaise),
                        due: money(state.duePaise > 0n ? state.duePaise : 0n),
                      })}
                    </span>
                    {!voided && !readOnly && state.duePaise > 0n ? (
                      <Button
                        variant="outline"
                        className="h-10"
                        onClick={() =>
                          setPaying({ sourceId: sid, direction: "OUT", due: state.duePaise })
                        }
                        data-testid="trip-cost-pay"
                      >
                        {t("veh.payCost")}
                      </Button>
                    ) : null}
                  </div>
                  <PaymentList
                    payments={payments.filter((p) => p.source.id === sid)}
                    godownId={godown._id}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {!voided && !readOnly ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Button asChild variant="outline" className="h-12">
            <Link href={`/vehicles/trip/edit?id=${doc._id}`} data-testid="trip-edit">
              <Pencil className="size-5" aria-hidden />
              {t("mill.edit")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-12">
            <Link href={`/print/trip?id=${doc._id}`} data-testid="trip-print">
              <Printer className="size-5" aria-hidden />
              {t("veh.receipt")}
            </Link>
          </Button>
          {customer ? (
            <WhatsAppButton phone={customer.phone} text={waText} className="h-12" />
          ) : null}
          <ReverseButton
            label={t("veh.reverse")}
            testId="trip-reverse"
            body={`${t("veh.reverseBody", { amount: money(BigInt(doc.totalIncomePaise)) })}${active.length ? ` ${t("mill.reverseWithPayments", { count: count(active.length) })}` : ""}`}
            onReverse={async (reason) => {
              await voidDoc(godown._id, doc._id, reason, { withPayments: true });
              router.replace("/vehicles");
            }}
          />
        </div>
      ) : null}
      <HistoryPanel doc={doc} />
      {paying ? (
        <AddPaymentSheet
          open
          onOpenChange={(o) => !o && setPaying(null)}
          godownId={godown._id}
          source={doc}
          duePaise={paying.due}
          direction={paying.direction}
          {...(paying.sourceId ? { sourceId: paying.sourceId } : {})}
        />
      ) : null}
    </div>
  );
}

export default function TripViewPage() {
  return (
    <PageSuspense>
      <Detail />
    </PageSuspense>
  );
}

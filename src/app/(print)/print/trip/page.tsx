"use client";

/** Vehicle trip receipt (requirement_v2 §12.7): route, vehicle, fare, collections, due; bilingual. */
import { useLiveQuery } from "dexie-react-hooks";
import { Loading } from "@/components/lists/common";
import { ReceiptSheet } from "@/components/print/ReceiptSheet";
import { PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { paymentsOf, stateOf } from "@/client/queries/purchases";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { displayVehicleNumber } from "@/domain/vehicleNumber";

function TripReceipt() {
  const { t, money, digits, date } = useI18n();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const business = useBusiness();
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const doc = await db().vouchers.get(id);
    if (!doc || doc.type !== "TRIP") return null;
    const [vehicle, customer, payments] = await Promise.all([
      db().vehicles.get(doc.vehicleId),
      doc.customerPartyId ? db().parties.get(doc.customerPartyId) : undefined,
      paymentsOf(doc._id),
    ]);
    return {
      doc,
      vehicle,
      customer,
      payments: payments.filter((p) => p.status === "active" && p.source.type === "VEHICLE_TRIP"),
    };
  }, [id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, vehicle, customer, payments } = data;
  const st = stateOf(doc, payments);
  const rows: Array<[string, string]> = [
    ...(customer ? ([[t("veh.customer"), customer.name]] as Array<[string, string]>) : []),
    [t("veh.vehicle"), vehicle ? displayVehicleNumber(vehicle.number) : ""],
    ...(doc.driverName ? ([[t("veh.driver"), doc.driverName]] as Array<[string, string]>) : []),
    [t("rep.c.route"), `${doc.loadingLocation} → ${doc.destination}`],
    [
      t("veh.rateMode"),
      doc.rateMode === "PER_QTL" && doc.qtyG
        ? `${formatWeightNumber(BigInt(doc.qtyG), "QTL", { digits, monKg: business?.monKg })} ${t("ui.unitQtlShort")} × ${money(BigInt(doc.ratePaise))}`
        : t("veh.FIXED"),
    ],
    ...payments.map(
      (p) =>
        [
          `${t("sl.received")} ${date(p.paymentDate, "short")} · ${t(`pay.${p.mode}` as TKey)}`,
          money(BigInt(p.amountPaise)),
        ] as [string, string],
    ),
    ...(st
      ? ([
          [t("rcpt.paidSoFar"), money(st.paidPaise)],
          [t("rcpt.dueNow"), money(st.duePaise > 0n ? st.duePaise : 0n)],
        ] as Array<[string, string]>)
      : []),
  ];
  return (
    <ReceiptSheet
      godown={godown}
      title={t("veh.receiptTitle")}
      number={doc.number}
      date={doc.transactionDate}
      phone={customer?.phone}
      rows={rows}
      totalLabel={t("veh.income")}
      totalPaise={BigInt(doc.totalIncomePaise)}
      testId="trip-receipt"
    />
  );
}

export default function PrintTripPage() {
  return (
    <PageSuspense>
      <TripReceipt />
    </PageSuspense>
  );
}

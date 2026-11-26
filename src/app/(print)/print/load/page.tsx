"use client";

/** Loading slip (requirement_v2 §12.5): bilingual; logo, Gola, vehicle, driver, bags/weights, party, mill. */
import { useLiveQuery } from "dexie-react-hooks";
import { varietyName } from "@/components/entry/Variety";
import { Loading } from "@/components/lists/common";
import { ReceiptSheet } from "@/components/print/ReceiptSheet";
import { PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import { displayVehicleNumber } from "@/domain/vehicleNumber";

function LoadSlip() {
  const { t, money, digits, count } = useI18n();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const business = useBusiness();
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const doc = await db().vouchers.get(id);
    if (!doc || doc.type !== "LOAD") return null;
    const [from, mill, variety] = await Promise.all([
      doc.fromPartyId ? db().parties.get(doc.fromPartyId) : undefined,
      doc.destinationMillId ? db().parties.get(doc.destinationMillId) : undefined,
      db().varieties.get(doc.varietyId),
    ]);
    return { doc, from, mill, variety };
  }, [id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, from, mill, variety } = data;
  const o = { digits, monKg: business?.monKg };
  const net = BigInt(doc.weight.netG);
  const bags = doc.weight.mode === "BAGS" ? (doc.weight.bags ?? []) : [];
  const rows: Array<[string, string]> = [
    [t("ld.vehicle"), displayVehicleNumber(doc.vehicleNumber)],
    ...(doc.driverName ? ([[t("ld.driver"), doc.driverName]] as Array<[string, string]>) : []),
    ...(from ? ([[t("ld.from"), from.name]] as Array<[string, string]>) : []),
    ...(mill ? ([[t("ld.mill"), mill.name]] as Array<[string, string]>) : []),
    [t("pur.variety"), varietyName(variety, t)],
    [
      t("ld.quantity"),
      `${formatWeightNumber(net, "QTL", o)} ${t("ui.unitQtlShort")} (${formatWeightNumber(net, "KG", o)} ${t("ui.unitKg")})`,
    ],
    ...(bags.length || doc.weight.bagCount
      ? ([[t("rcpt.bags"), count(bags.length || doc.weight.bagCount || 0)]] as Array<
          [string, string]
        >)
      : []),
    [t("ld.rate"), money(BigInt(doc.ratePaisePerQtl))],
  ];
  return (
    <ReceiptSheet
      godown={godown}
      title={t("ld.slipTitle")}
      number={doc.number}
      date={doc.transactionDate}
      rows={rows}
      totalLabel={t("ld.total")}
      totalPaise={BigInt(doc.totalPaise)}
      testId="load-slip"
    >
      {bags.length ? (
        <p className="text-muted-foreground tabular py-2 text-xs">
          {bags
            .map((b) =>
              t("wt.bagChip", {
                n: count(b.seq),
                w: formatWeightNumber(BigInt(b.weightG), "KG", o),
                unit: t("ui.unitKg"),
              }),
            )
            .join(" · ")}
        </p>
      ) : null}
    </ReceiptSheet>
  );
}

export default function PrintLoadPage() {
  return (
    <PageSuspense>
      <LoadSlip />
    </PageSuspense>
  );
}

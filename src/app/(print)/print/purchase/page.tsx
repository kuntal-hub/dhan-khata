"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { varietyName } from "@/components/entry/Variety";
import { Loading } from "@/components/lists/common";
import { ReceiptSheet } from "@/components/print/ReceiptSheet";
import { PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { paymentsOf, stateOf } from "@/client/queries/purchases";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";

function PurchaseReceipt() {
  const { t, money, digits, count, date } = useI18n();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const business = useBusiness();
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const doc = await db().vouchers.get(id);
    if (!doc || doc.type !== "PURCHASE") return null;
    const [party, variety, payments] = await Promise.all([
      db().parties.get(doc.partyId),
      db().varieties.get(doc.varietyId),
      paymentsOf(doc._id),
    ]);
    return { doc, party, variety, payments: payments.filter((p) => p.status === "active") };
  }, [id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, party, variety, payments } = data;
  const st = stateOf(doc, payments)!;
  const o = { digits, monKg: business?.monKg };
  const net = BigInt(doc.weight.netG);
  const bags = doc.weight.mode === "BAGS" ? (doc.weight.bags ?? []) : [];
  return (
    <ReceiptSheet
      godown={godown}
      title={t("rcpt.purchaseTitle")}
      number={doc.number}
      date={doc.transactionDate}
      phone={party?.phone}
      rows={[
        [t("pur.farmer"), party?.name ?? ""],
        [t("pur.variety"), varietyName(variety, t)],
        [
          t("pur.quantity"),
          `${formatWeightNumber(net, "QTL", o)} ${t("ui.unitQtlShort")} (${formatWeightNumber(net, "KG", o)} ${t("ui.unitKg")})`,
        ],
        ...(doc.weight.bagCount || bags.length
          ? ([[t("rcpt.bags"), count(bags.length || doc.weight.bagCount || 0)]] as Array<
              [string, string]
            >)
          : []),
        [t("pur.rate"), money(BigInt(doc.ratePaisePerQtl))],
        ...payments.map(
          (p) =>
            [
              `${t("pay.date")} ${date(p.paymentDate, "short")} · ${t(`pay.${p.mode}`)}`,
              money(BigInt(p.amountPaise)),
            ] as [string, string],
        ),
        [t("rcpt.paidSoFar"), money(st.paidPaise)],
        [t("rcpt.dueNow"), money(st.duePaise)],
      ]}
      totalLabel={t("pur.total")}
      totalPaise={BigInt(doc.totalPaise)}
      testId="purchase-receipt"
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

export default function PrintPurchasePage() {
  return (
    <PageSuspense>
      <PurchaseReceipt />
    </PageSuspense>
  );
}

"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Loading } from "@/components/lists/common";
import { ReceiptSheet } from "@/components/print/ReceiptSheet";
import { PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { sourceDocId } from "@/domain/scope";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

function PaymentReceipt() {
  const { t, money, date } = useI18n();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const business = useBusiness();
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const doc = await db().vouchers.get(id);
    if (!doc || doc.type !== "PAYMENT") return null;
    const srcId = doc.source.id ? sourceDocId(doc.source.id) : undefined;
    const [party, source, bank] = await Promise.all([
      doc.partyId ? db().parties.get(doc.partyId) : undefined,
      srcId ? db().vouchers.get(srcId) : undefined,
      doc.bankAccountId ? db().bankAccounts.get(doc.bankAccountId) : undefined,
    ]);
    return { doc, party, source, bank };
  }, [id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, party, source, bank } = data;
  const amount = BigInt(doc.amountPaise);
  const name = party?.name ?? doc.personName ?? "";
  return (
    <ReceiptSheet
      godown={godown}
      title={doc.direction === "OUT" ? t("rcpt.paymentOut") : t("rcpt.paymentIn")}
      number={doc.number}
      date={doc.paymentDate}
      phone={party?.phone}
      waText={t("wa.receipt", {
        name,
        business: business?.name ?? "",
        gola: godown.name,
        date: date(doc.paymentDate, "short"),
        amount: money(amount),
        direction: doc.direction === "OUT" ? t("wa.paidWord") : t("wa.receivedWord"),
        number: doc.number,
      })}
      rows={[
        [doc.direction === "OUT" ? t("rcpt.to") : t("rcpt.from"), name],
        [t("pay.mode"), t(`pay.${doc.mode}` as TKey)],
        ...(bank
          ? ([[t("pay.bankAccount"), `${bank.name} · ••${bank.last4}`]] as Array<[string, string]>)
          : []),
        ...(doc.reference
          ? ([[t("pay.reference"), doc.reference]] as Array<[string, string]>)
          : []),
        [
          t("rcpt.against"),
          source && "number" in source
            ? `${t(`voucherType.${source.type}` as TKey)} ${source.number}`
            : t("rcpt.advance"),
        ],
      ]}
      totalLabel={t("pay.amount")}
      totalPaise={amount}
      testId="payment-receipt"
    />
  );
}

export default function PrintPaymentPage() {
  return (
    <PageSuspense>
      <PaymentReceipt />
    </PageSuspense>
  );
}

"use client";

/**
 * Second-party entry detail (requirement_v2 §12.8A): we owe / they owe, amount, paid / remaining,
 * every payment with its own date ("+ টাকা দিন / + টাকা পেলাম", edit / reverse), edit, reverse,
 * history.
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { AddPaymentSheet, PaymentList } from "@/components/entry/Payments";
import { Panel, StatusPill } from "@/components/kit/Kit";
import { Loading } from "@/components/lists/common";
import { Cell, HistoryPanel, ReverseButton } from "@/components/mill/common";
import { PageTitle } from "@/components/shell/PageTitle";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { useActiveGodown } from "@/client/hooks";
import { paymentsOf, stateOf } from "@/client/queries/purchases";
import { voidDoc } from "@/client/repo";
import { useI18n } from "@/i18n/I18nProvider";

function Detail() {
  const { t, money, date, count } = useI18n();
  const router = useRouter();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const [paying, setPaying] = useState(false);
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const doc = await db().vouchers.get(id);
    if (!doc || doc.type !== "SECOND_PARTY") return null;
    const [party, payments] = await Promise.all([
      db().parties.get(doc.partyId),
      paymentsOf(doc._id),
    ]);
    return { doc, party, payments };
  }, [id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, party, payments } = data;
  const active = payments.filter((p) => p.status === "active");
  const st = stateOf(doc, active)!;
  const voided = doc.status === "void";
  const we = doc.kind === "WE_OWE";

  return (
    <div className="flex flex-col gap-4" data-testid="sp-entry-detail">
      <PageTitle
        title={party?.name ?? ""}
        subtitle={`${t("mill.spEntryTitle", { number: doc.number })} · ${date(doc.transactionDate)}`}
        back={`/mill/party?id=${doc.partyId}`}
        actions={<StatusPill status={voided ? "VOID" : st.status} />}
        edit={
          !voided && !readOnly
            ? { href: `/mill/entry/edit?id=${doc._id}`, label: t("act.edit"), testId: "sp-edit" }
            : null
        }
      />
      <Panel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          <Cell label={t("mill.spKind")}>{t(`mill.${doc.kind}`)}</Cell>
          <Cell label={t("mill.spAmount")}>
            <span className="tabular">{money(BigInt(doc.amountPaise))}</span>
          </Cell>
          {doc.notes ? (
            <Cell label={t("mill.notes")} wide>
              {doc.notes}
            </Cell>
          ) : null}
        </dl>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="bg-forest-100/60 rounded-xl p-3">
            <span className="text-muted-foreground text-xs">
              {we ? t("mill.spPaid") : t("sl.received")}
            </span>
            <p className="tabular text-xl font-semibold" data-testid="detail-paid">
              {money(st.paidPaise)}
            </p>
          </div>
          <div className={we ? "rounded-xl bg-red-50 p-3" : "rounded-xl bg-emerald-50 p-3"}>
            <span className="text-xs">{we ? t("mill.spBalanceWe") : t("mill.spBalanceThey")}</span>
            <p
              className="tabular text-xl font-semibold"
              data-testid="detail-due"
              data-paise={st.duePaise.toString()}
            >
              {money(st.duePaise > 0n ? st.duePaise : 0n)}
            </p>
          </div>
        </div>
      </Panel>
      <Panel
        title={t("mill.payments")}
        action={
          !voided && !readOnly && st.duePaise > 0n ? (
            <Button className="h-11" onClick={() => setPaying(true)} data-testid="add-due-payment">
              {t(`mill.spAddPay${doc.kind}`)}
            </Button>
          ) : null
        }
      >
        <PaymentList payments={payments} godownId={godown._id} />
      </Panel>
      {!voided && !readOnly ? (
        <div className="grid grid-cols-2 gap-3">
          <ReverseButton
            label={t("mill.spReverse")}
            body={`${t("mill.spReverseConfirm", { amount: money(BigInt(doc.amountPaise)) })}${active.length ? ` ${t("mill.reverseWithPayments", { count: count(active.length) })}` : ""}`}
            onReverse={async (reason) => {
              await voidDoc(godown._id, doc._id, reason, { withPayments: true });
              router.replace(`/mill/party?id=${doc.partyId}`);
            }}
          />
        </div>
      ) : null}
      <HistoryPanel doc={doc} />
      {paying ? (
        <AddPaymentSheet
          open={paying}
          onOpenChange={setPaying}
          godownId={godown._id}
          source={doc}
          duePaise={st.duePaise}
          direction={we ? "OUT" : "IN"}
        />
      ) : null}
    </div>
  );
}

export default function SecondPartyEntryViewPage() {
  return (
    <PageSuspense>
      <Detail />
    </PageSuspense>
  );
}

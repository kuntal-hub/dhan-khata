"use client";

/**
 * Purchase detail (requirement_v2 §12.2): all fields, bag list, payment ledger with
 * "+ বাকি টাকা দিন" (any amount, any day; `?pay=1` opens it), edit / reverse per payment with the
 * remaining due after each, remaining due (big), the optional due date with "তারিখ বদলান" (D54),
 * receipts, purchase bill, WhatsApp, and the change history.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { History, Printer, Undo2 } from "lucide-react";
import { DueDatePanel } from "@/components/entry/DueDate";
import { AddPaymentSheet, PaymentList } from "@/components/entry/Payments";
import { varietyName } from "@/components/entry/Variety";
import { Panel, QtyTriple, StatusPill } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { Loading } from "@/components/lists/common";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { paymentsOf, stateOf } from "@/client/queries/purchases";
import { voidDoc, voidInterGolaTransfer } from "@/client/repo";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";

function Detail() {
  const { t, money, date, digits, count } = useI18n();
  const router = useRouter();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const doc = await db().vouchers.get(id);
    if (!doc || doc.type !== "PURCHASE") return null;
    const [party, variety, payments, audit] = await Promise.all([
      db().parties.get(doc.partyId),
      db().varieties.get(doc.varietyId),
      paymentsOf(doc._id),
      db()
        .auditLocal.where("at")
        .above("")
        .filter((a) => a.entityId === doc._id)
        .toArray(),
    ]);
    return { doc, party, variety, payments, audit };
  }, [id]);
  const [paying, setPaying] = useState(useParam("pay") === "1");
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, party, variety, payments } = data;
  const active = payments.filter((p) => p.status === "active");
  const st = stateOf(doc, active)!;
  const voided = doc.status === "void";
  const status = voided ? "VOID" : st.status;
  const o = { digits, monKg: business?.monKg };
  const bags = doc.weight.mode === "BAGS" ? (doc.weight.bags ?? []) : [];
  const waText =
    st.duePaise > 0n
      ? t(doc.dueDate ? "wa.pay" : "wa.payNoDate", {
          name: party?.name ?? "",
          business: business?.name ?? "",
          gola: godown.name,
          amount: money(st.duePaise),
          dueDate: doc.dueDate ? date(doc.dueDate, "short") : "",
        })
      : "";

  return (
    <div className="flex flex-col gap-4" data-testid="purchase-detail">
      <PageTitle
        title={party?.name ?? ""}
        subtitle={`${t("pur.bill", { number: doc.number })} · ${date(doc.transactionDate)}`}
        back="/purchase"
        actions={<StatusPill status={status} />}
        edit={
          !voided && !readOnly && !doc.interGola
            ? {
                href: `/purchase/edit?id=${doc._id}`,
                label: t("act.edit"),
                testId: "purchase-edit",
              }
            : null
        }
      />
      <Panel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          <div>
            <dt className="text-muted-foreground text-xs">{t("pur.variety")}</dt>
            <dd className="font-medium" data-testid="detail-variety">
              {varietyName(variety, t)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("pur.quantity")}</dt>
            <dd className="font-medium">
              <QtyTriple grams={BigInt(doc.weight.netG)} testId="detail-qty" />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("pur.rate")}</dt>
            <dd className="tabular font-medium">{money(BigInt(doc.ratePaisePerQtl))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("pur.total")}</dt>
            <dd className="tabular font-semibold" data-testid="detail-total">
              {money(BigInt(doc.totalPaise))}
            </dd>
          </div>
          {party?.phone ? (
            <div>
              <dt className="text-muted-foreground text-xs">{t("pur.mobile")}</dt>
              <dd>
                <a className="text-primary" href={`tel:${party.phone}`}>
                  {party.phone}
                </a>
              </dd>
            </div>
          ) : null}
          {doc.notes ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground text-xs">{t("pur.notes")}</dt>
              <dd>{doc.notes}</dd>
            </div>
          ) : null}
        </dl>
        {bags.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid="detail-bags">
            {bags.map((b) => (
              <span
                key={b.id}
                className="bg-gold-100 text-accent-foreground tabular rounded-full px-2.5 py-1 text-xs"
              >
                {t("wt.bagChip", {
                  n: count(b.seq),
                  w: formatWeightNumber(BigInt(b.weightG), "KG", o),
                  unit: t("ui.unitKg"),
                })}
              </span>
            ))}
          </div>
        ) : null}
        {doc.legacyCharges?.length ? (
          <ul className="text-muted-foreground mt-3 text-sm">
            {doc.legacyCharges.map((c, i) => (
              <li key={i}>
                {c.kind === "add" ? "+" : "−"} {c.label}: {money(BigInt(c.amountPaise))}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-forest-100/60 rounded-xl p-3">
            <span className="text-muted-foreground text-xs">{t("pur.paid")}</span>
            <p className="tabular text-xl font-semibold" data-testid="detail-paid">
              {money(st.paidPaise)}
            </p>
          </div>
          <div className="rounded-xl bg-red-50 p-3">
            <span className="text-xs text-red-900">{t("pur.remainingDue")}</span>
            <p
              key={st.duePaise.toString()}
              className="tabular anim-pop text-2xl font-semibold text-red-800"
              data-testid="detail-due"
              data-paise={st.duePaise.toString()}
            >
              {money(st.duePaise)}
            </p>
          </div>
        </div>
        <div className="mt-3">
          <DueDatePanel
            doc={doc}
            label={t("pur.dueDate")}
            remainingPaise={voided ? 0n : st.duePaise}
            writable={!voided && !readOnly}
          />
        </div>
      </Panel>

      <Panel
        title={t("pur.payments")}
        action={
          !voided && !readOnly && st.duePaise > 0n ? (
            <Button className="h-11" onClick={() => setPaying(true)} data-testid="add-due-payment">
              {t("pur.addDuePayment")}
            </Button>
          ) : null
        }
      >
        <PaymentList
          payments={payments}
          godownId={godown._id}
          bill={{ totalPaise: st.bill.totalPaise, direction: "OUT", date: doc.transactionDate }}
        />
      </Panel>

      {!voided && !readOnly ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {doc.interGola ? (
            <p className="text-muted-foreground col-span-2 self-center text-sm">
              {t("sl.transferNoEdit")}
            </p>
          ) : null}
          <Button asChild variant="outline" className="h-12">
            <Link href={`/print/purchase?id=${doc._id}`}>
              <Printer className="size-5" aria-hidden />
              {t("pur.printReceipt")}
            </Link>
          </Button>
          <WhatsAppButton phone={party?.phone} text={waText} className="h-12" />
          <Button
            variant="outline"
            className="text-destructive h-12"
            onClick={() => setReversing(true)}
            data-testid="purchase-reverse"
          >
            <Undo2 className="size-5" aria-hidden />
            {doc.interGola ? t("sl.transferReverse") : t("pur.reverse")}
          </Button>
        </div>
      ) : null}

      <Panel title={t("pur.history")}>
        <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
          <li className="flex items-center gap-2">
            <History className="size-4" aria-hidden />
            {t("hist.created", { date: date(doc.entryDate, "short") })}
          </li>
          {doc.rev > 1 ? (
            <li>
              {t("hist.edited", {
                date: date(doc.updatedAt.slice(0, 10), "short"),
                rev: count(doc.rev),
              })}
            </li>
          ) : null}
          {doc.editReason ? <li>{t("hist.reason", { reason: doc.editReason })}</li> : null}
          {voided ? <li>{t("hist.voided", { reason: doc.voidReason ?? "" })}</li> : null}
        </ul>
      </Panel>

      {paying && !voided && !readOnly && st.duePaise > 0n ? (
        <AddPaymentSheet
          open={paying}
          onOpenChange={setPaying}
          godownId={godown._id}
          source={doc}
          duePaise={st.duePaise}
          direction="OUT"
          totalPaise={st.bill.totalPaise}
          paidPaise={st.paidPaise}
        />
      ) : null}
      <ConfirmDialog
        open={reversing}
        onOpenChange={setReversing}
        title={doc.interGola ? t("sl.transferReverse") : t("pur.reverse")}
        body={`${t("pur.reverseConfirm", { qty: `${formatWeightNumber(BigInt(doc.weight.netG), "QTL", o)} ${t("ui.unitQtlShort")}`, amount: money(BigInt(doc.totalPaise)) })}${active.length ? ` ${t("pur.reverseWithPayments", { count: count(active.length) })}` : ""}`}
        confirmLabel={t("pur.reverse")}
        onConfirm={async () => {
          if (!reason.trim()) return lazyToast(t("pay.reasonRequired"), "error");
          try {
            if (doc.interGola) await voidInterGolaTransfer(godown._id, doc._id, reason.trim());
            else await voidDoc(godown._id, doc._id, reason.trim(), { withPayments: true });
            lazyToast(t("pur.reversed"), "success");
            setReversing(false);
            router.replace("/purchase");
          } catch (e) {
            lazyToast(t(errorKey(e)), "error");
          }
        }}
      >
        <Input
          className="h-12 text-base"
          placeholder={t("pay.reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="reverse-reason"
        />
      </ConfirmDialog>
    </div>
  );
}

export default function PurchaseViewPage() {
  return (
    <PageSuspense>
      <Detail />
    </PageSuspense>
  );
}

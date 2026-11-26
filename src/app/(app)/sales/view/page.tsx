"use client";

/**
 * Sale detail (requirement_v2 §12.3): all fields, bag list, collections ledger with
 * "+ টাকা পেলাম", edit / reverse per collection, remaining due (big), delivery timeline with the
 * next step, confirm an order, invoice, WhatsApp, history. A Gola transfer shows its pair and can
 * only be voided as a whole.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  Factory,
  History,
  Pencil,
  Printer,
  Truck,
  Undo2,
} from "lucide-react";
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
import {
  confirmSaleOrder,
  setDeliveryStatus,
  voidDoc,
  voidInterGolaTransfer,
  voidSettlement,
  type DeliveryStatus,
} from "@/client/repo";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { displayVehicleNumber } from "@/domain/vehicleNumber";

const STEPS: readonly DeliveryStatus[] = ["PENDING", "LOADED", "IN_TRANSIT", "DELIVERED"];

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
    if (!doc || doc.type !== "SALE") return null;
    const [party, variety, payments, mill, counter] = await Promise.all([
      db().parties.get(doc.partyId),
      db().varieties.get(doc.varietyId),
      paymentsOf(doc._id),
      doc.sourceMillId ? db().parties.get(doc.sourceMillId) : undefined,
      doc.interGola ? db().godowns.get(doc.interGola.counterGodownId) : undefined,
    ]);
    return { doc, party, variety, payments, mill, counter };
  }, [id]);
  const [paying, setPaying] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, party, variety, payments, mill, counter } = data;
  const active = payments.filter((p) => p.status === "active");
  const st = stateOf(doc, active)!;
  const voided = doc.status === "void";
  const isOrder = doc.saleStatus === "ORDER";
  const status = voided ? "VOID" : isOrder ? "ORDER" : st.status;
  const o = { digits, monKg: business?.monKg };
  const qty = `${formatWeightNumber(BigInt(doc.weight.netG), "QTL", o)} ${t("ui.unitQtlShort")}`;
  const bags = doc.weight.mode === "BAGS" ? (doc.weight.bags ?? []) : [];
  const stepIdx = STEPS.indexOf(doc.deliveryStatus);
  const next = STEPS[stepIdx + 1];
  const waText =
    st.duePaise > 0n
      ? t(doc.dueDate ? "wa.collect" : "wa.collectNoDate", {
          name: party?.name ?? "",
          business: business?.name ?? "",
          gola: godown.name,
          amount: money(st.duePaise),
          dueDate: doc.dueDate ? date(doc.dueDate, "short") : "",
        })
      : "";
  const loggedAt = (s: DeliveryStatus) => doc.deliveryLog.filter((l) => l.status === s).at(-1);

  return (
    <div className="flex flex-col gap-4" data-testid="sale-detail">
      <PageTitle
        title={party?.name ?? ""}
        subtitle={`${t("sl.invoice", { number: doc.number })} · ${date(doc.transactionDate)}`}
        back="/sales"
        actions={<StatusPill status={status} />}
      />
      {doc.interGola ? (
        <p
          className="bg-gold-100 text-accent-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
          data-testid="sale-transfer-badge"
        >
          <ArrowRightLeft className="size-4" aria-hidden />
          {t("sl.transferBadge", { gola: counter?.name ?? "" })}
        </p>
      ) : null}
      {doc.consignmentDispatchId ? (
        <Link
          href={`/mill/dispatch/view?id=${doc.consignmentDispatchId}`}
          className="bg-gold-100 text-accent-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
          data-testid="sale-settlement-badge"
        >
          <Factory className="size-4" aria-hidden />
          {t("mill.settlementBadge")}
        </Link>
      ) : null}
      <Panel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          <div>
            <dt className="text-muted-foreground text-xs">{t("sl.product")}</dt>
            <dd className="font-medium">{t(`sl.${doc.product}` as TKey)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("pur.variety")}</dt>
            <dd className="font-medium" data-testid="detail-variety">
              {varietyName(variety, t)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("sl.quantity")}</dt>
            <dd className="font-medium">
              <QtyTriple grams={BigInt(doc.weight.netG)} testId="detail-qty" />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("sl.rate")}</dt>
            <dd className="tabular font-medium">{money(BigInt(doc.ratePaisePerQtl))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("sl.total")}</dt>
            <dd className="tabular font-semibold" data-testid="detail-total">
              {money(BigInt(doc.totalPaise))}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("sl.source")}</dt>
            <dd>
              {t(`sl.src${doc.source}` as TKey)}
              {mill ? ` · ${mill.name}` : ""}
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
          {doc.dueDate ? (
            <div>
              <dt className="text-muted-foreground text-xs">{t("sl.dueDate")}</dt>
              <dd>{date(doc.dueDate, "short")}</dd>
            </div>
          ) : null}
          {doc.vehicleNumber || doc.driverName ? (
            <div>
              <dt className="text-muted-foreground text-xs">{t("sl.vehicle")}</dt>
              <dd>
                {[doc.vehicleNumber && displayVehicleNumber(doc.vehicleNumber), doc.driverName]
                  .filter(Boolean)
                  .join(" · ")}
              </dd>
            </div>
          ) : null}
          {doc.charges ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground text-xs">{t("sl.charges")}</dt>
              <dd className="tabular text-sm">
                {[
                  doc.charges.loadingPaise
                    ? `${t("sl.loading")} ${money(BigInt(doc.charges.loadingPaise))}`
                    : "",
                  doc.charges.freightPaise
                    ? `${t("sl.freight")} ${money(BigInt(doc.charges.freightPaise))}`
                    : "",
                  doc.charges.vehicleAdvancePaise
                    ? `${t("sl.vehicleAdvance")} ${money(BigInt(doc.charges.vehicleAdvancePaise))}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </dd>
            </div>
          ) : null}
          {doc.notes ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground text-xs">{t("sl.notes")}</dt>
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
        {isOrder && !voided && !readOnly ? (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {t("sl.orderHint")}
            <Button
              className="h-11 self-start"
              onClick={() => setConfirming(true)}
              data-testid="sale-confirm-order"
            >
              <CheckCircle2 className="size-5" aria-hidden />
              {t("sl.confirmOrder")}
            </Button>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-forest-100/60 rounded-xl p-3">
            <span className="text-muted-foreground text-xs">{t("sl.received")}</span>
            <p className="tabular text-xl font-semibold" data-testid="detail-paid">
              {money(st.paidPaise)}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <span className="text-xs text-emerald-900">{t("sl.remainingDue")}</span>
            <p
              className="tabular text-2xl font-semibold text-emerald-800"
              data-testid="detail-due"
              data-paise={st.duePaise.toString()}
            >
              {money(st.duePaise)}
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        title={t("sl.collections")}
        action={
          !voided && !readOnly && st.duePaise > 0n ? (
            <Button className="h-11" onClick={() => setPaying(true)} data-testid="add-due-payment">
              {t("sl.addCollection")}
            </Button>
          ) : null
        }
      >
        <PaymentList payments={payments} godownId={godown._id} />
      </Panel>

      <Panel title={t("sl.timeline")}>
        <ol className="flex flex-col gap-0" data-testid="delivery-timeline">
          {STEPS.map((s, i) => {
            const done = i <= stepIdx;
            const at = loggedAt(s);
            return (
              <li key={s} className="flex items-start gap-3 pb-3 last:pb-0">
                <span
                  className={cn(
                    "mt-1 size-3 shrink-0 rounded-full border-2",
                    done ? "border-primary bg-primary" : "border-muted-foreground/40",
                  )}
                  aria-hidden
                />
                <span className="flex flex-col">
                  <span
                    className={cn("text-[15px]", done ? "font-medium" : "text-muted-foreground")}
                  >
                    {t(`sl.delivery.${s}` as TKey)}
                  </span>
                  {at ? (
                    <span className="text-muted-foreground text-xs">
                      {date(at.at.slice(0, 10), "short")}
                      {at.note ? ` · ${at.note}` : ""}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
        {next && !voided && !readOnly ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              className="h-11 text-base"
              placeholder={t("sl.deliveryNote")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              variant="outline"
              className="h-11"
              data-testid="delivery-next"
              onClick={async () => {
                try {
                  await setDeliveryStatus(godown._id, doc._id, next, note);
                  setNote("");
                  lazyToast(t("sl.deliveryUpdated"), "success");
                } catch (e) {
                  lazyToast(t(errorKey(e)), "error");
                }
              }}
            >
              <Truck className="size-5" aria-hidden />
              {t("sl.moveTo", { status: t(`sl.delivery.${next}` as TKey) })}
            </Button>
          </div>
        ) : null}
      </Panel>

      {!voided && !readOnly ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {doc.interGola || doc.consignmentDispatchId ? (
            <p className="text-muted-foreground col-span-2 self-center text-sm">
              {doc.interGola ? t("sl.transferNoEdit") : t("mill.settleReverseBody")}
            </p>
          ) : (
            <Button asChild variant="outline" className="h-12">
              <Link href={`/sales/edit?id=${doc._id}`} data-testid="sale-edit">
                <Pencil className="size-5" aria-hidden />
                {t("sl.edit")}
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" className="h-12">
            <Link href={`/print/sale?id=${doc._id}`} data-testid="sale-print">
              <Printer className="size-5" aria-hidden />
              {t("sl.printInvoice")}
            </Link>
          </Button>
          {doc.interGola ? null : (
            <WhatsAppButton phone={party?.phone} text={waText} className="h-12" />
          )}
          <Button
            variant="outline"
            className="text-destructive h-12"
            onClick={() => setReversing(true)}
            data-testid="sale-reverse"
          >
            <Undo2 className="size-5" aria-hidden />
            {doc.interGola
              ? t("sl.transferReverse")
              : doc.consignmentDispatchId
                ? t("mill.settleReverse")
                : t("sl.reverse")}
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

      {paying ? (
        <AddPaymentSheet
          open={paying}
          onOpenChange={setPaying}
          godownId={godown._id}
          source={doc}
          duePaise={st.duePaise}
          direction="IN"
        />
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("sl.confirmOrder")}
        body={t("sl.confirmOrderBody", { qty, amount: money(BigInt(doc.totalPaise)) })}
        confirmLabel={t("sl.confirmOrder")}
        onConfirm={async () => {
          try {
            await confirmSaleOrder(godown._id, doc._id);
            lazyToast(t("sl.orderConfirmed"), "success");
            setConfirming(false);
          } catch (e) {
            lazyToast(t(errorKey(e)), "error");
          }
        }}
      />
      <ConfirmDialog
        open={reversing}
        onOpenChange={setReversing}
        title={
          doc.interGola
            ? t("sl.transferReverse")
            : doc.consignmentDispatchId
              ? t("mill.settleReverse")
              : t("sl.reverse")
        }
        body={
          doc.interGola
            ? t("sl.transferReverseBody", { qty, amount: money(BigInt(doc.totalPaise)) })
            : doc.consignmentDispatchId
              ? t("mill.settleReverseBody")
              : `${t("sl.reverseConfirm", { qty, amount: money(BigInt(doc.totalPaise)) })}${active.length ? ` ${t("sl.reverseWithPayments", { count: count(active.length) })}` : ""}`
        }
        confirmLabel={
          doc.interGola
            ? t("sl.transferReverse")
            : doc.consignmentDispatchId
              ? t("mill.settleReverse")
              : t("sl.reverse")
        }
        onConfirm={async () => {
          if (!reason.trim()) return lazyToast(t("pay.reasonRequired"), "error");
          try {
            if (doc.interGola) await voidInterGolaTransfer(godown._id, doc._id, reason.trim());
            else if (doc.consignmentDispatchId)
              await voidSettlement(godown._id, doc._id, reason.trim());
            else await voidDoc(godown._id, doc._id, reason.trim(), { withPayments: true });
            lazyToast(t("sl.reversed"), "success");
            setReversing(false);
            router.replace("/sales");
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

export default function SaleViewPage() {
  return (
    <PageSuspense>
      <Detail />
    </PageSuspense>
  );
}

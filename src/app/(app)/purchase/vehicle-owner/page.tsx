"use client";

/**
 * Vehicle owner ledger (DECISIONS D56), inside the Purchase section: jobs, fare earned, paid and
 * outstanding; every delivery (date, farmer, Gola, fare, paid / remaining, status); every payment
 * (date, amount, mode, note; reverse); pay now / later in parts; edit the owner's details; and
 * the same owner's totals in the other Golas (read-only, books stay separate).
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Pencil, Printer, Truck, Undo2, Wallet } from "lucide-react";
import { VehicleOwnerForm } from "@/components/fares/OwnerPicker";
import { PayOwnerSheet } from "@/components/fares/PayOwnerSheet";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { EmptyState, Panel, StatusPill } from "@/components/kit/Kit";
import { Loading } from "@/components/lists/common";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import { useAccessibleGodowns, useActiveGodown } from "@/client/hooks";
import { ownerAcrossGolas } from "@/client/queries/consolidated/vehicleOwners";
import { vehicleOwnerLedger, type OwnerPayment } from "@/client/queries/fares";
import { voidDocs } from "@/client/repo";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

function Metric({
  label,
  value,
  testId,
  paise,
  tone,
}: {
  label: string;
  value: string;
  testId: string;
  paise?: bigint;
  tone?: "red";
}) {
  return (
    <div className={cn("rounded-xl p-3", tone === "red" ? "bg-red-50" : "bg-muted/50")}>
      <span className={cn("text-xs", tone === "red" ? "text-red-900" : "text-muted-foreground")}>
        {label}
      </span>
      <p
        className={cn("tabular text-xl font-semibold", tone === "red" && "text-red-800")}
        data-testid={testId}
        {...(paise !== undefined ? { "data-paise": paise.toString() } : {})}
      >
        {value}
      </p>
    </div>
  );
}

function Owner() {
  const { t, money, date, count } = useI18n();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const golas = useAccessibleGodowns();
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reverse, setReverse] = useState<OwnerPayment | null>(null);
  const [reason, setReason] = useState("");
  const golaIds = (golas ?? []).map((g) => g._id);
  const data = useLiveQuery(
    async () => (id && godown ? vehicleOwnerLedger(godown._id, id) : null),
    [id, godown?._id],
  );
  const across = useLiveQuery(async () => {
    if (!data || golaIds.length < 2) return [];
    return ownerAcrossGolas(
      { name: data.party.name, ...(data.party.phone ? { phone: data.party.phone } : {}) },
      golaIds,
    );
  }, [data?.party.name, data?.party.phone, golaIds.join(","), data?.summary.outstandingPaise]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown) return <ReadOnlyNotice reason="notFound" />;
  const { party, summary, deliveries, payments } = data;
  const golaName = (gid: string) => (golas ?? []).find((g) => g._id === gid)?.name ?? "";
  const otherDue = -summary.balancePaise;
  const showOther = otherDue !== summary.outstandingPaise;

  return (
    <div className="flex flex-col gap-4" data-testid="owner-ledger">
      <PageTitle
        title={party.name}
        subtitle={`${t("fare.ledgerTitle")} · ${godown.name}`}
        back="/purchase?tab=fares"
      />
      <Panel icon={Truck} tone="blue" title={t("fare.summary")}>
        <div className="grid grid-cols-2 gap-3">
          <Metric label={t("fare.jobs")} value={count(summary.jobs)} testId="owner-jobs" />
          <Metric
            label={t("fare.earned")}
            value={money(summary.earnedPaise)}
            paise={summary.earnedPaise}
            testId="owner-earned"
          />
          <Metric
            label={t("fare.paid")}
            value={money(summary.paidPaise)}
            paise={summary.paidPaise}
            testId="owner-paid"
          />
          <Metric
            label={t("fare.outstanding")}
            value={money(summary.outstandingPaise)}
            paise={summary.outstandingPaise}
            testId="owner-outstanding"
            tone="red"
          />
        </div>
        {showOther ? (
          <p className="text-muted-foreground mt-3 text-xs" data-testid="owner-other-balance">
            {otherDue >= 0n
              ? t("fare.otherBalanceOwe", { amount: money(otherDue) })
              : t("fare.otherBalanceAdvance", { amount: money(-otherDue) })}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {party.phone ? (
            <a className="text-primary mr-auto text-sm" href={`tel:${party.phone}`}>
              {party.phone}
            </a>
          ) : (
            <span className="mr-auto" />
          )}
          {readOnly ? null : (
            <>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => setEditing(true)}
                data-testid="owner-edit"
              >
                <Pencil className="size-4" aria-hidden />
                {t("act.edit")}
              </Button>
              {summary.outstandingPaise > 0n ? (
                <Button className="h-11" onClick={() => setPaying(true)} data-testid="owner-pay">
                  <Wallet className="size-4" aria-hidden />
                  {t("fare.payOwner")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </Panel>

      {across && across.length > 1 ? (
        <Panel title={t("fare.allGolas")}>
          <ul className="flex flex-col divide-y text-sm" data-testid="owner-across">
            {across.map((a) => (
              <li key={a.godownId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 font-medium">{golaName(a.godownId)}</span>
                <span className="text-muted-foreground tabular text-xs">
                  {t("fare.ownerLine", {
                    jobs: count(a.summary.jobs),
                    earned: money(a.summary.earnedPaise),
                    paid: money(a.summary.paidPaise),
                  })}
                </span>
                <span className="tabular font-semibold text-red-800">
                  {money(a.summary.outstandingPaise)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title={t("fare.deliveries")}>
        {deliveries.length === 0 ? (
          <EmptyState icon={Truck} title={t("fare.noDeliveries")} />
        ) : (
          <ul className="flex flex-col divide-y" data-testid="owner-deliveries">
            {deliveries.map((x) => {
              const last = x.payments.at(-1);
              return (
                <li key={x.purchase._id} data-testid="owner-delivery">
                  <Link
                    href={`/purchase/view?id=${x.purchase._id}`}
                    className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-3"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-medium">
                        {x.farmer?.name ?? ""}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {[
                          date(x.purchase.transactionDate, "short"),
                          x.purchase.number,
                          t(`fare.kind.${x.purchase.vehicleFare!.vehicleKind}` as TKey),
                          godown.name,
                        ].join(" · ")}
                      </span>
                      {last ? (
                        <span className="text-muted-foreground tabular text-xs">
                          {t("fare.lastPaid", {
                            amount: money(x.state.paidPaise),
                            date: date(last.paymentDate, "short"),
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="tabular font-semibold" data-testid="owner-delivery-fare">
                        {money(x.state.bill.totalPaise)}
                      </span>
                      <StatusPill status={x.state.status} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={t("fare.payments")}>
        {payments.length === 0 ? (
          <p className="text-muted-foreground py-3 text-sm">{t("pay.none")}</p>
        ) : (
          <ul className="flex flex-col divide-y" data-testid="owner-payments">
            {payments.map((p) => {
              const voided = p.status === "void";
              return (
                <li
                  key={p.key}
                  className={cn("flex items-center gap-3 py-3", voided && "opacity-60")}
                  data-testid="owner-payment"
                  data-status={p.status}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cn("tabular text-[15px] font-semibold", voided && "line-through")}
                      data-testid="owner-payment-amount"
                    >
                      {money(p.amountPaise)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {date(p.date, "short")} · {t(`pay.${p.mode}` as TKey)}
                      {p.reference ? ` · ${p.reference}` : ""}
                      {p.parts.length > 1
                        ? ` · ${t("fare.coversFares", { count: count(p.parts.length) })}`
                        : ""}
                    </span>
                    {p.notes ? <span className="text-xs">{p.notes}</span> : null}
                    <span className="flex gap-1.5">
                      {p.isInitial ? (
                        <span className="bg-gold-100 text-accent-foreground rounded-full px-2 text-[11px]">
                          {t("fare.paidWithPurchase")}
                        </span>
                      ) : null}
                      {voided ? (
                        <span className="bg-muted rounded-full px-2 text-[11px]">
                          {t("pay.reversed")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {voided ? null : (
                    <span className="flex shrink-0">
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label={t("pay.receipt")}
                      >
                        <Link href={`/print/payment?id=${p.parts[0]!._id}`}>
                          <Printer className="size-5" aria-hidden />
                        </Link>
                      </Button>
                      {readOnly ? null : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive size-11"
                          aria-label={t("pay.reverse")}
                          onClick={() => setReverse(p)}
                          data-testid="owner-payment-reverse"
                        >
                          <Undo2 className="size-5" aria-hidden />
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {paying ? (
        <PayOwnerSheet
          godownId={godown._id}
          partyId={party._id}
          outstandingPaise={summary.outstandingPaise}
          onClose={() => setPaying(false)}
        />
      ) : null}
      {editing ? (
        <BottomSheet open onOpenChange={(o) => !o && setEditing(false)} title={t("fare.editOwner")}>
          <VehicleOwnerForm
            godownId={godown._id}
            existing={party}
            onDone={() => {
              lazyToast(t("fare.ownerSaved"), "success");
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </BottomSheet>
      ) : null}
      <ConfirmDialog
        open={reverse !== null}
        onOpenChange={(o) => !o && setReverse(null)}
        title={t("pay.reverseTitle")}
        body={
          reverse
            ? t("pay.reverseBodyOut", {
                date: date(reverse.date, "short"),
                mode: t(`pay.${reverse.mode}` as TKey),
                amount: money(reverse.amountPaise),
              })
            : ""
        }
        confirmLabel={t("pay.reverse")}
        onConfirm={async () => {
          if (!reverse) return;
          if (!reason.trim()) return lazyToast(t("pay.reasonRequired"), "error");
          try {
            await voidDocs(
              godown._id,
              reverse.parts.filter((x) => x.status === "active").map((x) => x._id),
              reason.trim(),
            );
            setReverse(null);
            setReason("");
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

export default function VehicleOwnerPage() {
  return (
    <PageSuspense>
      <Owner />
    </PageSuspense>
  );
}

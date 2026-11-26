"use client";

/**
 * Mill dispatch detail (requirement_v2.1 §12.8B): paddy the MILL PAYS for. All fields and bags;
 * the paddy of this dispatch (sent, returned, milled, accepted, short, still at the mill); the
 * money (value, return credits, final-settlement adjustment, received from the mill, remaining
 * receivable) with "+ মিল থেকে টাকা পেলাম" (an IN collection) and, only when the mill paid too
 * much, "টাকা ফেরত দিলাম" (an OUT refund); the final settlement; returns and conversions; edit,
 * WhatsApp (collection reminder), reverse (blocked while returns / conversions / settlement exist),
 * history.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Factory, PackageOpen, Pencil, RotateCcw, Scale, Undo2 } from "lucide-react";
import { AddPaymentSheet, PaymentList } from "@/components/entry/Payments";
import { varietyName } from "@/components/entry/Variety";
import { Panel, QtyTriple, StatusPill, TxnCard } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { Loading } from "@/components/lists/common";
import { Cell, HistoryPanel, ReverseButton } from "@/components/mill/common";
import { RefundSheet } from "@/components/mill/RefundSheet";
import { PageTitle } from "@/components/shell/PageTitle";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { dispatchDetail } from "@/client/queries/mill";
import { voidDoc } from "@/client/repo";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import { displayVehicleNumber } from "@/domain/vehicleNumber";

function Detail() {
  const { t, money, date, digits, count } = useI18n();
  const router = useRouter();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const data = useLiveQuery(() => (id ? dispatchDetail(id) : null), [id]);
  const [paying, setPaying] = useState(false);
  const [refunding, setRefunding] = useState(false);
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, mill, variety, balance, money: mm, state, payments, returns, conversions } = data;
  const { settlement, settlements, legacySales } = data;
  const o = { digits, monKg: business?.monKg };
  const qtl = (g: bigint) => `${formatWeightNumber(g, "QTL", o)} ${t("ui.unitQtlShort")}`;
  const voided = doc.status === "void";
  const active = payments.filter((p) => p.status === "active");
  const linkedCount =
    returns.filter((r) => r.status === "active").length +
    conversions.filter((c) => c.status === "active").length +
    settlements.filter((s) => s.status === "active").length +
    legacySales.filter((s) => s.status === "active").length;
  const bags = doc.weight.mode === "BAGS" ? (doc.weight.bags ?? []) : [];
  const receivable = mm.receivablePaise;
  // The mill owes us: always the collection-reminder template.
  const waText =
    receivable > 0n
      ? t(doc.dueDate ? "wa.collect" : "wa.collectNoDate", {
          name: mill?.name ?? "",
          business: business?.name ?? "",
          gola: godown.name,
          amount: money(receivable),
          dueDate: doc.dueDate ? date(doc.dueDate, "short") : "",
        })
      : "";
  const writable = !voided && !readOnly;
  const open = writable && balance.remainingG > 0n;
  const adj = mm.settlementAdjPaise;

  return (
    <div className="flex flex-col gap-4" data-testid="dispatch-detail">
      <PageTitle
        title={mill?.name ?? ""}
        subtitle={`${t("mill.dispatchTitle", { number: doc.number })} · ${date(doc.dispatchDate)}`}
        back="/mill?tab=dispatch"
        actions={
          voided ? (
            <StatusPill status="VOID" />
          ) : mm.netValuePaise > 0n ? (
            <StatusPill status={state.status} />
          ) : null
        }
      />
      <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        <Factory className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t("mill.millPays")}</span>
      </p>
      <Panel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          <Cell label={t("pur.variety")}>{varietyName(variety, t)}</Cell>
          <Cell label={t("mill.quantity")}>
            <QtyTriple grams={BigInt(doc.weight.netG)} testId="dispatch-detail-qty" />
          </Cell>
          <Cell label={t("mill.rate")}>
            <span className="tabular">{money(BigInt(doc.ratePaisePerQtl))}</span>
          </Cell>
          <Cell label={t("mill.total")} testId="dispatch-detail-total">
            <span className="tabular text-emerald-700">{money(BigInt(doc.totalValuePaise))}</span>
          </Cell>
          {doc.dueDate ? <Cell label={t("mill.dueDate")}>{date(doc.dueDate, "short")}</Cell> : null}
          {doc.vehicleNumber || doc.driverName ? (
            <Cell label={t("mill.vehicle")}>
              {[doc.vehicleNumber && displayVehicleNumber(doc.vehicleNumber), doc.driverName]
                .filter(Boolean)
                .join(" · ")}
            </Cell>
          ) : null}
          {mill?.phone ? (
            <Cell label={t("pur.mobile")}>
              <a className="text-primary" href={`tel:${mill.phone}`}>
                {mill.phone}
              </a>
            </Cell>
          ) : null}
          {doc.notes ? (
            <Cell label={t("mill.notes")} wide>
              {doc.notes}
            </Cell>
          ) : null}
        </dl>
        {bags.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
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
      </Panel>

      <Panel title={t("mill.balanceTitle")}>
        <dl
          className="grid grid-cols-2 gap-3 text-[15px] sm:grid-cols-3"
          data-testid="dispatch-balance"
        >
          <Cell label={t("mill.sent")}>{qtl(balance.sentG)}</Cell>
          <Cell label={t("mill.returned")}>{qtl(balance.returnedPaddyG)}</Cell>
          {balance.consumedG > 0n ? (
            <Cell label={t("mill.consumed")}>{qtl(balance.consumedG)}</Cell>
          ) : null}
          <Cell label={t("mill.accepted")} testId="dispatch-accepted">
            {qtl(balance.acceptedG)}
          </Cell>
          {balance.shortfallG > 0n ? (
            <Cell label={t("mill.shortfall")}>{qtl(balance.shortfallG)}</Cell>
          ) : null}
          <div className="rounded-xl bg-amber-50 p-2">
            <dt className="text-xs text-amber-900">{t("mill.atMill")}</dt>
            <dd
              className="tabular font-semibold text-amber-900"
              data-testid="dispatch-remaining"
              data-g={balance.remainingG.toString()}
            >
              {qtl(balance.remainingG)}
            </dd>
          </div>
        </dl>
        {open ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" className="h-11">
              <Link href={`/mill/return/new?dispatch=${doc._id}`} data-testid="dispatch-add-return">
                <RotateCcw className="size-4" aria-hidden />
                {t("mill.addReturn")}
              </Link>
            </Button>
            {settlement ? null : (
              <>
                <Button asChild variant="outline" className="h-11">
                  <Link href={`/mill/conversion/new?dispatch=${doc._id}`}>
                    <PackageOpen className="size-4" aria-hidden />
                    {t("mill.addConversion")}
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11">
                  <Link href={`/mill/settle?dispatch=${doc._id}`} data-testid="dispatch-settle">
                    <Scale className="size-4" aria-hidden />
                    {t("mill.finalAdd")}
                  </Link>
                </Button>
              </>
            )}
          </div>
        ) : null}
      </Panel>

      <Panel
        title={t("mill.payments")}
        action={
          writable && receivable > 0n ? (
            <Button className="h-11" onClick={() => setPaying(true)} data-testid="add-due-payment">
              {t("mill.addCollection")}
            </Button>
          ) : null
        }
      >
        <dl className="mb-2 grid grid-cols-2 gap-3 text-sm" data-testid="dispatch-money">
          <Cell label={t("mill.value")}>
            <span className="tabular">{money(mm.valuePaise)}</span>
          </Cell>
          {mm.returnCreditPaise > 0n ? (
            <Cell label={t("mill.returnCredit")}>
              <span className="tabular">− {money(mm.returnCreditPaise)}</span>
            </Cell>
          ) : null}
          {adj !== 0n ? (
            <Cell label={t(adj > 0n ? "mill.settleAdj" : "mill.settleExtra")}>
              <span className="tabular">
                {adj > 0n ? "− " : "+ "}
                {money(adj > 0n ? adj : -adj)}
              </span>
            </Cell>
          ) : null}
        </dl>
        <div className="mb-2 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-emerald-50 p-3">
            <span className="text-xs text-emerald-900">{t("mill.collected")}</span>
            <p
              className="tabular text-xl font-semibold text-emerald-800"
              data-testid="detail-paid"
              data-paise={mm.collectedPaise.toString()}
            >
              {money(mm.collectedPaise)}
            </p>
          </div>
          {receivable >= 0n ? (
            <div className="rounded-xl bg-emerald-50 p-3">
              <span className="text-xs text-emerald-900">{t("mill.remaining")}</span>
              <p
                className="tabular text-xl font-semibold text-emerald-800"
                data-testid="detail-due"
                data-paise={receivable.toString()}
              >
                {money(receivable)}
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-amber-50 p-3">
              <span className="text-xs text-amber-900">{t("mill.refundDue")}</span>
              <p
                className="tabular text-xl font-semibold text-amber-900"
                data-testid="detail-due"
                data-paise={receivable.toString()}
              >
                {money(-receivable)}
              </p>
            </div>
          )}
        </div>
        {writable && receivable < 0n ? (
          <Button
            variant="outline"
            className="mb-2 h-11"
            onClick={() => setRefunding(true)}
            data-testid="mill-refund-open"
          >
            <Undo2 className="size-4" aria-hidden />
            {t("mill.refund")}
          </Button>
        ) : null}
        <PaymentList payments={payments} godownId={godown._id} />
      </Panel>

      {settlements.length ? (
        <Panel title={t("mill.finalTab")} icon={Scale}>
          <ul className="flex flex-col gap-2.5" data-testid="dispatch-settlements">
            {settlements.map((s) => {
              const a = BigInt(s.adjustmentPaise);
              return (
                <li key={s._id} className="flex flex-col gap-2">
                  <TxnCard
                    index={0}
                    icon={Scale}
                    title={`${t("mill.accepted")} ${qtl(BigInt(s.acceptedG))} × ${money(BigInt(s.finalRatePaisePerQtl))}`}
                    subtitle={
                      a > 0n
                        ? t("mill.finalCut", { amount: money(a) })
                        : a < 0n
                          ? t("mill.finalExtra", { amount: money(-a) })
                          : t("mill.finalSame")
                    }
                    date={`${date(s.transactionDate, "short")} · ${s.number}`}
                    amountPaise={BigInt(s.finalValuePaise)}
                    direction="IN"
                    {...(s.status === "void" ? { status: "VOID" as const } : {})}
                  />
                  {s.status === "active" && writable ? (
                    <ReverseButton
                      label={t("mill.finalReverse")}
                      testId="settlement-reverse"
                      body={t("mill.finalReverseBody")}
                      onReverse={async (reason) => {
                        await voidDoc(godown._id, s._id, reason);
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      {returns.length ? (
        <Panel title={t("mill.returnsTitle")}>
          <ul className="flex flex-col gap-2.5">
            {returns.map((r, i) => (
              <li key={r._id}>
                <TxnCard
                  index={i}
                  icon={RotateCcw}
                  title={
                    r.product === "OTHER" ? (r.otherProductName ?? "") : t(`mill.${r.product}`)
                  }
                  subtitle={qtl(BigInt(r.weight.netG))}
                  date={`${date(r.returnDate, "short")} · ${r.number}`}
                  {...(r.product === "PADDY" && r.totalValuePaise
                    ? { amountPaise: BigInt(r.totalValuePaise), direction: "OUT" as const }
                    : {})}
                  {...(r.status === "void" ? { status: "VOID" as const } : {})}
                  href={`/mill/return/view?id=${r._id}`}
                />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {conversions.length ? (
        <Panel title={t("mill.conversionsTitle")}>
          <ul className="flex flex-col gap-2.5">
            {conversions.map((c, i) => (
              <li key={c._id}>
                <TxnCard
                  index={i}
                  icon={PackageOpen}
                  tone="gold"
                  title={`${t("mill.consumed")} ${qtl(BigInt(c.paddyConsumedG))}`}
                  subtitle={`${t("mill.loss")} ${qtl(BigInt(c.lossG))}`}
                  date={`${date(c.conversionDate, "short")} · ${c.number}`}
                  {...(c.status === "void" ? { status: "VOID" as const } : {})}
                  href={`/mill/conversion/view?id=${c._id}`}
                />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {legacySales.length ? (
        <Panel title={t("mill.legacySalesTitle")}>
          <ul className="flex flex-col gap-2.5">
            {legacySales.map((s, i) => (
              <li key={s._id}>
                <TxnCard
                  index={i}
                  icon={Scale}
                  title={qtl(BigInt(s.weight.netG))}
                  date={`${date(s.transactionDate, "short")} · ${s.number}`}
                  amountPaise={BigInt(s.totalPaise)}
                  direction="IN"
                  {...(s.status === "void" ? { status: "VOID" as const } : {})}
                  href={`/sales/view?id=${s._id}`}
                />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {writable ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Button asChild variant="outline" className="h-12">
            <Link href={`/mill/dispatch/edit?id=${doc._id}`} data-testid="dispatch-edit">
              <Pencil className="size-5" aria-hidden />
              {t("mill.edit")}
            </Link>
          </Button>
          <WhatsAppButton phone={mill?.phone} text={waText} className="h-12" />
          {linkedCount > 0 ? (
            <p className="text-muted-foreground col-span-2 self-center text-sm sm:col-span-1">
              {t("mill.reverseBlocked")}
            </p>
          ) : (
            <ReverseButton
              label={t("mill.reverse")}
              testId="dispatch-reverse"
              body={`${t("mill.reverseConfirm", { qty: formatWeightNumber(BigInt(doc.weight.netG), "QTL", o) })}${active.length ? ` ${t("mill.reverseWithPayments", { count: count(active.length) })}` : ""}`}
              onReverse={async (reason) => {
                await voidDoc(godown._id, doc._id, reason, { withPayments: true });
                router.replace("/mill?tab=dispatch");
              }}
            />
          )}
        </div>
      ) : null}

      <HistoryPanel doc={doc} />

      {paying ? (
        <AddPaymentSheet
          open={paying}
          onOpenChange={setPaying}
          godownId={godown._id}
          source={doc}
          duePaise={receivable}
          direction="IN"
        />
      ) : null}
      {refunding ? (
        <RefundSheet
          open={refunding}
          onOpenChange={setRefunding}
          godownId={godown._id}
          millPartyId={doc.millPartyId}
          dispatchId={doc._id}
          overpaidPaise={-receivable}
        />
      ) : null}
    </div>
  );
}

export default function DispatchViewPage() {
  return (
    <PageSuspense>
      <Detail />
    </PageSuspense>
  );
}

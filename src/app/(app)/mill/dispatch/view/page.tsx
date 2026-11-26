"use client";

/**
 * Mill dispatch detail (requirement_v2 §12.8B): all fields and bags, the dispatch-wise paddy
 * balance (sent, returned, milled, sold, still at the mill), the money (MILLING: paid / due to the
 * mill with "+ মিলকে টাকা দিন"; CONSIGNMENT: advances received), its returns, conversions and
 * settlement sales with buttons to add them, edit, WhatsApp, reverse (blocked while returns /
 * conversions / settlements exist), history.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Factory, PackageOpen, Pencil, RotateCcw, Scale } from "lucide-react";
import { AddPaymentSheet, PaymentList } from "@/components/entry/Payments";
import { varietyName } from "@/components/entry/Variety";
import { Panel, QtyTriple, StatusPill, TxnCard } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { Loading } from "@/components/lists/common";
import { Cell, HistoryPanel, ReverseButton } from "@/components/mill/common";
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
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, mill, variety, balance, state, payments, returns, conversions, settlements } = data;
  const o = { digits, monKg: business?.monKg };
  const qtl = (g: bigint) => `${formatWeightNumber(g, "QTL", o)} ${t("ui.unitQtlShort")}`;
  const voided = doc.status === "void";
  const milling = doc.dispatchType === "MILLING";
  const active = payments.filter((p) => p.status === "active");
  const linkedCount =
    returns.filter((r) => r.status === "active").length +
    conversions.filter((c) => c.status === "active").length +
    settlements.filter((s) => s.status === "active").length;
  const bags = doc.weight.mode === "BAGS" ? (doc.weight.bags ?? []) : [];
  const waText =
    milling && state.duePaise > 0n
      ? t(doc.dueDate ? "wa.pay" : "wa.payNoDate", {
          name: mill?.name ?? "",
          business: business?.name ?? "",
          gola: godown.name,
          amount: money(state.duePaise),
          dueDate: doc.dueDate ? date(doc.dueDate, "short") : "",
        })
      : "";
  const open = !voided && !readOnly && balance.remainingG > 0n;

  return (
    <div className="flex flex-col gap-4" data-testid="dispatch-detail">
      <PageTitle
        title={mill?.name ?? ""}
        subtitle={`${t("mill.dispatchTitle", { number: doc.number })} · ${date(doc.dispatchDate)}`}
        back="/mill?tab=dispatch"
        actions={
          voided ? (
            <StatusPill status="VOID" />
          ) : milling && BigInt(doc.totalValuePaise) > 0n ? (
            <StatusPill status={state.status} />
          ) : null
        }
      />
      <p className="bg-gold-100 text-accent-foreground flex items-start gap-2 rounded-xl px-3 py-2 text-sm">
        <Factory className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold">{t(`mill.${doc.dispatchType}`)}</span>
          <span className="block">{t(`mill.hint${doc.dispatchType}`)}</span>
        </span>
      </p>
      <Panel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          <Cell label={t("pur.variety")}>{varietyName(variety, t)}</Cell>
          <Cell label={t("mill.quantity")}>
            <QtyTriple grams={BigInt(doc.weight.netG)} testId="dispatch-detail-qty" />
          </Cell>
          <Cell label={t(`mill.rate${doc.dispatchType}`)}>
            <span className="tabular">{money(BigInt(doc.ratePaisePerQtl))}</span>
          </Cell>
          <Cell label={t(`mill.total${doc.dispatchType}`)} testId="dispatch-detail-total">
            <span className="tabular">{money(BigInt(doc.totalValuePaise))}</span>
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
          className="grid grid-cols-2 gap-3 text-[15px] sm:grid-cols-5"
          data-testid="dispatch-balance"
        >
          <Cell label={t("mill.sent")}>{qtl(balance.sentG)}</Cell>
          <Cell label={t("mill.returned")}>{qtl(balance.returnedPaddyG)}</Cell>
          <Cell label={t("mill.consumed")}>{qtl(balance.consumedG)}</Cell>
          <Cell label={t("mill.settled")}>{qtl(balance.settledG)}</Cell>
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
            {milling ? (
              <Button asChild variant="outline" className="h-11">
                <Link href={`/mill/conversion/new?dispatch=${doc._id}`}>
                  <PackageOpen className="size-4" aria-hidden />
                  {t("mill.addConversion")}
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline" className="h-11">
                <Link href={`/mill/settle?dispatch=${doc._id}`} data-testid="dispatch-settle">
                  <Scale className="size-4" aria-hidden />
                  {t("mill.settle")}
                </Link>
              </Button>
            )}
          </div>
        ) : null}
      </Panel>

      <Panel
        title={t("mill.payments")}
        action={
          !voided && !readOnly && (!milling || state.duePaise > 0n) ? (
            <Button className="h-11" onClick={() => setPaying(true)} data-testid="add-due-payment">
              {t(`mill.addPay${doc.dispatchType}`)}
            </Button>
          ) : null
        }
      >
        <div className="mb-2 grid grid-cols-2 gap-3">
          <div className="bg-forest-100/60 rounded-xl p-3">
            <span className="text-muted-foreground text-xs">
              {t(`mill.paid${doc.dispatchType}`)}
            </span>
            <p className="tabular text-xl font-semibold" data-testid="detail-paid">
              {money(state.paidPaise)}
            </p>
          </div>
          {milling ? (
            <div className="rounded-xl bg-red-50 p-3">
              <span className="text-xs text-red-900">{t("mill.remainingMILLING")}</span>
              <p
                className="tabular text-xl font-semibold text-red-800"
                data-testid="detail-due"
                data-paise={state.duePaise.toString()}
              >
                {money(state.duePaise > 0n ? state.duePaise : 0n)}
              </p>
            </div>
          ) : null}
        </div>
        <PaymentList payments={payments} godownId={godown._id} />
      </Panel>

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
      {settlements.length ? (
        <Panel title={t("mill.settlementsTitle")}>
          <ul className="flex flex-col gap-2.5">
            {settlements.map((s, i) => (
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

      {!voided && !readOnly ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Button asChild variant="outline" className="h-12">
            <Link href={`/mill/dispatch/edit?id=${doc._id}`} data-testid="dispatch-edit">
              <Pencil className="size-5" aria-hidden />
              {t("mill.edit")}
            </Link>
          </Button>
          {milling ? <WhatsAppButton phone={mill?.phone} text={waText} className="h-12" /> : null}
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
          duePaise={state.duePaise}
          direction={milling ? "OUT" : "IN"}
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

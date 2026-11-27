"use client";

/**
 * Mill return detail (requirement_v2.1 §12.8C): what came back from which dispatch, bags, the
 * credit to the mill (paddy: "মিলের পাওনা ₹X কমবে"; rice / other: stock only), edit, reverse
 * (blocked while a conversion uses it), history. A return never carries money; money recorded
 * with a return before v2.1 is listed read-only until the data fix moves it to the dispatch.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { PaymentList } from "@/components/entry/Payments";
import { varietyName } from "@/components/entry/Variety";
import { Panel, QtyTriple, StatusPill } from "@/components/kit/Kit";
import { Loading } from "@/components/lists/common";
import { Cell, HistoryPanel, ReverseButton } from "@/components/mill/common";
import { PageTitle } from "@/components/shell/PageTitle";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { paymentsOf } from "@/client/queries/purchases";
import { voidDoc } from "@/client/repo";
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
    if (!doc || doc.type !== "MILL_RETURN") return null;
    const [mill, variety, dispatch, payments, linked] = await Promise.all([
      db().parties.get(doc.millPartyId),
      doc.varietyId ? db().varieties.get(doc.varietyId) : undefined,
      db().vouchers.get(doc.dispatchId),
      paymentsOf(doc._id),
      db().vouchers.where("dispatchId").equals(doc.dispatchId).toArray(),
    ]);
    const usedBy = linked.find(
      (x) =>
        x.type === "CONVERSION" &&
        x.status === "active" &&
        x.outputs.some((o) => o.returnId === doc._id),
    );
    return { doc, mill, variety, dispatch, payments, usedBy };
  }, [id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, mill, variety, dispatch, payments, usedBy } = data;
  const o = { digits, monKg: business?.monKg };
  const voided = doc.status === "void";
  const active = payments.filter((p) => p.status === "active");
  const credit = doc.product === "PADDY" ? BigInt(doc.totalValuePaise ?? "0") : 0n;
  const bags = doc.weight.mode === "BAGS" ? (doc.weight.bags ?? []) : [];
  const product = doc.product === "OTHER" ? (doc.otherProductName ?? "") : t(`mill.${doc.product}`);

  return (
    <div className="flex flex-col gap-4" data-testid="return-detail">
      <PageTitle
        title={mill?.name ?? ""}
        subtitle={`${t("mill.returnTitle", { number: doc.number })} · ${date(doc.returnDate)}`}
        back="/mill?tab=return"
        actions={voided ? <StatusPill status="VOID" /> : null}
        edit={
          !voided && !readOnly
            ? {
                href: `/mill/return/edit?id=${doc._id}`,
                label: t("act.edit"),
                testId: "return-edit",
              }
            : null
        }
      />
      <Panel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          <Cell label={t("mill.product")} testId="return-detail-product">
            {product}
          </Cell>
          {variety ? <Cell label={t("pur.variety")}>{varietyName(variety, t)}</Cell> : null}
          <Cell label={t("mill.quantity")}>
            <QtyTriple grams={BigInt(doc.weight.netG)} testId="return-detail-qty" />
          </Cell>
          {dispatch ? (
            <Cell label={t("mill.dispatch")}>
              <Link className="text-primary" href={`/mill/dispatch/view?id=${dispatch._id}`}>
                {dispatch.number}
              </Link>
            </Cell>
          ) : null}
          {doc.product === "PADDY" ? (
            <Cell label={t("mill.creditValue")} testId="return-detail-credit">
              <span className="tabular">{money(credit)}</span>
              <span className="block text-xs font-normal text-emerald-800">
                {t("mill.creditEffect", { amount: money(credit) })}
              </span>
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
        {doc.product !== "PADDY" ? (
          <p className="text-muted-foreground mt-3 text-xs">{t("mill.riceNoMoney")}</p>
        ) : null}
        {usedBy ? (
          <p className="mt-2 text-sm">
            <Link className="text-primary" href={`/mill/conversion/view?id=${usedBy._id}`}>
              {t("mill.convertedBadge")} · {usedBy.number}
            </Link>
          </p>
        ) : null}
      </Panel>

      {payments.length ? (
        <Panel title={t("mill.legacyReceived")}>
          <PaymentList payments={payments} godownId={godown._id} />
        </Panel>
      ) : null}

      {!voided && !readOnly ? (
        <div className="grid grid-cols-2 gap-3">
          {usedBy ? (
            <p className="text-muted-foreground self-center text-sm">{t("mill.reverseBlocked")}</p>
          ) : (
            <ReverseButton
              label={t("mill.returnReverse")}
              testId="return-reverse"
              body={`${t("mill.returnReverseConfirm", { qty: formatWeightNumber(BigInt(doc.weight.netG), "QTL", o) })}${active.length ? ` ${t("mill.reverseWithPayments", { count: count(active.length) })}` : ""}`}
              onReverse={async (reason) => {
                await voidDoc(godown._id, doc._id, reason, { withPayments: true });
                router.replace("/mill?tab=return");
              }}
            />
          )}
        </div>
      ) : null}

      <HistoryPanel doc={doc} />
    </div>
  );
}

export default function ReturnViewPage() {
  return (
    <PageSuspense>
      <Detail />
    </PageSuspense>
  );
}

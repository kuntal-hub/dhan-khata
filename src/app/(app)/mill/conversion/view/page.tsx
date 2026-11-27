"use client";

/**
 * Milling conversion detail (requirement_v2 §12.8D): dispatch, paddy milled, the outputs (linked
 * returns), `consumed − outputs = loss`, the yield % (information only), edit, reverse, history.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { varietyName } from "@/components/entry/Variety";
import { Panel, StatusPill } from "@/components/kit/Kit";
import { Loading } from "@/components/lists/common";
import { Cell, HistoryPanel, ReverseButton } from "@/components/mill/common";
import { PageTitle } from "@/components/shell/PageTitle";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { conversionBps } from "@/client/queries/mill";
import { voidDoc } from "@/client/repo";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";

function Detail() {
  const { t, date, digits, count } = useI18n();
  const router = useRouter();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const doc = await db().vouchers.get(id);
    if (!doc || doc.type !== "CONVERSION") return null;
    const [mill, variety, dispatch] = await Promise.all([
      db().parties.get(doc.millPartyId),
      db().varieties.get(doc.varietyId),
      db().vouchers.get(doc.dispatchId),
    ]);
    return { doc, mill, variety, dispatch };
  }, [id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, mill, variety, dispatch } = data;
  const o = { digits, monKg: business?.monKg };
  const qtl = (g: bigint) => formatWeightNumber(g, "QTL", o);
  const consumed = BigInt(doc.paddyConsumedG);
  const outputs = doc.outputs.reduce((s, x) => s + BigInt(x.qtyG), 0n);
  const loss = BigInt(doc.lossG);
  const voided = doc.status === "void";

  return (
    <div className="flex flex-col gap-4" data-testid="conversion-detail">
      <PageTitle
        title={mill?.name ?? ""}
        subtitle={`${t("mill.convTitle", { number: doc.number })} · ${date(doc.conversionDate)}`}
        back="/mill?tab=conversion"
        actions={voided ? <StatusPill status="VOID" /> : null}
        edit={
          !voided && !readOnly
            ? {
                href: `/mill/conversion/edit?id=${doc._id}`,
                label: t("act.edit"),
                testId: "conversion-edit",
              }
            : null
        }
      />
      <Panel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          <Cell label={t("pur.variety")}>{varietyName(variety, t)}</Cell>
          {dispatch ? (
            <Cell label={t("mill.convDispatch")}>
              <Link className="text-primary" href={`/mill/dispatch/view?id=${dispatch._id}`}>
                {dispatch.number}
              </Link>
            </Cell>
          ) : null}
          <Cell label={t("mill.paddyConsumed")}>
            <span className="tabular">
              {qtl(consumed)} {t("ui.unitQtlShort")}
            </span>
          </Cell>
          <Cell label={t("mill.loss")} testId="conversion-detail-loss">
            <span className="tabular">
              {qtl(loss)} {t("ui.unitQtlShort")}
            </span>
          </Cell>
          {doc.notes ? (
            <Cell label={t("mill.notes")} wide>
              {doc.notes}
            </Cell>
          ) : null}
        </dl>
        <p className="tabular mt-3 text-[15px] font-medium">
          {t("mill.formula", { consumed: qtl(consumed), outputs: qtl(outputs), loss: qtl(loss) })}
        </p>
        <p className="text-muted-foreground text-xs">
          {t("mill.convPct", {
            pct: count(Number(conversionBps(consumed, outputs) / 100n)), // float-ok: whole percent for display
          })}
        </p>
      </Panel>
      <Panel title={t("mill.outputs")}>
        {doc.outputs.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("mill.none")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {doc.outputs.map((x) => (
              <li key={x.returnId} className="flex items-center justify-between py-2 text-[15px]">
                <Link className="text-primary" href={`/mill/return/view?id=${x.returnId}`}>
                  {x.product === "OTHER" ? x.name : t("mill.RICE")}
                </Link>
                <span className="tabular">
                  {qtl(BigInt(x.qtyG))} {t("ui.unitQtlShort")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {!voided && !readOnly ? (
        <div className="grid grid-cols-2 gap-3">
          <ReverseButton
            label={t("mill.convReverse")}
            testId="conversion-reverse"
            body={t("mill.convReverseConfirm", { qty: qtl(consumed) })}
            onReverse={async (reason) => {
              await voidDoc(godown._id, doc._id, reason);
              router.replace("/mill?tab=conversion");
            }}
          />
        </div>
      ) : null}
      <HistoryPanel doc={doc} />
    </div>
  );
}

export default function ConversionViewPage() {
  return (
    <PageSuspense>
      <Detail />
    </PageSuspense>
  );
}

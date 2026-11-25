"use client";

/**
 * Farmer account (requirement_v2 §12.2 "কৃষকের হিসাব"): balance (we owe / advance), purchases with
 * paid / due, the ledger statement with running balance, give advance, WhatsApp.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Wheat } from "lucide-react";
import { varietyName } from "@/components/entry/Variety";
import { emptyPay, PaymentFields, toPart, type PayState } from "@/components/entry/Payments";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { EmptyState, Panel, TxnCard } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { Loading } from "@/components/lists/common";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { partyLedger, purchaseRows } from "@/client/queries/purchases";
import { payAdvance } from "@/client/repo";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

function Farmer() {
  const { t, money, date, digits } = useI18n();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const [advance, setAdvance] = useState(false);
  const data = useLiveQuery(async () => {
    if (!id || !godown) return null;
    const party = await db().parties.get(id);
    if (!party || party.godownId !== godown._id) return null;
    const [rows, ledger] = await Promise.all([
      purchaseRows(godown._id),
      partyLedger(godown._id, id),
    ]);
    return { party, rows: rows.filter((r) => r.doc.partyId === id), ledger };
  }, [id, godown?._id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown) return <ReadOnlyNotice reason="notFound" />;
  const { party, rows, ledger } = data;
  const bal = ledger.closing;
  const o = { digits, monKg: business?.monKg };
  const waText =
    bal < 0n
      ? t("wa.payNoDate", {
          name: party.name,
          business: business?.name ?? "",
          gola: godown.name,
          amount: money(-bal),
          dueDate: "",
        })
      : "";
  return (
    <div className="flex flex-col gap-4" data-testid="farmer-detail">
      <PageTitle title={party.name} subtitle={t("farmerV.title")} back="/purchase?tab=farmers" />
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-muted-foreground text-sm">
              {bal < 0n
                ? t("farmerV.weOwe")
                : bal > 0n
                  ? t("farmerV.advanceGiven")
                  : t("farmerV.settled")}
            </span>
            <p
              className={`tabular text-3xl font-semibold ${bal < 0n ? "text-red-800" : "text-forest"}`}
              data-testid="farmer-balance"
              data-paise={bal.toString()}
            >
              {money(bal < 0n ? -bal : bal)}
            </p>
            {party.phone ? (
              <a className="text-primary text-sm" href={`tel:${party.phone}`}>
                {party.phone}
              </a>
            ) : null}
          </div>
          <div className="flex gap-2">
            {readOnly ? null : (
              <Button
                variant="outline"
                className="h-12"
                onClick={() => setAdvance(true)}
                data-testid="farmer-advance"
              >
                {t("farmerV.giveAdvance")}
              </Button>
            )}
            <WhatsAppButton phone={party.phone} text={waText} className="h-12" />
          </div>
        </div>
      </Panel>
      <Panel title={t("farmerV.purchases")}>
        {rows.length === 0 ? (
          <EmptyState icon={Wheat} title={t("pur.empty")} />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rows.map((r, i) => (
              <li key={r.doc._id}>
                <TxnCard
                  index={i}
                  icon={Wheat}
                  tone="gold"
                  title={`${varietyName(r.variety, t)} · ${formatWeightNumber(BigInt(r.doc.weight.netG), "QTL", o)} ${t("ui.unitQtlShort")}`}
                  date={`${date(r.doc.transactionDate, "short")} · ${r.doc.number}`}
                  amountPaise={BigInt(r.doc.totalPaise)}
                  status={r.doc.status === "void" ? "VOID" : r.state.status}
                  href={`/purchase/view?id=${r.doc._id}`}
                  extra={
                    r.doc.status === "active" && r.state.duePaise > 0n ? (
                      <span className="tabular text-xs text-red-700">
                        {t("pay.due", { amount: money(r.state.duePaise) })}
                      </span>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={t("farmerV.ledger")}>
        <table className="w-full text-sm" data-testid="farmer-ledger">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th className="py-2 text-left font-normal">{t("pay.date")}</th>
              <th className="py-2 text-right font-normal">{t("farmerV.debit")}</th>
              <th className="py-2 text-right font-normal">{t("farmerV.credit")}</th>
              <th className="py-2 text-right font-normal">{t("farmerV.closing")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ledger.rows.map((r) => (
              <tr key={r.doc._id}>
                <td className="py-2">
                  {date(r.date, "short")}
                  <span className="text-muted-foreground block text-xs">
                    {t(`voucherType.${r.doc.type}` as TKey)}
                  </span>
                </td>
                <td className="tabular py-2 text-right">
                  {r.debitPaise ? money(r.debitPaise) : ""}
                </td>
                <td className="tabular py-2 text-right">
                  {r.creditPaise ? money(r.creditPaise) : ""}
                </td>
                <td className="tabular py-2 text-right font-medium">
                  {money(r.balancePaise < 0n ? -r.balancePaise : r.balancePaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {advance ? (
        <AdvanceSheet godownId={godown._id} partyId={party._id} onClose={() => setAdvance(false)} />
      ) : null}
    </div>
  );
}

function AdvanceSheet({
  godownId,
  partyId,
  onClose,
}: {
  godownId: string;
  partyId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [s, setS] = useState<PayState>(emptyPay());
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const r = toPart(s, false);
    if (r.error || !r.part) return setError(t(r.error ?? "errors.validation.required"));
    try {
      await payAdvance(godownId, partyId, "OUT", r.part);
      lazyToast(t("pay.saved"), "success");
      onClose();
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("farmerV.giveAdvance")}
      testId="advance-sheet"
    >
      <PaymentFields
        godownId={godownId}
        value={s}
        onChange={setS}
        amountLabel={t("pay.amount")}
        testId="advance-pay"
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button className="h-12 text-base" onClick={() => void save()} data-testid="advance-save">
        {t("pay.save")}
      </Button>
    </BottomSheet>
  );
}

export default function FarmerPage() {
  return (
    <PageSuspense>
      <Farmer />
    </PageSuspense>
  );
}

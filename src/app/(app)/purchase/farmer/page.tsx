"use client";

/**
 * Farmer account (requirement_v2 §12.2 "কৃষকের হিসাব"): balance (we owe / advance), purchases with
 * paid / due, the ledger statement with running balance, give advance, WhatsApp.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Wheat } from "lucide-react";
import { varietyName } from "@/components/entry/Variety";
import { AdvanceSheet, LedgerTable } from "@/components/entry/PartyAccount";
import { EmptyState, Panel, TxnCard } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { Loading } from "@/components/lists/common";
import { PageTitle } from "@/components/shell/PageTitle";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { partyLedger, purchaseRows } from "@/client/queries/purchases";
import { formatWeightNumber } from "@/domain/units";
import { displayStatus } from "@/domain/v2/payments";
import { useI18n } from "@/i18n/I18nProvider";

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
                  status={r.doc.status === "void" ? "VOID" : displayStatus(r.state)}
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
        <LedgerTable
          rows={ledger.rows}
          debitLabel={t("farmerV.debit")}
          creditLabel={t("farmerV.credit")}
          testId="farmer-ledger"
        />
      </Panel>
      {advance ? (
        <AdvanceSheet
          godownId={godown._id}
          partyId={party._id}
          direction="OUT"
          title={t("farmerV.giveAdvance")}
          onClose={() => setAdvance(false)}
        />
      ) : null}
    </div>
  );
}
export default function FarmerPage() {
  return (
    <PageSuspense>
      <Farmer />
    </PageSuspense>
  );
}

"use client";

/**
 * Customer account (requirement_v2 §12.3 "ক্রেতার হিসাব"): balance (they owe / advance received),
 * sales with received / due, the ledger statement with running balance, take advance, WhatsApp.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { HandCoins } from "lucide-react";
import { AdvanceSheet, LedgerTable } from "@/components/entry/PartyAccount";
import { varietyName } from "@/components/entry/Variety";
import { EmptyState, Panel, TxnCard } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { Loading } from "@/components/lists/common";
import { PageTitle } from "@/components/shell/PageTitle";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { partyLedger } from "@/client/queries/purchases";
import { saleRows } from "@/client/queries/sales";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

function Customer() {
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
      saleRows(godown._id, { partyId: id }),
      partyLedger(godown._id, id),
    ]);
    return { party, rows, ledger };
  }, [id, godown?._id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown) return <ReadOnlyNotice reason="notFound" />;
  const { party, rows, ledger } = data;
  const bal = ledger.closing;
  const o = { digits, monKg: business?.monKg };
  const waText =
    bal > 0n
      ? t("wa.collectNoDate", {
          name: party.name,
          business: business?.name ?? "",
          gola: godown.name,
          amount: money(bal),
        })
      : "";
  return (
    <div className="flex flex-col gap-4" data-testid="customer-detail">
      <PageTitle title={party.name} subtitle={t("sl.customerTitle")} back="/sales?tab=customers" />
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-muted-foreground text-sm">
              {bal > 0n ? t("sl.theyOwe") : bal < 0n ? t("sl.advanceRecv") : t("sl.settled")}
            </span>
            <p
              className={`tabular text-3xl font-semibold ${bal > 0n ? "text-emerald-800" : "text-forest"}`}
              data-testid="customer-balance"
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
                data-testid="customer-advance"
              >
                {t("sl.takeAdvance")}
              </Button>
            )}
            <WhatsAppButton phone={party.phone} text={waText} className="h-12" />
          </div>
        </div>
      </Panel>
      <Panel title={t("sl.sales")}>
        {rows.length === 0 ? (
          <EmptyState icon={HandCoins} title={t("sl.empty")} />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rows.map((r, i) => (
              <li key={r.doc._id}>
                <TxnCard
                  index={i}
                  icon={HandCoins}
                  tone="green"
                  title={`${t(`sl.${r.doc.product}` as TKey)} · ${varietyName(r.variety, t)} · ${formatWeightNumber(BigInt(r.doc.weight.netG), "QTL", o)} ${t("ui.unitQtlShort")}`}
                  date={`${date(r.doc.transactionDate, "short")} · ${r.doc.number}`}
                  amountPaise={BigInt(r.doc.totalPaise)}
                  direction="IN"
                  status={
                    r.doc.status === "void"
                      ? "VOID"
                      : r.doc.saleStatus === "ORDER"
                        ? "ORDER"
                        : r.state.status
                  }
                  href={`/sales/view?id=${r.doc._id}`}
                  extra={
                    r.doc.status === "active" && r.state.duePaise > 0n ? (
                      <span className="tabular text-xs text-emerald-800">
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
      <Panel title={t("sl.ledger")}>
        <LedgerTable
          rows={ledger.rows}
          debitLabel={t("sl.debit")}
          creditLabel={t("sl.credit")}
          testId="customer-ledger"
        />
      </Panel>
      {advance ? (
        <AdvanceSheet
          godownId={godown._id}
          partyId={party._id}
          direction="IN"
          title={t("sl.takeAdvance")}
          onClose={() => setAdvance(false)}
        />
      ) : null}
    </div>
  );
}

export default function CustomerPage() {
  return (
    <PageSuspense>
      <Customer />
    </PageSuspense>
  );
}

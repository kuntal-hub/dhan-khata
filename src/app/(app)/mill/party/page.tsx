"use client";

/**
 * Second-party account (requirement_v2 §12.8A): balance (we owe / they owe), entries with paid /
 * remaining, money given / received on account, the ledger with running balance, WhatsApp,
 * "+ নতুন এন্ট্রি".
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Printer, Scale } from "lucide-react";
import { printHrefOf } from "@/components/reports/ReportView";
import { todayIST } from "@/domain/dates";
import { displayStatus } from "@/domain/v2/payments";
import { AdvanceSheet, LedgerTable } from "@/components/entry/PartyAccount";
import { PaymentList } from "@/components/entry/Payments";
import { EmptyState, Panel, TxnCard } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { Loading } from "@/components/lists/common";
import { PageTitle } from "@/components/shell/PageTitle";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { secondPartyEntries, secondPartyOnAccount } from "@/client/queries/mill";
import { partyLedger } from "@/client/queries/purchases";
import { useI18n } from "@/i18n/I18nProvider";

function Account() {
  const { t, money, date } = useI18n();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const [money2, setMoney2] = useState<"IN" | "OUT" | null>(null);
  const data = useLiveQuery(async () => {
    if (!id || !godown) return null;
    const party = await db().parties.get(id);
    if (!party || party.godownId !== godown._id) return null;
    const [entries, onAccount, ledger] = await Promise.all([
      secondPartyEntries(godown._id, id),
      secondPartyOnAccount(godown._id, id),
      partyLedger(godown._id, id),
    ]);
    return { party, entries, onAccount, ledger };
  }, [id, godown?._id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown) return <ReadOnlyNotice reason="notFound" />;
  const { party, entries, onAccount, ledger } = data;
  const bal = ledger.closing;
  const waText =
    bal > 0n
      ? t("wa.collectNoDate", {
          name: party.name,
          business: business?.name ?? "",
          gola: godown.name,
          amount: money(bal),
        })
      : bal < 0n
        ? t("wa.payNoDate", {
            name: party.name,
            business: business?.name ?? "",
            gola: godown.name,
            amount: money(-bal),
          })
        : "";
  return (
    <div className="flex flex-col gap-4" data-testid="sp-account">
      <PageTitle title={party.name} subtitle={t("mill.spAccount")} back="/mill" />
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-muted-foreground text-sm">
              {bal < 0n
                ? t("mill.spBalanceWe")
                : bal > 0n
                  ? t("mill.spBalanceThey")
                  : t("mill.spSettled")}
            </span>
            <p
              className={`tabular text-3xl font-semibold ${bal < 0n ? "text-red-800" : "text-emerald-800"}`}
              data-testid="sp-balance"
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
          <WhatsAppButton phone={party.phone} text={waText} className="h-12" />
        </div>
        {readOnly ? null : (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button asChild className="h-12">
              <Link href={`/mill/entry/new?party=${party._id}`} data-testid="sp-add-entry">
                {t("mill.spNewBtn")}
              </Link>
            </Button>
            <Button variant="outline" className="h-12" onClick={() => setMoney2("OUT")}>
              {t("mill.spGive")}
            </Button>
            <Button variant="outline" className="h-12" onClick={() => setMoney2("IN")}>
              {t("mill.spTake")}
            </Button>
          </div>
        )}
      </Panel>
      <Panel title={t("mill.spEntries")}>
        {entries.length === 0 ? (
          <EmptyState icon={Scale} title={t("mill.none")} />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {entries.map((r, i) => (
              <li key={r.doc._id}>
                <TxnCard
                  index={i}
                  icon={Scale}
                  tone={r.doc.kind === "WE_OWE" ? "out" : "in"}
                  title={t(`mill.${r.doc.kind}`)}
                  date={`${date(r.doc.transactionDate, "short")} · ${r.doc.number}`}
                  amountPaise={BigInt(r.doc.amountPaise)}
                  direction={r.doc.kind === "WE_OWE" ? "OUT" : "IN"}
                  status={r.doc.status === "void" ? "VOID" : displayStatus(r.state)}
                  href={`/mill/entry/view?id=${r.doc._id}`}
                  testId="sp-entry-row"
                  extra={
                    r.doc.status === "active" && r.state.duePaise > 0n ? (
                      <span className="tabular text-xs">
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
      {onAccount.length ? (
        <Panel title={t("mill.spOnAccount")}>
          <PaymentList payments={onAccount} godownId={godown._id} />
        </Panel>
      ) : null}
      <Panel
        title={t("mill.spLedger")}
        action={
          <Button asChild variant="outline" className="h-11">
            <Link
              href={printHrefOf({
                id: "party-ledger",
                from: ledger.rows[0]?.date ?? todayIST(),
                to: todayIST(),
                opt: party._id,
              })}
              data-testid="sp-statement"
            >
              <Printer className="size-4" aria-hidden />
              {t("dues.statement")}
            </Link>
          </Button>
        }
      >
        <LedgerTable
          rows={ledger.rows}
          debitLabel={t("mill.spDebit")}
          creditLabel={t("mill.spCredit")}
          testId="sp-ledger"
        />
      </Panel>
      {money2 ? (
        <AdvanceSheet
          godownId={godown._id}
          partyId={party._id}
          direction={money2}
          sourceType="SECOND_PARTY"
          title={money2 === "OUT" ? t("mill.spGive") : t("mill.spTake")}
          onClose={() => setMoney2(null)}
        />
      ) : null}
    </div>
  );
}

export default function SecondPartyAccountPage() {
  return (
    <PageSuspense>
      <Account />
    </PageSuspense>
  );
}

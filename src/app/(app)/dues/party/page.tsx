"use client";

/**
 * Party ledger (requirement_v2 §12.6): balance and category, open bills, the chronological ledger
 * from every source with running balance and links (date-range filter), pay / collect across bills,
 * WhatsApp, call, print / share the statement.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Phone, Printer } from "lucide-react";
import { PayAcross } from "@/components/dues/PayAcross";
import { useDueWhatsApp } from "@/components/dues/DueTabs";
import { LedgerTable } from "@/components/entry/PartyAccount";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { Panel } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { Loading } from "@/components/lists/common";
import { PageTitle } from "@/components/shell/PageTitle";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { useActiveGodown } from "@/client/hooks";
import { dueCategory, openBillsOf } from "@/client/queries/dues";
import { partyLedger } from "@/client/queries/purchases";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

function PartyLedger() {
  const { t, money, date } = useI18n();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const wa = useDueWhatsApp();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paying, setPaying] = useState<"IN" | "OUT" | null>(null);
  const data = useLiveQuery(async () => {
    if (!id || !godown) return null;
    const party = await db().parties.get(id);
    if (!party || party.godownId !== godown._id) return null;
    const [ledger, all, inBills, outBills] = await Promise.all([
      partyLedger(godown._id, id, from || undefined, to || undefined),
      partyLedger(godown._id, id),
      openBillsOf(godown._id, id, "IN"),
      openBillsOf(godown._id, id, "OUT"),
    ]);
    return { party, ledger, balance: all.closing, open: [...inBills, ...outBills] };
  }, [id, godown?._id, from, to]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown) return <ReadOnlyNotice reason="notFound" />;
  const { party, ledger, balance, open } = data;
  const cat = dueCategory(party.roles, balance);
  const earliest = open
    .map((o) => o.state.bill.dueDate)
    .filter((x): x is string => !!x)
    .sort()[0];
  return (
    <div className="flex flex-col gap-4" data-testid="due-party">
      <PageTitle title={party.name} subtitle={t("dues.ledgerTitle")} back="/dues" />
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-muted-foreground text-sm">
              {cat ? t(`dues.cat.${cat}` as TKey) : t("mill.spSettled")}
            </span>
            <p
              className={`tabular text-3xl font-semibold ${balance > 0n ? "text-emerald-800" : balance < 0n ? "text-red-800" : ""}`}
              data-testid="due-party-balance"
              data-paise={balance.toString()}
            >
              {money(balance < 0n ? -balance : balance)}
            </p>
            <span className="text-muted-foreground text-xs">
              {balance > 0n ? t("dues.theyOwe") : balance < 0n ? t("dues.weOwe") : ""}
            </span>
          </div>
          <div className="no-print flex gap-2">
            {party.phone ? (
              <Button asChild variant="outline" size="icon" className="size-12">
                <a href={`tel:${party.phone}`} aria-label={t("dues.call")}>
                  <Phone className="size-5" aria-hidden />
                </a>
              </Button>
            ) : null}
            <WhatsAppButton
              phone={party.phone}
              text={wa(party.name, balance, earliest)}
              className="h-12"
            />
          </div>
        </div>
        {readOnly ? null : (
          <div className="no-print mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-12"
              onClick={() => setPaying("OUT")}
              data-testid="due-party-pay"
            >
              <ArrowUpRight className="size-5" aria-hidden />
              {t("quick.paid")}
            </Button>
            <Button
              variant="outline"
              className="h-12"
              onClick={() => setPaying("IN")}
              data-testid="due-party-collect"
            >
              <ArrowDownLeft className="size-5" aria-hidden />
              {t("quick.received")}
            </Button>
          </div>
        )}
      </Panel>
      {open.length ? (
        <Panel title={t("dues.openBills")}>
          <ul className="flex flex-col divide-y text-sm">
            {open.map((o) => (
              <li key={o.state.bill.sourceId} className="flex items-center justify-between py-2">
                <span>
                  {t(`voucherType.${o.doc.type}` as TKey)} · {o.doc.number}
                  <span className="text-muted-foreground block text-xs">
                    {date(o.state.bill.date, "short")}
                    {o.state.bill.dueDate
                      ? ` · ${t("dues.dueOn", { date: date(o.state.bill.dueDate, "short") })}`
                      : ""}
                  </span>
                </span>
                <span
                  className={`tabular font-semibold ${o.state.bill.direction === "IN" ? "text-money-in" : "text-money-out"}`}
                >
                  {money(o.state.duePaise)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <Panel
        title={t("dues.statement")}
        action={
          <Button variant="outline" className="no-print h-11" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            {t("rcpt.print")}
          </Button>
        }
      >
        <div className="no-print mb-3 flex flex-wrap gap-2">
          <label className="bg-card flex min-h-10 items-center gap-1 rounded-full border px-3 text-sm">
            {t("pur.filterFrom")}
            <input
              type="date"
              className="bg-transparent"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="bg-card flex min-h-10 items-center gap-1 rounded-full border px-3 text-sm">
            {t("pur.filterTo")}
            <input
              type="date"
              className="bg-transparent"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        {from ? (
          <p className="text-muted-foreground tabular mb-2 text-sm">
            {t("dues.openingOn", {
              date: date(from, "short"),
              amount: money(ledger.opening < 0n ? -ledger.opening : ledger.opening),
            })}
          </p>
        ) : null}
        <LedgerTable
          rows={ledger.rows}
          debitLabel={t("mill.spDebit")}
          creditLabel={t("mill.spCredit")}
          testId="due-ledger"
        />
      </Panel>
      {paying ? (
        <BottomSheet
          open
          onOpenChange={(o) => !o && setPaying(null)}
          title={t(paying === "OUT" ? "quick.paid" : "quick.received")}
          testId="due-pay-sheet"
        >
          <PayAcross
            godownId={godown._id}
            partyId={party._id}
            direction={paying}
            onDone={() => setPaying(null)}
          />
        </BottomSheet>
      ) : null}
    </div>
  );
}

export default function DuePartyPage() {
  return (
    <PageSuspense>
      <PartyLedger />
    </PageSuspense>
  );
}

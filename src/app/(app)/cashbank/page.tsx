"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateField } from "@/components/forms/fields";
import { BankPicker } from "@/components/forms/pickers";
import { EmptyState, Loading } from "@/components/lists/common";
import { Money } from "@/components/money/display";
import { PageHeader, PageSuspense, ReadOnlyNotice } from "@/components/system/page";
import { useNames } from "@/components/vouchers/names";
import { viewPathOf } from "@/components/vouchers/VoucherView";
import { useActiveGodown, useGodownRole } from "@/client/hooks";
import { accountBook, chequesInHand } from "@/client/queries/cashbank";
import { dot } from "@/client/ui/text";
import { addDays, todayIST } from "@/domain/dates";
import { ACC, bankAccountKey } from "@/domain/posting/accounts";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

function BookView({
  godownId,
  account,
  testId,
}: {
  godownId: string;
  account: string;
  testId: string;
}) {
  const { t, date: fmtDate } = useI18n();
  const names = useNames(godownId);
  const [from, setFrom] = useState(addDays(todayIST(), -30));
  const [to, setTo] = useState(todayIST());
  const book = useLiveQuery(
    () => accountBook(godownId, account, { from, to }),
    [godownId, account, from, to],
  );
  return (
    <div className="flex flex-col gap-2 pt-2" data-testid={testId}>
      <div className="grid grid-cols-2 gap-2">
        <DateField
          label={t("filters.from")}
          value={from}
          max={to}
          onChange={(v) => v && setFrom(v)}
        />
        <DateField
          label={t("filters.to")}
          value={to}
          max={todayIST()}
          onChange={(v) => v && setTo(v)}
        />
      </div>
      {!book || !names ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-medium">{t("common.date")}</th>
                <th className="p-2 text-right font-medium">{t("cashbank.in")}</th>
                <th className="p-2 text-right font-medium">{t("cashbank.out")}</th>
                <th className="p-2 text-right font-medium">{t("cashbank.balance")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="p-2" colSpan={3}>
                  {t("cashbank.opening")}
                </td>
                <td className="tabular p-2 text-right">
                  <Money paise={book.openingPaise} />
                </td>
              </tr>
              {book.rows.length === 0 ? (
                <tr className="border-t">
                  <td className="text-muted-foreground p-2" colSpan={4}>
                    {t("cashbank.empty")}
                  </td>
                </tr>
              ) : (
                book.rows.map((r) => {
                  const v = r.voucher;
                  const party = v && "partyId" in v ? names.party(v.partyId as string) : "";
                  return (
                    <tr key={r.voucherId} className="border-t align-top">
                      <td className="p-2">
                        {v ? (
                          <Link href={viewPathOf(v)} className="text-primary underline">
                            {dot(fmtDate(r.date, "short"), t(`voucherType.${v.type}` as TKey))}
                          </Link>
                        ) : (
                          fmtDate(r.date, "short")
                        )}
                        {party ? (
                          <div className="text-muted-foreground max-w-40 truncate text-xs">
                            {party}
                          </div>
                        ) : null}
                      </td>
                      <td className="tabular p-2 text-right">
                        {r.inPaise ? <Money paise={r.inPaise} /> : null}
                      </td>
                      <td className="tabular p-2 text-right">
                        {r.outPaise ? <Money paise={r.outPaise} /> : null}
                      </td>
                      <td className="tabular p-2 text-right">
                        <Money paise={r.balancePaise} />
                      </td>
                    </tr>
                  );
                })
              )}
              <tr className="border-t font-semibold">
                <td className="p-2">{t("cashbank.closing")}</td>
                <td className="tabular p-2 text-right">
                  <Money paise={book.totalInPaise} />
                </td>
                <td className="tabular p-2 text-right">
                  <Money paise={book.totalOutPaise} />
                </td>
                <td className="tabular p-2 text-right">
                  <Money paise={book.closingPaise} testId={`${testId}-closing`} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Banks({ godownId }: { godownId: string }) {
  const { t } = useI18n();
  const [bank, setBank] = useState<string | undefined>();
  return (
    <div className="flex flex-col gap-2 pt-2">
      <BankPicker godownId={godownId} label={t("cashbank.bank")} value={bank} onChange={setBank} />
      {bank ? (
        <BookView godownId={godownId} account={bankAccountKey(bank)} testId="bank-book" />
      ) : null}
    </div>
  );
}

function Cheques({ godownId, writable }: { godownId: string; writable: boolean }) {
  const { t, date: fmtDate } = useI18n();
  const names = useNames(godownId);
  const list = useLiveQuery(() => chequesInHand(godownId), [godownId]);
  if (!list || !names) return <Loading />;
  if (list.length === 0) return <EmptyState text={t("cashbank.noCheques")} />;
  return (
    <ul className="flex flex-col gap-2 pt-2" data-testid="cheques-in-hand">
      {list.map((c) => (
        <li key={c.receipt._id}>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4 text-sm">
              <div className="flex justify-between gap-2">
                <Link href={viewPathOf(c.receipt)} className="min-w-0 font-medium underline">
                  {t("cashbank.chequeLine", {
                    party: names.party(c.receipt.partyId),
                    no: c.receipt.chequeNo ?? "—",
                    date: fmtDate(c.receipt.chequeDate ?? c.receipt.date, "short"),
                  })}
                </Link>
                <Money paise={c.amountPaise} className="shrink-0 font-semibold" />
              </div>
              {writable ? (
                <div className="flex gap-2">
                  <Button asChild variant="outline" className="h-11 flex-1">
                    <Link href={`/cashbank/entry?kind=CHEQUE_CLEAR&receipt=${c.receipt._id}`}>
                      {t("cashbank.clear")}
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="h-11 flex-1">
                    <Link href={`/cashbank/entry?kind=CHEQUE_BOUNCE&receipt=${c.receipt._id}`}>
                      {t("cashbank.bounce")}
                    </Link>
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Inner() {
  const { t } = useI18n();
  const { godownId, consolidated, godown } = useActiveGodown();
  const role = useGodownRole();
  if (consolidated) return <ReadOnlyNotice reason="consolidated" />;
  if (!godownId) return <Loading />;
  const writable = role !== null && role !== "viewer" && godown?.status === "active";
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("cashbank.title")}
        actions={
          writable ? (
            <Button asChild className="h-11">
              <Link href="/cashbank/entry" data-testid="contra-new">
                <Plus className="size-4" aria-hidden />
                {t("cashbank.newEntry")}
              </Link>
            </Button>
          ) : null
        }
      />
      <Tabs defaultValue="cash">
        <TabsList className="flex h-auto w-full flex-wrap">
          <TabsTrigger value="cash" className="min-h-11 flex-1">
            {t("cashbank.cashBook")}
          </TabsTrigger>
          <TabsTrigger value="bank" className="min-h-11 flex-1">
            {t("cashbank.bankBook")}
          </TabsTrigger>
          <TabsTrigger value="cheques" className="min-h-11 flex-1">
            {t("cashbank.chequesInHand")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="cash">
          <BookView godownId={godownId} account={ACC.CASH} testId="cash-book" />
        </TabsContent>
        <TabsContent value="bank">
          <Banks godownId={godownId} />
        </TabsContent>
        <TabsContent value="cheques">
          <Cheques godownId={godownId} writable={writable} />
        </TabsContent>
      </Tabs>
      {writable ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("cashbank.newEntry")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {(
              [
                "CASH_DEPOSIT",
                "CASH_WITHDRAWAL",
                "BANK_TRANSFER",
                "CAPITAL_IN",
                "DRAWINGS",
              ] as const
            ).map((k) => (
              <Button
                key={k}
                asChild
                variant="outline"
                className="h-auto min-h-12 whitespace-normal"
              >
                <Link href={`/cashbank/entry?kind=${k}`} data-testid={`contra-${k}`}>
                  {t(`cashbank.kind.${k}` as TKey)}
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** ক্যাশ ও ব্যাংক (spec §9.9). */
export default function CashBankPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

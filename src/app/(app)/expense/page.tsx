"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateNav } from "@/components/daily/DateNav";
import { EmptyState, Loading } from "@/components/lists/common";
import { Money } from "@/components/money/display";
import { PageHeader, PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { useNames } from "@/components/vouchers/names";
import { viewPathOf } from "@/components/vouchers/VoucherView";
import { db } from "@/client/db/dexie";
import { useActiveGodown } from "@/client/hooks";
import { VEHICLE_BUCKET } from "@/client/queries/dashboard";
import { dailyExpense, monthlyExpenses } from "@/client/queries/expenses";
import { categoryLabel } from "@/client/ui/labels";
import { dot } from "@/client/ui/text";
import { todayIST } from "@/domain/dates";
import type { Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

function useCategoryName(godownId: string | null) {
  const { t } = useI18n();
  const cats = useLiveQuery(
    async () =>
      godownId ? db().expenseCategories.where("godownId").equals(godownId).toArray() : [],
    [godownId],
  );
  return (code: string) => {
    if (code === VEHICLE_BUCKET) return t("exp.vehicleBucket");
    const c = cats?.find((x) => x.code === code);
    return c ? categoryLabel(c, t) : code;
  };
}

function itemTitle(v: Voucher, names: ReturnType<typeof useNames>): string {
  if (!names) return "";
  if (v.type === "EXPENSE") {
    return dot(v.description, names.party(v.payeePartyId) || v.payeeText);
  }
  if (v.type === "TRIP") return dot(names.vehicle(v.vehicleId), v.number);
  return v.number;
}

function Daily({ godownId }: { godownId: string }) {
  const { t, money } = useI18n();
  const initial = useParam("date");
  const [date, setDate] = useState(initial ?? todayIST());
  const names = useNames(godownId);
  const catName = useCategoryName(godownId);
  const data = useLiveQuery(() => dailyExpense(godownId, date), [godownId, date]);
  if (!data || !names) return <Loading />;
  return (
    <div className="flex flex-col gap-3 pt-2">
      <DateNav value={date} onChange={setDate} testId="expense-date" />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex justify-between gap-2 text-base">
            <span>{t("expense.farmerPayments")}</span>
            <Money paise={data.farmerTotalPaise} testId="expense-farmer-total" />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground text-xs">{t("exp.farmerNote")}</p>
          {data.farmerPayments.length === 0 ? (
            <p className="text-muted-foreground">{t("exp.noFarmerPayments")}</p>
          ) : (
            data.farmerPayments.map((p) => (
              <Link
                key={p._id}
                href={viewPathOf(p)}
                className="hover:bg-muted flex min-h-11 items-center justify-between gap-2 rounded px-1"
              >
                <span className="min-w-0 truncate">
                  {dot(names.party(p.partyId), t(`payMode.${p.mode}` as TKey))}
                </span>
                <Money paise={BigInt(p.amountPaise)} />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
      {data.categories.length === 0 ? (
        <EmptyState text={t("exp.empty")} />
      ) : (
        data.categories.map((b) => (
          <Card key={b.code} data-testid={`expense-block-${b.code}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex justify-between gap-2 text-base">
                <span>{catName(b.code)}</span>
                <Money paise={b.totalPaise} testId={`expense-subtotal-${b.code}`} />
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {b.items.map((it, i) => (
                <Link
                  key={`${it.voucher._id}-${i}`}
                  href={viewPathOf(it.voucher)}
                  className="hover:bg-muted flex min-h-11 items-center justify-between gap-2 rounded px-1"
                >
                  <span className="min-w-0 truncate">{itemTitle(it.voucher, names)}</span>
                  <Money paise={it.amountPaise} />
                </Link>
              ))}
            </CardContent>
          </Card>
        ))
      )}
      <Card>
        <CardContent className="flex flex-col gap-1 pt-6">
          <div className="flex justify-between gap-2 font-semibold">
            <span>{t("exp.grandTotal")}</span>
            <Money paise={data.grandTotalPaise} testId="expense-grand-total" />
          </div>
          <div className="text-muted-foreground flex justify-between gap-2 text-sm">
            <span>{t("exp.cashOutflow")}</span>
            <span className="tabular">{money(data.cashOutflowPaise)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Monthly({ godownId }: { godownId: string }) {
  const { t, money } = useI18n();
  const [ym, setYm] = useState(todayIST().slice(0, 7));
  const catName = useCategoryName(godownId);
  const rows = useLiveQuery(() => monthlyExpenses(godownId, ym), [godownId, ym]);
  let cur = 0n;
  let prev = 0n;
  for (const r of rows ?? []) {
    cur += r.thisMonthPaise;
    prev += r.lastMonthPaise;
  }
  return (
    <div className="flex flex-col gap-3 pt-2">
      <label className="flex flex-col gap-1 text-sm">
        {t("exp.month")}
        <input
          type="month"
          className="border-input h-12 rounded-md border px-3 text-base"
          value={ym}
          max={todayIST().slice(0, 7)}
          onChange={(e) => e.target.value && setYm(e.target.value)}
        />
      </label>
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState text={t("exp.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-medium">{t("exp.category")}</th>
                <th className="p-2 text-right font-medium">{t("exp.thisMonth")}</th>
                <th className="p-2 text-right font-medium">{t("exp.lastMonth")}</th>
                <th className="p-2 text-right font-medium">{t("exp.change")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = r.thisMonthPaise - r.lastMonthPaise;
                return (
                  <tr key={r.code} className="border-t">
                    <td className="p-2">{catName(r.code)}</td>
                    <td className="tabular p-2 text-right">{money(r.thisMonthPaise)}</td>
                    <td className="tabular text-muted-foreground p-2 text-right">
                      {money(r.lastMonthPaise)}
                    </td>
                    <td
                      className={`tabular p-2 text-right ${diff > 0n ? "text-red-700 dark:text-red-400" : diff < 0n ? "text-emerald-700 dark:text-emerald-400" : ""}`}
                    >
                      {diff > 0n ? `+${money(diff)}` : money(diff)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t font-semibold">
                <td className="p-2">{t("common.total")}</td>
                <td className="tabular p-2 text-right">{money(cur)}</td>
                <td className="tabular p-2 text-right">{money(prev)}</td>
                <td className="tabular p-2 text-right">{money(cur - prev)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Inner() {
  const { t } = useI18n();
  const { godownId, consolidated } = useActiveGodown();
  if (consolidated) return <ReadOnlyNotice reason="consolidated" />;
  if (!godownId) return <Loading />;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("expense.title")}
        actions={
          <Button asChild className="h-11">
            <Link href="/expense/new" data-testid="expense-new">
              <Plus className="size-4" aria-hidden />
              {t("home.newExpense")}
            </Link>
          </Button>
        }
      />
      <Tabs defaultValue="daily">
        <TabsList className="w-full">
          <TabsTrigger value="daily" className="min-h-11 flex-1">
            {t("common.today")}
          </TabsTrigger>
          <TabsTrigger value="monthly" className="min-h-11 flex-1">
            {t("exp.monthly")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="daily">
          <Daily godownId={godownId} />
        </TabsContent>
        <TabsContent value="monthly">
          <Monthly godownId={godownId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** দৈনিক খরচ (spec §9.4): `?date=`. */
export default function ExpensePage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

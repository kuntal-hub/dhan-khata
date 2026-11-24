"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState, type ReactNode } from "react";
import { CalendarCheck, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { DateNav } from "@/components/daily/DateNav";
import { EmptyState, Loading } from "@/components/lists/common";
import { Money, Qty } from "@/components/money/display";
import { VoucherRow } from "@/components/vouchers/VoucherRow";
import { useNames } from "@/components/vouchers/names";
import { db } from "@/client/db/dexie";
import { useGodownRole } from "@/client/hooks";
import { VEHICLE_BUCKET, dashboardData, topReminders } from "@/client/queries/dashboard";
import { vouchersOfDay } from "@/client/queries/vouchers";
import { categoryLabel } from "@/client/ui/labels";
import { dot } from "@/client/ui/text";
import type { Voucher } from "@/domain/schemas";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

/** One big dashboard card: label ≤ 14 px, number ≥ 28 px (spec §9.1). */
function StatCard({
  label,
  children,
  sub,
  onClick,
  testId,
  className,
}: {
  label: string;
  children: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
  testId?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const body = (
    <>
      <span className="text-muted-foreground line-clamp-2 text-sm leading-tight">{label}</span>
      <span className="tabular text-[28px] leading-tight font-semibold break-all">{children}</span>
      {sub ? <span className="text-muted-foreground text-xs leading-tight">{sub}</span> : null}
    </>
  );
  return (
    <Card className={cn("gap-0 py-0", className)} data-testid={testId}>
      <CardContent className="p-0">
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="hover:bg-muted flex min-h-24 w-full flex-col items-start gap-1 rounded-xl p-3 text-left"
            title={t("dash.tapForDetail")}
          >
            {body}
          </button>
        ) : (
          <div className="flex min-h-24 flex-col items-start gap-1 p-3">{body}</div>
        )}
      </CardContent>
    </Card>
  );
}

function partyOf(v: Voucher): string | undefined {
  if (v.type === "LOAD") return v.toMillPartyId;
  return "partyId" in v ? (v.partyId as string | undefined) : undefined;
}

/** Home dashboard for the ACTIVE godown (spec §9.1). */
export function Dashboard({
  godownId,
  date,
  onDate,
  quickActions,
}: {
  godownId: string;
  date: string;
  onDate: (d: string) => void;
  quickActions: ReactNode;
}) {
  const { t, money, weightOf } = useI18n();
  const role = useGodownRole();
  const names = useNames(godownId);
  const [sheet, setSheet] = useState<"stock" | "expense" | null>(null);
  const [showProfit, setShowProfit] = useState(false);
  const data = useLiveQuery(async () => {
    const [d, list, rems, cats] = await Promise.all([
      dashboardData(godownId, date),
      vouchersOfDay(godownId, date),
      topReminders(godownId, 5),
      db().expenseCategories.where("godownId").equals(godownId).toArray(),
    ]);
    return { d, list, rems, cats };
  }, [godownId, date]);
  if (!data || !names) return <Loading />;
  const { d, list, rems, cats } = data;
  const catName = (code: string) => {
    if (code === VEHICLE_BUCKET) return t("dash.vehicleExpense");
    const c = cats.find((x) => x.code === code);
    return c ? categoryLabel(c, t) : code;
  };
  const closed = d.dayStatus?.closed === true;
  const canClose = role === "owner" || role === "manager";

  return (
    <div className="flex flex-col gap-3" data-testid="dashboard">
      <DateNav value={date} onChange={onDate} testId="dash-date" />

      <div className="grid grid-cols-2 gap-2" data-testid="dash-cards">
        <StatCard label={t("dashboard.openingCash")} testId="dash-opening-cash">
          <Money paise={d.openingCashPaise} testId="dash-opening-cash-value" />
        </StatCard>
        <StatCard
          label={t("dashboard.expectedClosingCash")}
          testId="dash-expected-cash"
          sub={dot(`+${money(d.cashInPaise)}`, `−${money(d.cashOutPaise)}`)}
        >
          <Money paise={d.expectedClosingCashPaise} testId="home-cash" />
        </StatCard>
        <StatCard
          label={t("dashboard.totalStock")}
          testId="dash-stock"
          onClick={() => setSheet("stock")}
          sub={money(d.stockValuePaise)}
        >
          <Qty grams={d.stockQtyG} testId="dash-stock-value" />
        </StatCard>
        <StatCard
          label={t("dashboard.todaySaleQty")}
          testId="dash-sale-qty"
          sub={t("dash.entries", { count: d.saleCount })}
        >
          <Qty grams={d.saleQtyG} />
        </StatCard>
        <StatCard
          label={t("dashboard.todayPurchase")}
          testId="dash-purchase"
          sub={dot(money(d.purchaseAmountPaise), t("dash.entries", { count: d.purchaseCount }))}
        >
          <Qty grams={d.purchaseQtyG} />
        </StatCard>
        <StatCard label={t("dashboard.todaySaleAmount")} testId="dash-sale-amount">
          <Money paise={d.saleAmountPaise} />
        </StatCard>
        <StatCard
          label={t("dashboard.todayExpense")}
          testId="dash-expense"
          onClick={() => setSheet("expense")}
        >
          <Money paise={d.expensePaise} testId="dash-expense-value" />
        </StatCard>
        <StatCard label={t("dashboard.receivableTotal")} testId="dash-receivable">
          <Money paise={d.receivablePaise} className="text-emerald-700 dark:text-emerald-400" />
        </StatCard>
        <StatCard label={t("dashboard.payableTotal")} testId="dash-payable">
          <Money paise={d.payablePaise} className="text-red-700 dark:text-red-400" />
        </StatCard>
        <Card className="gap-0 py-0" data-testid="dash-due">
          <CardContent className="flex min-h-24 flex-col gap-1 p-3">
            <span className="text-muted-foreground line-clamp-2 text-sm leading-tight">
              {t("dashboard.dueToday")}
            </span>
            {(
              [
                ["collect", d.collectDue, "text-emerald-700 dark:text-emerald-400"],
                ["pay", d.payDue, "text-red-700 dark:text-red-400"],
              ] as const
            ).map(([k, s, tone]) => (
              <div key={k} className="flex flex-col">
                <span className="text-xs">
                  {dot(
                    t(k === "collect" ? "dash.collect" : "dash.pay"),
                    t("dash.entries", { count: s.count }),
                  )}
                </span>
                <Money paise={s.amountPaise} className={cn("text-xl font-semibold", tone)} />
                {s.overdueCount > 0 ? (
                  <span className="text-destructive text-xs font-medium">
                    {t("dash.overdue", { count: s.overdueCount })}
                  </span>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {role === "owner" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            className="h-11"
            onClick={() => setShowProfit((x) => !x)}
            data-testid="toggle-profit"
          >
            {showProfit ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
            {showProfit ? t("dash.hideProfit") : t("dash.showProfit")}
          </Button>
          {showProfit ? (
            <span className="tabular text-lg font-semibold" data-testid="dash-profit">
              {dot(t("dashboard.todayProfit"), money(d.profitPaise))}
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="flex flex-col gap-1" data-testid="dash-banks">
        <h2 className="text-base font-semibold">{t("dash.banks")}</h2>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {d.banks.length === 0 ? (
            <span className="text-muted-foreground text-sm">{t("dash.noBanks")}</span>
          ) : null}
          {d.banks.map((b) => (
            <div key={b.bankAccountId} className="min-w-36 shrink-0 rounded-lg border p-2">
              <div className="text-muted-foreground truncate text-xs">
                {names.bank(b.bankAccountId)}
              </div>
              <Money paise={b.balancePaise} className="font-semibold" />
            </div>
          ))}
          <Link href="/cashbank" className="min-w-36 shrink-0 rounded-lg border p-2">
            <div className="text-muted-foreground truncate text-xs">{t("dash.chequesInHand")}</div>
            <Money paise={d.chequesInHandPaise} className="font-semibold" />
          </Link>
        </div>
      </section>

      {quickActions}

      <section className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t("home.todayList")}</h2>
        {list.length === 0 ? (
          <EmptyState text={t("home.todayEmpty")} />
        ) : (
          <ul data-testid="today-list">
            {list.map((v) => (
              <li key={v._id}>
                <VoucherRow v={v} partyName={names.party(partyOf(v))} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1" data-testid="dash-reminders">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("dash.reminders")}</h2>
          <Link href="/reminders" className="text-primary min-h-11 py-3 text-sm underline">
            {t("dash.seeAll")}
          </Link>
        </div>
        {rems.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("dash.noReminders")}</p>
        ) : (
          <ul className="flex flex-col">
            {rems.map((r) => (
              <li
                key={r._id}
                className="flex min-h-11 items-center justify-between gap-2 border-b text-sm"
              >
                <span
                  className={cn(
                    "min-w-0 truncate",
                    r.dueDate < date ? "text-destructive font-medium" : "",
                  )}
                >
                  {dot(
                    names.party(r.partyId) || r.title || t(`reminder.kind.${r.kind}` as TKey),
                    t(`reminder.kind.${r.kind}` as TKey),
                  )}
                </span>
                {r.amountPaise ? (
                  <Money paise={BigInt(r.amountPaise)} className="shrink-0" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {closed ? (
        <Link
          href={`/day-close?date=${date}`}
          className="flex min-h-12 items-center justify-center gap-2 rounded-md border font-semibold text-emerald-700 dark:text-emerald-400"
          data-testid="dash-day-closed"
        >
          <CheckCircle2 className="size-5" aria-hidden />
          {t("dash.dayClosed")}
        </Link>
      ) : canClose ? (
        <Button asChild className="h-12 text-base" variant="secondary">
          <Link href={`/day-close?date=${date}`} data-testid="dash-close-day">
            <CalendarCheck className="size-5" aria-hidden />
            {t("dash.closeDay")}
          </Link>
        </Button>
      ) : null}

      <BottomSheet
        open={sheet === "stock"}
        onOpenChange={(o) => !o && setSheet(null)}
        title={t("dash.stockBreakdown")}
      >
        <ul className="flex flex-col" data-testid="dash-stock-breakdown">
          {d.stockByVariety.map((s) => (
            <li
              key={s.varietyId}
              className="flex min-h-11 items-center justify-between gap-2 border-b"
            >
              <Link href={`/stock/register?varietyId=${s.varietyId}`} className="underline">
                {names.variety(s.varietyId)}
              </Link>
              <span className="tabular">{weightOf(s.qtyG)}</span>
            </li>
          ))}
        </ul>
        <Button asChild variant="outline" className="h-11">
          <Link href="/stock">{t("nav.stock")}</Link>
        </Button>
      </BottomSheet>
      <BottomSheet
        open={sheet === "expense"}
        onOpenChange={(o) => !o && setSheet(null)}
        title={t("dash.expenseBreakdown")}
      >
        <ul className="flex flex-col" data-testid="dash-expense-breakdown">
          {[...d.expenseByCategory.entries()].map(([code, p]) => (
            <li key={code} className="flex min-h-11 items-center justify-between gap-2 border-b">
              <span>{catName(code)}</span>
              <Money paise={p} />
            </li>
          ))}
        </ul>
        <Button asChild variant="outline" className="h-11">
          <Link href={`/expense?date=${date}`}>{t("expense.title")}</Link>
        </Button>
      </BottomSheet>
    </div>
  );
}

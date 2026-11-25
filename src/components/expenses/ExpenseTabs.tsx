"use client";

/**
 * Daily Expenses tabs (requirement_v2 §12.4):
 *  - আজকের খরচ: a day (◀ ▶, any date) grouped by category with subtotals, the farmer-payments
 *    block with a "পেমেন্ট" badge (not expenses), money paid out that day (and the cash part);
 *  - সব খরচ: filters by expense date or payment date, category, status, search; totals;
 *  - বাকি খরচ: unpaid / part-paid with due dates and a pay button.
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useDeferredValue, useState } from "react";
import { ChevronLeft, ChevronRight, Receipt, Settings2, Wheat } from "lucide-react";
import { AddPaymentSheet } from "@/components/entry/Payments";
import { EmptyState, Panel, Skeleton, TxnCard } from "@/components/kit/Kit";
import { SearchBox } from "@/components/sales/SalesTabs";
import { useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { useActiveGodown } from "@/client/hooks";
import {
  categoryList,
  expenseDay,
  expenseRows,
  expenseTotals,
  unpaidExpenses,
  type ExpenseFilter,
  type ExpenseRow,
} from "@/client/queries/expenses";
import { addDays, todayIST } from "@/domain/dates";
import type { PayStatus } from "@/domain/v2/payments";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { CategoryManager, categoryName } from "./category";

function ExpenseCard({
  r,
  index,
  action,
}: {
  r: ExpenseRow;
  index: number;
  action?: React.ReactNode;
}) {
  const { t, money, date } = useI18n();
  const who = r.party?.name ?? r.doc.personText;
  return (
    <TxnCard
      index={index}
      icon={Receipt}
      tone="out"
      title={r.doc.title}
      subtitle={[categoryName(r.category, t, r.doc.categoryCode), who].filter(Boolean).join(" · ")}
      date={`${date(r.doc.expenseDate, "short")} · ${r.doc.number}`}
      amountPaise={BigInt(r.doc.amountPaise)}
      direction="OUT"
      status={r.doc.status === "void" ? "VOID" : r.state.status}
      href={`/expenses/view?id=${r.doc._id}`}
      testId="expense-row"
      extra={
        <>
          {r.doc.status === "active" && r.state.duePaise > 0n ? (
            <span className="tabular text-xs text-red-700">
              {t("xp.due", { amount: money(r.state.duePaise) })}
              {r.doc.dueDate ? ` · ${t("xp.dueBy", { date: date(r.doc.dueDate, "short") })}` : ""}
            </span>
          ) : null}
          {action}
        </>
      }
    />
  );
}

export function TodayExpenses() {
  const { t, money, date } = useI18n();
  const { godownId } = useActiveGodown();
  const today = todayIST();
  const [day, setDay] = useState(today);
  const data = useLiveQuery(
    () => (godownId ? expenseDay(godownId, day) : undefined),
    [godownId, day],
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-card shadow-card flex items-center gap-2 rounded-2xl border p-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("dash.prevDay")}
          onClick={() => setDay(addDays(day, -1))}
          data-testid="xp-prev-day"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
        <input
          type="date"
          className="h-11 min-w-0 flex-1 bg-transparent text-center text-base"
          value={day}
          max={today}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          aria-label={t("xp.day")}
          data-testid="xp-day"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("dash.nextDay")}
          disabled={day >= today}
          onClick={() => setDay(addDays(day, 1))}
        >
          <ChevronRight className="size-5" aria-hidden />
        </Button>
      </div>
      {data === undefined ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3" data-testid="xp-day-totals">
            <div className="bg-card shadow-card rounded-2xl border p-3">
              <span className="text-muted-foreground text-xs">{t("xp.incurred")}</span>
              <p
                className="tabular text-xl font-semibold"
                data-testid="xp-incurred"
                data-paise={data.incurredPaise.toString()}
              >
                {money(data.incurredPaise)}
              </p>
            </div>
            <div className="bg-card shadow-card rounded-2xl border p-3">
              <span className="text-muted-foreground text-xs">{t("xp.cashOut")}</span>
              <p
                className="tabular text-xl font-semibold text-red-800"
                data-testid="xp-cashout"
                data-paise={data.cashOutPaise.toString()}
              >
                {money(data.cashOutPaise)}
              </p>
              <span className="text-muted-foreground tabular text-xs">
                {t("xp.ofWhichCash", { amount: money(data.cashOutCashPaise) })}
              </span>
            </div>
          </div>
          {data.groups.length === 0 ? (
            <EmptyState icon={Receipt} title={t("xp.empty")} hint={date(day)} />
          ) : (
            data.groups.map((g) => (
              <Panel
                key={g.code}
                title={categoryName(g.category, t, g.code)}
                action={
                  <span
                    className="tabular text-sm font-semibold"
                    data-testid={`xp-group-${g.code}`}
                  >
                    {t("xp.subtotal", { amount: money(g.totalPaise) })}
                  </span>
                }
              >
                <ul className="flex flex-col gap-2.5">
                  {g.rows.map((r, i) => (
                    <li key={r.doc._id}>
                      <ExpenseCard r={r} index={i} />
                    </li>
                  ))}
                </ul>
              </Panel>
            ))
          )}
          <Panel
            title={t("xp.farmerBlock")}
            action={
              data.farmerPaidPaise > 0n ? (
                <span className="tabular text-sm font-semibold">{money(data.farmerPaidPaise)}</span>
              ) : null
            }
          >
            <p className="text-muted-foreground mb-2 text-xs">{t("xp.farmerNote")}</p>
            {data.farmerPayments.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("xp.noFarmerPayments")}</p>
            ) : (
              <ul className="flex flex-col gap-2.5" data-testid="xp-farmer-payments">
                {data.farmerPayments.map((f, i) => (
                  <li key={f.payment._id}>
                    <TxnCard
                      index={i}
                      icon={Wheat}
                      tone="gold"
                      title={f.party?.name ?? ""}
                      subtitle={t(`pay.${f.payment.mode}` as TKey)}
                      date={date(f.payment.paymentDate, "short")}
                      amountPaise={BigInt(f.payment.amountPaise)}
                      direction="OUT"
                      href={`/print/payment?id=${f.payment._id}`}
                      extra={
                        <span className="bg-gold-100 text-accent-foreground rounded-full px-2 text-[11px]">
                          {t("xp.paymentBadge")}
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

export function AllExpenses() {
  const { t, money } = useI18n();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const [q, setQ] = useState("");
  const [by, setBy] = useState<"EXPENSE" | "PAYMENT">("EXPENSE");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState<PayStatus | "ALL">("ALL");
  const [manage, setManage] = useState(false);
  const dq = useDeferredValue(q);
  const filter: ExpenseFilter = {
    q: dq,
    by,
    status,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(cat ? { categoryCode: cat } : {}),
  };
  const rows = useLiveQuery(
    () => (godownId ? expenseRows(godownId, filter) : []),
    [godownId, dq, by, from, to, cat, status],
  );
  const cats = useLiveQuery(() => (godownId ? categoryList(godownId) : []), [godownId]);
  const totals = rows ? expenseTotals(rows) : null;
  const chip = (on: boolean) =>
    cn(
      "press min-h-10 shrink-0 rounded-full border px-4 text-sm",
      on ? "bg-primary text-primary-foreground border-primary" : "bg-card",
    );
  return (
    <div className="flex flex-col gap-3">
      <SearchBox value={q} onChange={setQ} placeholder={t("xp.search")} testId="expense-search" />
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {(["ALL", "UNPAID", "PARTIAL", "PAID", "OVERDUE"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={chip(status === s)}
          >
            {s === "ALL" ? t("pur.filterAll") : t(`ui.status.${s}` as TKey)}
          </button>
        ))}
      </div>
      <div className="-mx-3 flex flex-wrap gap-2 px-3 sm:mx-0 sm:px-0">
        <label className="bg-card flex min-h-10 items-center gap-1 rounded-full border px-3 text-sm">
          {t("xp.byDate")}
          <select
            className="bg-transparent"
            value={by}
            onChange={(e) => setBy(e.target.value as "EXPENSE" | "PAYMENT")}
            data-testid="expense-by"
          >
            <option value="EXPENSE">{t("xp.byExpense")}</option>
            <option value="PAYMENT">{t("xp.byPayment")}</option>
          </select>
        </label>
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
        <select
          className="bg-card min-h-10 rounded-full border px-3 text-sm"
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          aria-label={t("xp.category")}
          data-testid="expense-cat-filter"
        >
          <option value="">{t("xp.allCategories")}</option>
          {(cats ?? [])
            .filter((c) => c.code !== "FARMER_PAYMENT")
            .map((c) => (
              <option key={c._id} value={c.code}>
                {categoryName(c, t)}
              </option>
            ))}
        </select>
        {readOnly ? null : (
          <Button
            variant="outline"
            className="h-10 rounded-full"
            onClick={() => setManage(true)}
            data-testid="expense-categories"
          >
            <Settings2 className="size-4" aria-hidden />
            {t("xp.categories")}
          </Button>
        )}
      </div>
      {totals && totals.count > 0 ? (
        <div
          className="bg-forest-100/60 text-forest grid grid-cols-3 gap-2 rounded-2xl p-3 text-center text-sm"
          data-testid="expense-totals"
        >
          <span>{t("xp.count", { count: totals.count })}</span>
          <span className="tabular font-semibold">{money(totals.amountPaise)}</span>
          <span className="tabular text-red-800">
            {t("xp.due", { amount: money(totals.duePaise) })}
          </span>
        </div>
      ) : null}
      {rows === undefined ? (
        <Skeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t("xp.emptyAll")}
          action={
            readOnly ? undefined : (
              <Button asChild className="h-12">
                <Link href="/expenses/new">{t("quick.expense")}</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="expense-list">
          {rows.map((r, i) => (
            <li key={r.doc._id}>
              <ExpenseCard r={r} index={i} />
            </li>
          ))}
        </ul>
      )}
      {manage && godownId ? (
        <CategoryManager godownId={godownId} onClose={() => setManage(false)} />
      ) : null}
    </div>
  );
}

export function UnpaidExpenses() {
  const { t, money } = useI18n();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const rows = useLiveQuery(() => (godownId ? unpaidExpenses(godownId) : []), [godownId]);
  const [paying, setPaying] = useState<ExpenseRow | null>(null);
  const total = (rows ?? []).reduce((s, r) => s + r.state.duePaise, 0n);
  return (
    <div className="flex flex-col gap-3">
      {rows && rows.length > 0 ? (
        <div className="flex items-center justify-between rounded-2xl bg-red-50 p-3">
          <span className="text-sm text-red-900">{t("xp.totalUnpaid")}</span>
          <span
            className="tabular text-xl font-semibold text-red-800"
            data-testid="expense-unpaid-total"
          >
            {money(total)}
          </span>
        </div>
      ) : null}
      {rows === undefined ? (
        <Skeleton rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Receipt} title={t("xp.emptyUnpaid")} />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="expense-unpaid">
          {rows.map((r, i) => (
            <li key={r.doc._id} className="flex flex-col gap-1.5">
              <ExpenseCard r={r} index={i} />
              {readOnly ? null : (
                <Button
                  className="h-11 self-end"
                  onClick={() => setPaying(r)}
                  data-testid="expense-pay-now"
                >
                  {t("xp.pay")} · {money(r.state.duePaise)}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {paying && godownId ? (
        <AddPaymentSheet
          open
          onOpenChange={(o) => !o && setPaying(null)}
          godownId={godownId}
          source={paying.doc}
          duePaise={paying.state.duePaise}
          direction="OUT"
        />
      ) : null}
    </div>
  );
}

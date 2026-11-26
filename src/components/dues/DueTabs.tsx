"use client";

/**
 * Due & Advance tabs (requirement_v2 §12.6): সারাংশ (totals per category, aging, top dues, pay /
 * collect), পাওনা / দেনা / মিলের দেনা / অগ্রিম / অন্যান্য (party rows: mobile, last date, opening,
 * total, paid, remaining, earliest due / overdue, WhatsApp, call) and রিমাইন্ডার (overdue / today /
 * upcoming; done, snooze, change date; manual reminders).
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CalendarClock,
  Factory,
  HandCoins,
  Phone,
  PieChart,
  Scale,
  Users,
} from "lucide-react";
import { Donut } from "@/components/charts/Donut";
import { DateField, FieldBox, PartyPicker } from "@/components/entry/Fields";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { EmptyState, MetricCard, Panel, Skeleton, TxnCard } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { AmountInput } from "@/components/money/inputs";
import { SearchBox } from "@/components/sales/SalesTabs";
import { lazyToast } from "@/components/system/IdleToaster";
import { useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import {
  DUE_CATEGORIES,
  dueSummary,
  isMillRefundDue,
  partyDues,
  reminderRows,
  reminderWhen,
  type DueCategory,
  type PartyDue,
  type ReminderRow,
  type ReminderWhen,
} from "@/client/queries/dues";
import { createManualReminder, setReminderState } from "@/client/repo";
import { parseAmountField } from "@/client/ui/parse";
import { AGING_BUCKETS } from "@/domain/aging";
import { addDays, todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

const abs = (v: bigint) => (v < 0n ? -v : v);

/** The prepared WhatsApp text for a party's balance (collect vs pay template). */
export function useDueWhatsApp() {
  const { t, money, date } = useI18n();
  const business = useBusiness();
  const { godown } = useActiveGodown();
  return (name: string, balance: bigint, dueDate?: string) => {
    const base = {
      name,
      business: business?.name ?? "",
      gola: godown?.name ?? "",
      amount: money(abs(balance)),
      dueDate: dueDate ? date(dueDate, "short") : "",
    };
    if (balance > 0n) return t(dueDate ? "wa.collect" : "wa.collectNoDate", base);
    if (balance < 0n) return t(dueDate ? "wa.pay" : "wa.payNoDate", base);
    return "";
  };
}

function DueRow({ r, index }: { r: PartyDue; index: number }) {
  const { t, money, date, count } = useI18n();
  const wa = useDueWhatsApp();
  return (
    <div className="flex flex-col gap-1.5" data-testid="due-row" data-party={r.party.name}>
      <TxnCard
        index={index}
        icon={Scale}
        tone={r.balancePaise > 0n ? "in" : "out"}
        title={r.party.name}
        subtitle={
          r.earliestDue
            ? r.overdueDays > 0
              ? t("dues.overdueDays", { days: count(r.overdueDays) })
              : t("dues.dueOn", { date: date(r.earliestDue, "short") })
            : isMillRefundDue(r.party.roles, r.balancePaise)
              ? t("mill.refundDue")
              : t(`dues.cat.${r.category}` as TKey)
        }
        {...(r.lastDate ? { date: t("mill.last", { date: date(r.lastDate, "short") }) } : {})}
        amountPaise={abs(r.balancePaise)}
        direction={r.balancePaise > 0n ? "IN" : "OUT"}
        {...(r.overdueDays > 0 ? { status: "OVERDUE" as const } : {})}
        href={`/dues/party?id=${r.party._id}`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-muted-foreground tabular text-xs">
          {r.openingPaise !== 0n ? `${t("dues.opening")} ${money(abs(r.openingPaise))} · ` : ""}
          {t("dues.billLine", { total: money(r.totalPaise), paid: money(r.paidPaise) })}
        </span>
        <span className="flex gap-1.5">
          {r.party.phone ? (
            <Button asChild variant="outline" size="icon" className="size-10">
              <a href={`tel:${r.party.phone}`} aria-label={t("dues.call")}>
                <Phone className="size-4" aria-hidden />
              </a>
            </Button>
          ) : null}
          <WhatsAppButton
            phone={r.party.phone}
            text={wa(r.party.name, r.balancePaise, r.earliestDue)}
            className="h-10"
          />
        </span>
      </div>
    </div>
  );
}

export function DueCategoryList({ category }: { category: DueCategory }) {
  const { t, money } = useI18n();
  const { godownId } = useActiveGodown();
  const [q, setQ] = useState("");
  const rows = useLiveQuery(
    () =>
      godownId ? partyDues(godownId).then((r) => r.filter((x) => x.category === category)) : [],
    [godownId, category],
  );
  const shown = (rows ?? []).filter(
    (r) =>
      !q.trim() ||
      `${r.party.name} ${r.party.phone ?? ""} ${r.party.searchKey}`
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );
  const total = (rows ?? []).reduce((s, r) => s + abs(r.balancePaise), 0n);
  return (
    <div className="flex flex-col gap-3">
      <PayButtons />
      <SearchBox value={q} onChange={setQ} placeholder={t("common.search")} />
      {rows && rows.length ? (
        <p
          className="bg-forest-100/60 text-forest tabular rounded-2xl p-3 text-center text-sm"
          data-testid="due-cat-total"
          data-paise={total.toString()}
        >
          {t("dues.catTotal", { count: rows.length, amount: money(total) })}
        </p>
      ) : null}
      {rows === undefined ? (
        <Skeleton rows={4} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Scale} title={t("dues.empty")} />
      ) : (
        <ul className="flex flex-col gap-3" data-testid={`due-list-${category}`}>
          {shown.map((r, i) => (
            <li key={r.party._id}>
              <DueRow r={r} index={i} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PayButtons() {
  const { t } = useI18n();
  const { readOnly } = useWriteGodown();
  if (readOnly) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button asChild variant="outline" className="h-12">
        <Link href="/dues/pay?direction=OUT" data-testid="due-pay-out">
          <ArrowUpRight className="size-5" aria-hidden />
          {t("quick.paid")}
        </Link>
      </Button>
      <Button asChild variant="outline" className="h-12">
        <Link href="/dues/pay?direction=IN" data-testid="due-pay-in">
          <ArrowDownLeft className="size-5" aria-hidden />
          {t("quick.received")}
        </Link>
      </Button>
    </div>
  );
}

const CAT_ICON = {
  receivable: ArrowDownLeft,
  payable: ArrowUpRight,
  mill: Factory,
  advance: HandCoins,
  other: Scale,
} as const;
const CAT_TONE = {
  receivable: "in",
  payable: "out",
  // Mills owe us (v2.1): an incoming (green) tone.
  mill: "in",
  advance: "blue",
  other: "violet",
} as const;

export function DueSummaryTab() {
  const { t, money, count } = useI18n();
  const { godownId } = useActiveGodown();
  const rows = useLiveQuery(() => (godownId ? partyDues(godownId) : []), [godownId]);
  if (rows === undefined) return <Skeleton rows={4} />;
  const s = dueSummary(rows);
  const tabOf: Record<DueCategory, string> = {
    receivable: "receivable",
    payable: "payable",
    mill: "mill",
    advance: "advance",
    other: "other",
  };
  return (
    <div className="flex flex-col gap-4" data-testid="due-summary">
      <PayButtons />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {DUE_CATEGORIES.map((c) => (
          <MetricCard
            key={c}
            icon={CAT_ICON[c]}
            tone={CAT_TONE[c]}
            label={t(`dues.cat.${c}` as TKey)}
            value={{ kind: "money", paise: s.totals[c] }}
            sub={t("dues.parties", { count: count(s.counts[c]) })}
            href={`/dues?tab=${tabOf[c]}`}
            testId={`due-total-${c}`}
          />
        ))}
      </div>
      {DUE_CATEGORIES.some((c) => s.totals[c] > 0n) ? (
        <Panel title={t("viz.duesMix")} icon={PieChart} tone="violet">
          <Donut
            testId="due-donut"
            centerLabel={t("viz.total")}
            total={money(DUE_CATEGORIES.reduce((a, c) => a + s.totals[c], 0n))}
            items={DUE_CATEGORIES.map((c, i) => ({
              key: c,
              label: t(`dues.cat.${c}` as TKey),
              value: s.totals[c],
              display: money(s.totals[c]),
              color: `var(--chart-${i + 1})`,
            }))}
          />
        </Panel>
      ) : null}
      <Panel title={t("dues.aging")} icon={CalendarClock} tone="warn">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm" data-testid="due-aging">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="py-2 text-left font-normal" />
                {AGING_BUCKETS.map((b) => (
                  <th key={b} className="py-2 text-right font-normal">
                    {t(`dues.age.${b}` as TKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(["collect", "pay"] as const).map((side) => (
                <tr key={side}>
                  <td className="py-2">{t(`dues.side.${side}` as TKey)}</td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b} className="tabular py-2 text-right">
                      {money(s.aging[side][b])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={t("dues.top")} icon={Users} tone="blue">
        {s.top.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("dues.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {s.top.map((r, i) => (
              <li key={r.party._id}>
                <DueRow r={r} index={i} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ── Reminders ────────────────────────────────────────────────────────────────────────────────

const WHEN: readonly ReminderWhen[] = ["overdue", "today", "upcoming", "later", "done"];

function ReminderItem({ r }: { r: ReminderRow }) {
  const { t, money, date } = useI18n();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const wa = useDueWhatsApp();
  const [editing, setEditing] = useState(false);
  const [newDate, setNewDate] = useState(r.dueDate);
  const input = {
    ...(r.auto && r.source ? { source: r.source } : { reminderId: r.id }),
    kind: r.kind,
    ...(r.party ? { partyId: r.party._id } : {}),
    dueDate: r.dueDate,
    ...(r.amountPaise !== undefined ? { amountPaise: r.amountPaise.toString() } : {}),
    title: r.title,
  };
  const act = async (
    status: ReminderRow["status"],
    patch: Partial<typeof input> = {},
    until?: string,
  ) => {
    if (!godownId) return;
    try {
      await setReminderState(godownId, { ...input, ...patch }, status, until);
    } catch (e) {
      lazyToast(t(errorKey(e)), "error");
    }
  };
  const title =
    r.title ||
    `${t(r.kind === "COLLECT" ? "dues.collectFrom" : "dues.payTo", { name: r.party?.name ?? "" })}${r.doc ? ` · ${r.doc.number}` : ""}`;
  return (
    <li
      className="bg-card shadow-card flex flex-col gap-2 rounded-2xl border p-3"
      data-testid="reminder-row"
      data-status={r.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-medium">{title}</span>
          <span className="text-muted-foreground text-xs">{date(r.dueDate, "short")}</span>
        </div>
        {r.amountPaise !== undefined ? (
          <span
            className={cn(
              "tabular font-semibold",
              r.kind === "COLLECT" ? "text-money-in" : "text-money-out",
            )}
          >
            {money(r.amountPaise)}
          </span>
        ) : null}
      </div>
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          {r.status === "done" ? (
            <Button variant="outline" className="h-10" onClick={() => void act("open")}>
              {t("dues.reopen")}
            </Button>
          ) : (
            <>
              <Button className="h-10" onClick={() => void act("done")} data-testid="reminder-done">
                {t("dues.done")}
              </Button>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => void act("snoozed", {}, addDays(todayIST(), 3))}
                data-testid="reminder-snooze"
              >
                {t("dues.snooze")}
              </Button>
              <Button variant="outline" className="h-10" onClick={() => setEditing((x) => !x)}>
                {t("dues.changeDate")}
              </Button>
            </>
          )}
          {r.party ? (
            <WhatsAppButton
              phone={r.party.phone}
              text={wa(
                r.party.name,
                (r.kind === "PAY" ? -1n : 1n) * (r.amountPaise ?? 0n),
                r.dueDate,
              )}
              className="h-10"
            />
          ) : null}
        </div>
      )}
      {editing ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <DateField
              label={t("dues.newDate")}
              value={newDate}
              onChange={setNewDate}
              allowFuture
            />
          </div>
          <Button
            className="h-12"
            onClick={async () => {
              await act("open", { dueDate: newDate });
              setEditing(false);
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function NewReminderSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { godownId } = useActiveGodown();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(todayIST());
  const [partyId, setPartyId] = useState<string | undefined>();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!godownId) return null;
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={t("dues.newReminder")}>
      <FieldBox label={t("dues.reminderTitle")}>
        <Input
          className="h-12 text-base"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="reminder-title"
        />
      </FieldBox>
      <DateField label={t("dues.newDate")} value={dueDate} onChange={setDueDate} allowFuture />
      <PartyPicker
        godownId={godownId}
        roles={[
          "FARMER",
          "SUPPLIER",
          "CUSTOMER",
          "MILL",
          "SECOND_PARTY",
          "VEHICLE_CUSTOMER",
          "DRIVER",
          "LABOUR",
          "OTHER",
        ]}
        createRole="OTHER"
        value={partyId}
        onChange={setPartyId}
        label={t("mill.spParty")}
        testId="reminder-party"
      />
      <AmountInput label={t("pay.amount")} value={amount} onChange={setAmount} allowZero />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button
        className="h-12 text-base"
        data-testid="reminder-save"
        onClick={async () => {
          if (!title.trim()) return setError(t("acct.required"));
          const a = parseAmountField(amount, false, 0n).value;
          try {
            await createManualReminder(godownId, {
              title: title.trim(),
              dueDate,
              ...(partyId ? { partyId } : {}),
              ...(a && a > 0n ? { amountPaise: a.toString() } : {}),
            });
            onClose();
          } catch (e) {
            setError(t(errorKey(e)));
          }
        }}
      >
        {t("common.save")}
      </Button>
    </BottomSheet>
  );
}

export function RemindersTab() {
  const { t, count } = useI18n();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const rows = useLiveQuery(() => (godownId ? reminderRows(godownId) : []), [godownId]);
  if (rows === undefined) return <Skeleton rows={3} />;
  const groups = new Map<ReminderWhen, ReminderRow[]>();
  for (const r of rows) {
    const w = reminderWhen(r);
    groups.set(w, [...(groups.get(w) ?? []), r]);
  }
  return (
    <div className="flex flex-col gap-4" data-testid="reminders">
      {readOnly ? null : (
        <Button
          className="h-12 self-start"
          onClick={() => setAdding(true)}
          data-testid="reminder-new"
        >
          <Bell className="size-5" aria-hidden />
          {t("dues.newReminder")}
        </Button>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={Bell} title={t("dues.noReminders")} />
      ) : (
        WHEN.filter((w) => w !== "done" || showDone).map((w) =>
          groups.get(w)?.length ? (
            <section key={w} className="flex flex-col gap-2" data-testid={`reminders-${w}`}>
              <h2 className="text-[15px] font-semibold">
                {t(`dues.when.${w}` as TKey)} · {count(groups.get(w)!.length)}
              </h2>
              <ul className="flex flex-col gap-2">
                {groups.get(w)!.map((r) => (
                  <ReminderItem key={r.id} r={r} />
                ))}
              </ul>
            </section>
          ) : null,
        )
      )}
      {groups.get("done")?.length ? (
        <Button variant="ghost" className="h-11 self-start" onClick={() => setShowDone((x) => !x)}>
          {showDone
            ? t("dues.hideDone")
            : t("dues.showDone", { count: count(groups.get("done")!.length) })}
        </Button>
      ) : null}
      {adding ? <NewReminderSheet onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

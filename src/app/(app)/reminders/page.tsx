"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Check, Clock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BottomSheet } from "@/components/forms/BottomSheet";
import { DateField, TextField } from "@/components/forms/fields";
import { PartyPicker } from "@/components/forms/pickers";
import { AmountInput } from "@/components/money/inputs";
import { EmptyState, Loading } from "@/components/lists/common";
import { Money } from "@/components/money/display";
import { PageHeader, PageSuspense, ReadOnlyNotice } from "@/components/system/page";
import { PushToggle } from "@/components/pwa/PushToggle";
import { useNames } from "@/components/vouchers/names";
import { viewPathOf } from "@/components/vouchers/VoucherView";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useGodownRole } from "@/client/hooks";
import {
  createManualReminder,
  effectiveDue,
  pendingReminders,
  setReminderState,
} from "@/client/repo";
import { parseAmountField } from "@/client/ui/parse";
import { dot } from "@/client/ui/text";
import { addDays, todayIST } from "@/domain/dates";
import type { Reminder, Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

function ReminderCard({
  r,
  voucher,
  partyName,
  writable,
}: {
  r: Reminder;
  voucher: Voucher | undefined;
  partyName: string;
  writable: boolean;
}) {
  const { t, date } = useI18n();
  const [pick, setPick] = useState(false);
  const [pickDate, setPickDate] = useState(addDays(todayIST(), 7));
  const today = todayIST();
  const due = effectiveDue(r);
  const act = async (next: Parameters<typeof setReminderState>[2], msg: TKey) => {
    try {
      await setReminderState(r.godownId, r._id, next);
      toast.success(t(msg));
      setPick(false);
    } catch (e) {
      toast.error(t(errorKey(e)));
    }
  };
  return (
    <Card data-testid="reminder-card">
      <CardContent className="flex flex-col gap-2 pt-4 text-sm">
        <div className="flex justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">
              {r.title || partyName || t(`reminder.kind.${r.kind}` as TKey)}
            </span>
            <span className="text-muted-foreground text-xs">
              {dot(
                t(`reminder.kind.${r.kind}` as TKey),
                r.title ? partyName : null,
                voucher ? voucher.number : null,
              )}
            </span>
            <span className={`text-xs ${due < today ? "text-destructive font-semibold" : ""}`}>
              {r.status === "snoozed" && r.snoozeUntil
                ? t("reminder.snoozedUntil", { date: date(r.snoozeUntil, "short") })
                : date(due, "short")}
            </span>
          </div>
          {r.amountPaise ? (
            <Money paise={BigInt(r.amountPaise)} className="shrink-0 font-semibold" />
          ) : null}
        </div>
        {voucher ? (
          <Link href={viewPathOf(voucher)} className="text-primary text-xs underline">
            {voucher.number}
          </Link>
        ) : null}
        {writable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-11"
              onClick={() => void act({ done: true }, "reminder.markedDone")}
              data-testid="reminder-done"
            >
              <Check className="size-4" aria-hidden />
              {t("reminder.done")}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => void act({ snoozeUntil: addDays(today, 1) }, "reminder.snoozed")}
              data-testid="reminder-snooze1"
            >
              <Clock className="size-4" aria-hidden />
              {t("reminder.snooze1")}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => void act({ snoozeUntil: addDays(today, 3) }, "reminder.snoozed")}
            >
              {t("reminder.snooze3")}
            </Button>
            <Button variant="ghost" className="h-11" onClick={() => setPick((x) => !x)}>
              {t("reminder.snoozePick")}
            </Button>
          </div>
        ) : null}
        {pick ? (
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <DateField
                label={t("reminder.when")}
                value={pickDate}
                min={addDays(today, 1)}
                onChange={setPickDate}
              />
            </div>
            <Button
              className="h-12"
              disabled={!pickDate}
              onClick={() => void act({ snoozeUntil: pickDate }, "reminder.snoozed")}
            >
              {t("common.save")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NewReminder({ godownId, onClose }: { godownId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(addDays(todayIST(), 1));
  const [partyId, setPartyId] = useState<string | undefined>();
  const [amount, setAmount] = useState("");
  const amt = parseAmountField(amount);
  const save = async () => {
    try {
      await createManualReminder(godownId, {
        title,
        dueDate: due,
        ...(partyId ? { partyId } : {}),
        ...(amt.value ? { amountPaise: amt.value.toString() } : {}),
      });
      toast.success(t("common.saved"));
      onClose();
    } catch (e) {
      toast.error(t(errorKey(e)));
    }
  };
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={t("reminder.add")}>
      <TextField
        label={t("reminder.what")}
        value={title}
        onChange={setTitle}
        required
        maxLength={200}
        testId="reminder-title"
      />
      <DateField label={t("reminder.when")} value={due} min={todayIST()} onChange={setDue} />
      <PartyPicker
        godownId={godownId}
        label={t("reminder.partyOptional")}
        value={partyId}
        onChange={setPartyId}
        allowClear
      />
      <AmountInput label={t("reminder.amountOptional")} value={amount} onChange={setAmount} />
      <Button
        className="h-12"
        disabled={!title.trim() || !due || !!amt.error}
        onClick={() => void save()}
        data-testid="reminder-save"
      >
        {t("common.save")}
      </Button>
    </BottomSheet>
  );
}

function Inner() {
  const { t, count } = useI18n();
  const { godownId, consolidated, godown } = useActiveGodown();
  const role = useGodownRole();
  const names = useNames(godownId);
  const [adding, setAdding] = useState(false);
  const data = useLiveQuery(async () => {
    if (!godownId) return null;
    const list = await pendingReminders(godownId);
    const vs = await db().vouchers.bulkGet(list.map((r) => r.voucherId ?? ""));
    return list.map((r, i) => ({ r, v: vs[i] ?? undefined }));
  }, [godownId]);
  if (consolidated) return <ReadOnlyNotice reason="consolidated" />;
  if (!godownId || !data || !names) return <Loading />;
  const writable = role !== null && role !== "viewer" && godown?.status === "active";
  const today = todayIST();
  const groups = {
    today: data.filter((x) => effectiveDue(x.r) === today),
    overdue: data.filter((x) => effectiveDue(x.r) < today),
    upcoming: data.filter((x) => effectiveDue(x.r) > today),
  };
  const list = (items: typeof data) =>
    items.length === 0 ? (
      <EmptyState text={t("reminder.empty")} />
    ) : (
      <div className="flex flex-col gap-2 pt-2">
        {items.map(({ r, v }) => (
          <ReminderCard
            key={r._id}
            r={r}
            voucher={v}
            partyName={names.party(r.partyId)}
            writable={writable}
          />
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("reminder.title")}
        actions={
          writable ? (
            <Button className="h-11" onClick={() => setAdding(true)} data-testid="reminder-add">
              <Plus className="size-4" aria-hidden />
              {t("reminder.add")}
            </Button>
          ) : null
        }
      />
      <PushToggle />
      <Tabs defaultValue={groups.overdue.length && !groups.today.length ? "overdue" : "today"}>
        <TabsList className="w-full">
          <TabsTrigger value="today" className="min-h-11 flex-1" data-testid="reminders-today">
            {dot(t("reminder.tabToday"), count(groups.today.length))}
          </TabsTrigger>
          <TabsTrigger value="overdue" className="min-h-11 flex-1" data-testid="reminders-overdue">
            {dot(t("reminder.tabOverdue"), count(groups.overdue.length))}
          </TabsTrigger>
          <TabsTrigger
            value="upcoming"
            className="min-h-11 flex-1"
            data-testid="reminders-upcoming"
          >
            {dot(t("reminder.tabUpcoming"), count(groups.upcoming.length))}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="today">{list(groups.today)}</TabsContent>
        <TabsContent value="overdue">{list(groups.overdue)}</TabsContent>
        <TabsContent value="upcoming">{list(groups.upcoming)}</TabsContent>
      </Tabs>
      {adding ? <NewReminder godownId={godownId} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

/** Reminder centre (spec §9.13): Today / Overdue / Upcoming, done, snooze, manual reminders. */
export default function RemindersPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

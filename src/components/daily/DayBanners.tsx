"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { AlertTriangle, ArrowRightLeft, Bell, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { getMeta, setMeta } from "@/client/db/meta";
import { useActiveGodown, useGodownRole, useGodownSettings } from "@/client/hooks";
import { useDueReminderCount } from "@/components/layout/ReminderBadge";
import { addDays, todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

const ackKey = (godownId: string, date: string) => `lateAck:${godownId}:${date}`;

/**
 * Per-godown day banners (spec §9.10, §9.11):
 *  - "previous day not closed" when the godown has `dayCloseRequired` on;
 *  - owner: "an entry arrived after the day was closed" (server late-entry flag);
 *  - pending inter-godown receipts waiting for this godown.
 */
const REMINDER_BANNER_KEY = "dk.reminderBannerDismissed";

export function DayBanners() {
  const dueCount = useDueReminderCount();
  const [hideRem, setHideRem] = useState(
    () =>
      typeof sessionStorage !== "undefined" && sessionStorage.getItem(REMINDER_BANNER_KEY) === "1",
  );
  const { t, date } = useI18n();
  const { godownId, consolidated } = useActiveGodown();
  const role = useGodownRole();
  const settings = useGodownSettings(godownId);
  const today = todayIST();
  const prev = addDays(today, -1);
  const data = useLiveQuery(async () => {
    if (!godownId || consolidated) return null;
    const d = db();
    const [prevStatus, prevCount, late, pending] = await Promise.all([
      d.dayStatus.get(`${godownId}:${prev}`),
      d.vouchers
        .where("[godownId+date]")
        .equals([godownId, prev])
        .filter((v) => v.status === "active")
        .count(),
      d.dayStatus
        .where("[godownId+date]")
        .between([godownId, ""], [godownId, "￿"], true, true)
        .filter((s) => s.lateEntry === true && s.closed)
        .toArray(),
      d.transfers.where("[godownId+status]").equals([godownId, "pending"]).count(),
    ]);
    const unacked: string[] = [];
    for (const s of late) {
      if (!(await getMeta<boolean>(ackKey(godownId, s.date)))) unacked.push(s.date);
    }
    return { prevClosed: prevStatus?.closed === true, prevCount, late: unacked, pending };
  }, [godownId, consolidated, prev]);
  if (!godownId || !data) return null;
  const writer = role === "owner" || role === "manager";
  const showRequired =
    !!settings?.dayCloseRequired && writer && !data.prevClosed && data.prevCount > 0;

  return (
    <>
      {dueCount > 0 && !hideRem && role !== "entry" ? (
        <div
          className="bg-primary/10 flex flex-wrap items-center gap-2 rounded-md p-2 text-sm"
          data-testid="banner-reminders"
        >
          <Bell className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{t("reminder.banner", { count: dueCount })}</span>
          <Button asChild size="sm" className="h-11">
            <Link href="/reminders">{t("reminder.open")}</Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-11"
            onClick={() => {
              sessionStorage.setItem(REMINDER_BANNER_KEY, "1");
              setHideRem(true);
            }}
          >
            {t("reminder.dismiss")}
          </Button>
        </div>
      ) : null}
      {showRequired ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          data-testid="banner-day-close-required"
        >
          <CalendarCheck className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{t("dayClose.required", { date: date(prev, "short") })}</span>
          <Button asChild size="sm" className="h-11">
            <Link href={`/day-close?date=${prev}`}>{t("dayClose.closeNow")}</Link>
          </Button>
        </div>
      ) : null}
      {role === "owner"
        ? data.late.map((d) => (
            <div
              key={d}
              className="text-destructive flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
              data-testid="banner-late-entry"
            >
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">{t("dayClose.lateEntry", { date: date(d, "short") })}</span>
              <Button asChild size="sm" variant="outline" className="h-11">
                <Link href={`/day-close?date=${d}`}>{t("dayClose.recheck")}</Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-11"
                onClick={() => void setMeta(ackKey(godownId, d), true)}
              >
                {t("dayClose.ack")}
              </Button>
            </div>
          ))
        : null}
      {data.pending > 0 && role !== "entry" ? (
        <Link
          href="/stock#pending"
          className="bg-primary/10 flex min-h-11 items-center gap-2 rounded-md p-2 text-sm"
          data-testid="banner-pending-receipts"
        >
          <ArrowRightLeft className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{t("dash.pendingReceipts", { count: data.pending })}</span>
        </Link>
      ) : null}
    </>
  );
}

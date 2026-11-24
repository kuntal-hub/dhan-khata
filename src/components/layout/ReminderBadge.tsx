"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveGodown } from "@/client/hooks";
import { effectiveDue, pendingReminders } from "@/client/queries/reminders";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

/** Count of reminders due today or overdue in the active godown (works offline). */
export function useDueReminderCount(): number {
  const { godownId, consolidated } = useActiveGodown();
  const today = todayIST();
  return (
    useLiveQuery(async () => {
      if (!godownId || consolidated) return 0;
      return (await pendingReminders(godownId)).filter((r) => effectiveDue(r) <= today).length;
    }, [godownId, consolidated, today]) ?? 0
  );
}

/** Header bell with the in-app badge (spec §9.13). */
export function ReminderBadge() {
  const { t, count } = useI18n();
  const n = useDueReminderCount();
  return (
    <Button variant="ghost" size="icon" className="relative size-11" asChild>
      <Link
        href="/reminders"
        aria-label={n > 0 ? t("reminder.badge", { count: n }) : t("reminder.title")}
        data-testid="header-reminders"
        data-count={n}
      >
        <Bell className="size-5" aria-hidden />
        {n > 0 ? (
          <span className="bg-destructive text-destructive-foreground absolute top-1 right-1 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-bold">
            {count(Math.min(n, 99))}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

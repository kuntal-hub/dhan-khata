"use client";

/**
 * Header tools (requirement_v2 §11): global search (opens /search) and the notifications bell
 * with the number of due reminders (overdue + today, not done) for the active Gola(s); the bell
 * opens Due & Advance → রিমাইন্ডার.
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Bell, Search } from "lucide-react";
import { useActiveGodown } from "@/client/hooks";
import { reminderRows, reminderWhen } from "@/client/queries/dues";
import { useI18n } from "@/i18n/I18nProvider";

export function HeaderTools() {
  const { t, count } = useI18n();
  const { godownId, godowns, consolidated } = useActiveGodown();
  const ids = consolidated
    ? (godowns ?? []).filter((g) => g.status === "active").map((g) => g._id)
    : godownId
      ? [godownId]
      : [];
  const due = useLiveQuery(async () => {
    let n = 0;
    for (const id of ids) {
      for (const r of await reminderRows(id)) {
        const w = reminderWhen(r);
        if (w === "overdue" || w === "today") n++;
      }
    }
    return n;
  }, [ids.join(",")]);
  return (
    <>
      <Link
        href="/search"
        className="press hover:bg-muted flex size-10 items-center justify-center rounded-full sm:size-11"
        aria-label={t("search.open")}
        data-testid="header-search"
      >
        <Search className="size-5" aria-hidden />
      </Link>
      <Link
        href="/dues?tab=reminders"
        className="press hover:bg-muted relative flex size-10 items-center justify-center rounded-full sm:size-11"
        aria-label={due ? t("search.bellCount", { count: due }) : t("search.bell")}
        data-testid="header-bell"
        data-count={due ?? 0}
      >
        <Bell className="size-5" aria-hidden />
        {due ? (
          <span className="bg-destructive text-destructive-foreground tabular absolute top-1 right-1 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold">
            {count(due > 99 ? 99 : due)}
          </span>
        ) : null}
      </Link>
    </>
  );
}

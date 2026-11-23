"use client";

import Link from "next/link";
import { CloudOff, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

/** Header sync status: online/offline, pending count, problems. Tapping opens the Sync screen. */
export function SyncBadge() {
  const { t } = useI18n();
  const s = useAppSelector((st) => st.sync);
  const problems = s.errorOps + s.conflictOps;

  let icon = <RefreshCw className="size-4" aria-hidden />;
  let text = t("sync.online");
  let tone = "text-primary";
  if (problems > 0) {
    icon = <TriangleAlert className="size-4" aria-hidden />;
    text = t("sync.errorCount", { count: problems });
    tone = "text-destructive";
  } else if (s.running) {
    icon = <Loader2 className="size-4 animate-spin" aria-hidden />;
    text = t("sync.running");
  } else if (!s.online) {
    icon = <CloudOff className="size-4" aria-hidden />;
    text =
      s.pendingOps > 0
        ? `${t("sync.offline")} · ${t("sync.pendingCount", { count: s.pendingOps })}`
        : t("sync.offline");
    tone = "text-muted-foreground";
  } else if (s.pendingOps > 0) {
    text = t("sync.pendingCount", { count: s.pendingOps });
    tone = "text-amber-700 dark:text-amber-400";
  }

  return (
    <Link
      href="/sync"
      className={`flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium ${tone}`}
      aria-label={`${t("sync.title")}: ${text}`}
      data-testid="sync-badge"
    >
      {icon}
      <span className="max-w-[18vw] truncate">{text}</span>
    </Link>
  );
}

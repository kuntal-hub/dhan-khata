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
  const allGood = problems === 0 && !s.running && s.online && s.pendingOps === 0;
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
      className={`press hover:bg-foreground/[0.06] flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${tone}`}
      aria-label={`${t("sync.title")}: ${text}`}
      data-testid="sync-badge"
      data-synced={allGood ? "yes" : "no"}
    >
      {icon}
      {/* All fine → icon only on phones (room for the godown name); any state that needs
          attention keeps its text. The aria-label always carries it. */}
      <span className={`max-w-[18vw] truncate ${allGood ? "hidden sm:inline" : ""}`}>{text}</span>
    </Link>
  );
}

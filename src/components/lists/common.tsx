"use client";

import { useLiveQuery } from "dexie-react-hooks";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, Inbox, Loader2 } from "lucide-react";
import { db } from "@/client/db/dexie";
import { useI18n } from "@/i18n/I18nProvider";

/** Per-record sync state: ✓ synced / ⏳ pending / ⚠ error or conflict (spec §9, §A). */
export function SyncIcon({ entityId, serverSeq }: { entityId: string; serverSeq?: number }) {
  const { t } = useI18n();
  const status = useLiveQuery(async () => {
    const ops = await db().outbox.where("entityId").equals(entityId).toArray();
    if (ops.some((o) => o.status === "error" || o.status === "conflict")) return "error";
    if (ops.length > 0) return "pending";
    return "synced";
  }, [entityId]);
  if (status === "error") {
    return (
      <AlertTriangle
        className="text-destructive size-4 shrink-0"
        aria-label={t("voucher.syncError")}
        role="img"
      />
    );
  }
  if (status === "pending" || (status === "synced" && serverSeq === undefined)) {
    return (
      <Clock
        className="size-4 shrink-0 text-amber-600"
        aria-label={t("voucher.syncPending")}
        role="img"
      />
    );
  }
  return (
    <CheckCircle2
      className="size-4 shrink-0 text-emerald-600"
      aria-label={t("voucher.synced")}
      role="img"
    />
  );
}

/** Friendly empty state with the primary action (spec §11.6). */
export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div
      className="text-muted-foreground anim-zoom flex flex-col items-center gap-3 py-10 text-center"
      data-testid="empty-state"
    >
      <span className="relative flex size-24 items-center justify-center" aria-hidden>
        <span className="from-gold-100 absolute inset-0 rounded-full bg-linear-to-br to-emerald-100 opacity-70 dark:opacity-20" />
        <span className="anim-pop relative flex size-14 items-center justify-center rounded-[1.25rem] bg-linear-to-br from-[var(--gold-300)] to-[var(--gold-600)] text-white shadow-[0_8px_18px_-8px_rgb(183_128_10/0.8)]">
          <Inbox className="size-7" strokeWidth={1.8} />
        </span>
      </span>
      <p className="text-foreground/80 text-[15px] font-medium">{text}</p>
      {action}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="flex justify-center py-10" role="status" aria-label={t("common.loading")}>
      <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
    </div>
  );
}

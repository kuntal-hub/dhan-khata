"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useState, type ReactNode } from "react";
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
      className="text-muted-foreground flex flex-col items-center gap-3 py-10 text-center"
      data-testid="empty-state"
    >
      <Inbox className="size-10 opacity-60" aria-hidden />
      <p className="text-sm">{text}</p>
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

/** Window-scrolled virtual list (10k rows at 60 fps, spec §15). */
export function VirtualList<T>({
  items,
  estimate = 72,
  render,
  getKey,
  testId,
}: {
  items: readonly T[];
  estimate?: number;
  render: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  testId?: string;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const v = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimate,
    overscan: 8,
    scrollMargin: el?.offsetTop ?? 0,
  });
  return (
    <div ref={setEl} data-testid={testId}>
      <div style={{ height: v.getTotalSize(), position: "relative", width: "100%" }}>
        {v.getVirtualItems().map((row) => (
          <div
            key={getKey(items[row.index]!, row.index)}
            data-index={row.index}
            ref={v.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${row.start - v.options.scrollMargin}px)`,
            }}
          >
            {render(items[row.index]!, row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

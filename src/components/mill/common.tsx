"use client";

/**
 * Small pieces shared by the Mill & Second Party detail pages: a label/value cell, the "who / when
 * changed it" history panel, and the reverse button (confirmation that states the effect + reason).
 */
import { useState, type ReactNode } from "react";
import { History, Undo2 } from "lucide-react";
import { Panel } from "@/components/kit/Kit";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import type { Doc } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";

export function Cell({
  label,
  children,
  wide,
  testId,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  testId?: string;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

export function HistoryPanel({ doc }: { doc: Doc }) {
  const { t, date, count } = useI18n();
  return (
    <Panel title={t("pur.history")}>
      <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
        <li className="flex items-center gap-2">
          <History className="size-4" aria-hidden />
          {t("hist.created", { date: date(doc.entryDate, "short") })}
        </li>
        {doc.rev > 1 ? (
          <li>
            {t("hist.edited", {
              date: date(doc.updatedAt.slice(0, 10), "short"),
              rev: count(doc.rev),
            })}
          </li>
        ) : null}
        {doc.editReason ? <li>{t("hist.reason", { reason: doc.editReason })}</li> : null}
        {doc.status === "void" ? (
          <li>{t("hist.voided", { reason: doc.voidReason ?? "" })}</li>
        ) : null}
      </ul>
    </Panel>
  );
}

export function ReverseButton({
  label,
  body,
  onReverse,
  testId = "doc-reverse",
}: {
  label: string;
  body: string;
  onReverse: (reason: string) => Promise<void>;
  testId?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button
        variant="outline"
        className="text-destructive h-12"
        onClick={() => setOpen(true)}
        data-testid={testId}
      >
        <Undo2 className="size-5" aria-hidden />
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={label}
        body={body}
        confirmLabel={label}
        onConfirm={async () => {
          if (!reason.trim()) return lazyToast(t("pay.reasonRequired"), "error");
          try {
            await onReverse(reason.trim());
            lazyToast(t("mill.reversed"), "success");
            setOpen(false);
          } catch (e) {
            lazyToast(t(errorKey(e)), "error");
          }
        }}
      >
        <Input
          className="h-12 text-base"
          placeholder={t("pay.reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="reverse-reason"
        />
      </ConfirmDialog>
    </>
  );
}

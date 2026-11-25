"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sectionOf } from "@/components/shell/sections";
import { useUnsavedGuard } from "@/client/ui/hooks";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * Entry form frame (spec §9 "general rules for every entry form"): a full-screen sheet with the
 * godown name in the title ("নতুন ক্রয় · রামপুর"), scrolling body, and a sticky bottom bar with
 * live totals and the Save button. Leaving a dirty form asks first.
 */
export function FormShell({
  title,
  dirty,
  saving,
  onSubmit,
  totals,
  children,
  saveLabel,
  restoreBanner,
  testId,
  backHref,
}: {
  title: string;
  dirty: boolean;
  saving: boolean;
  onSubmit: () => void;
  totals?: ReactNode;
  children: ReactNode;
  saveLabel?: string;
  restoreBanner?: ReactNode;
  testId?: string;
  backHref?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const section = sectionOf(usePathname());
  const [confirmLeave, setConfirmLeave] = useState(false);
  useUnsavedGuard(dirty);

  const leave = () => {
    if (backHref) router.replace(backHref);
    else router.back();
  };
  const back = () => (dirty ? setConfirmLeave(true) : leave());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!saving) onSubmit();
  };

  return (
    <div
      className={`bg-background fixed inset-0 z-40 flex flex-col accent-${section?.key ?? "dashboard"}`}
      data-testid={testId}
    >
      <header className="hero flex items-center gap-2 rounded-b-[1.5rem] px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-3">
        <button
          type="button"
          className="press flex size-11 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30 hover:bg-white/30"
          onClick={back}
          aria-label={t("common.back")}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        {section ? (
          <section.icon className="size-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold drop-shadow-sm">{title}</h1>
      </header>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit} noValidate>
        <div className="anim-rise mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col gap-4 overflow-y-auto p-4 pb-8">
          {restoreBanner}
          {children}
        </div>
        <div className="glass border-t border-(--hairline) pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_-16px_rgb(20_40_30/0.35)]">
          <div className="mx-auto flex w-full max-w-md items-center gap-3 p-3">
            <div className="min-w-0 flex-1">{totals}</div>
            <Button
              type="submit"
              size="lg"
              className="h-12 min-w-28 text-base"
              disabled={saving}
              data-testid="form-save"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Check className="size-5" strokeWidth={2.5} aria-hidden />
              )}
              {saveLabel ?? t("common.save")}
            </Button>
          </div>
        </div>
      </form>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("form.leaveTitle")}</DialogTitle>
            <DialogDescription>{t("form.leaveBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setConfirmLeave(false)}>
              {t("form.keepEditing")}
            </Button>
            <Button variant="destructive" className="h-11" onClick={leave}>
              {t("form.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "Unsaved form found" banner for draft autosave (spec §11.3). */
export function RestoreDraftBanner({
  onRestore,
  onDismiss,
}: {
  onRestore: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="anim-zoom flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <span className="flex-1">{t("form.draftFound")}</span>
      <Button
        type="button"
        size="sm"
        className="h-10"
        onClick={onRestore}
        data-testid="draft-restore"
      >
        {t("form.restoreDraft")}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-10" onClick={onDismiss}>
        {t("form.discardDraft")}
      </Button>
    </div>
  );
}

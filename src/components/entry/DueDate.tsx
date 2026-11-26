"use client";

/**
 * Due dates (DECISIONS D54): only on a purchase, a mill dispatch or a sale; optional; a reminder,
 * never a rule. `DueDateField` (today or any later date, never before the deal; quick chips; ✕
 * clear; soft warning for a date already passed), `DueDatePanel` (the line "বাকির তারিখ: ১৫
 * ডিসেম্বর (আর ১৯ দিন)" + "তারিখ বদলান") and `ChangeDueDateSheet` (changes only the date: no money,
 * stock, payment or posting revision; allowed on a closed day).
 */
import { useId, useState } from "react";
import { CalendarClock } from "lucide-react";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { StatusPill } from "@/components/kit/Kit";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import { setDueDate } from "@/client/repo";
import { todayIST } from "@/domain/dates";
import type { Doc } from "@/domain/schemas";
import {
  DUE_CHIPS,
  checkDueDate,
  daysUntil,
  dealDateOf,
  dueChipDate,
  dueDateOf,
  isDueDateType,
  type DueDateDocType,
} from "@/domain/v2/dueDate";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { FieldBox } from "./Fields";

/** The field's name per deal: "বাকি দেওয়ার তারিখ" (we pay) / "টাকা পাওয়ার তারিখ" (we collect). */
export const DUE_LABEL: Record<DueDateDocType, TKey> = {
  PURCHASE: "pur.dueDate",
  SALE: "sl.dueDate",
  MILL_DISPATCH: "mill.dueDate",
};

/** "আর ১৯ দিন" / "আজ" / "৫ দিন পেরিয়ে গেছে". */
export function useDueWhen(): (due: string) => string {
  const { t, count } = useI18n();
  return (due) => {
    const n = daysUntil(due, todayIST());
    if (n === 0) return t("dueF.today");
    const abs = n < 0 ? -n : n;
    return t(n > 0 ? "dueF.left" : "dueF.ago", { count: abs, countDisplay: count(abs) });
  };
}

export function DueDateField({
  label,
  value,
  onChange,
  dealDate,
  dealType,
  testId = "due-date",
}: {
  label: string;
  /** YYYY-MM-DD, or "" for none. */
  value: string;
  onChange: (v: string) => void;
  dealDate: string;
  dealType: DueDateDocType;
  testId?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const when = useDueWhen();
  const today = todayIST();
  const check = checkDueDate(value || undefined, dealDate, today);
  const error =
    check.error === "DUE_BEFORE_DEAL"
      ? t("dueF.beforeDeal", { deal: t(`dueF.deal${dealType}` as TKey) })
      : null;
  return (
    <FieldBox
      label={`${label} (${t("dueF.optional")})`}
      htmlFor={id}
      error={error}
      hint={
        check.passed ? (
          <span className="flex items-center gap-1 text-amber-700" role="alert">
            <CalendarClock className="size-3.5" aria-hidden />
            {t("dueF.passed")}
          </span>
        ) : value ? (
          <span data-testid={`${testId}-when`}>{when(value)}</span>
        ) : (
          t("dueF.hint")
        )
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={id}
          type="date"
          className="h-12 min-w-0 flex-1 text-base"
          value={value}
          min={dealDate}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
        />
        {value ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 shrink-0"
            onClick={() => onChange("")}
            data-testid={`${testId}-clear`}
          >
            {t("dueF.clear")}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {DUE_CHIPS.map((c) => {
          const d = dueChipDate(c, today, dealDate);
          return (
            <button
              key={c}
              type="button"
              className="chip min-h-11"
              aria-pressed={value === d}
              onClick={() => onChange(d)}
              data-testid={`${testId}-${c}`}
            >
              {t(`dueF.${c}` as TKey)}
            </button>
          );
        })}
      </div>
    </FieldBox>
  );
}

/** The due date of a deal on its detail page, with "তারিখ বদলান" (or "তারিখ দিন"). */
export function DueDatePanel({
  doc,
  label,
  remainingPaise,
  writable,
}: {
  doc: Doc;
  label: string;
  /** Overdue only while something is still due. */
  remainingPaise: bigint;
  writable: boolean;
}) {
  const { t, date } = useI18n();
  const when = useDueWhen();
  const [open, setOpen] = useState(false);
  if (!isDueDateType(doc.type)) return null;
  const due = dueDateOf(doc);
  const overdue = !!due && remainingPaise > 0n && due < todayIST();
  return (
    <div
      className="bg-card shadow-card flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2"
      data-testid="due-date-panel"
    >
      <span
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-2 text-sm",
          overdue && "font-semibold text-red-700",
        )}
        data-testid="due-date-line"
        data-due={due ?? ""}
      >
        <CalendarClock className="size-4 shrink-0" aria-hidden />
        {due
          ? t("dueF.line", { label, date: date(due), when: when(due) })
          : `${label}: ${t("dueF.none")}`}
        {overdue ? <StatusPill status="OVERDUE" /> : null}
      </span>
      {writable ? (
        <Button
          variant="outline"
          className="h-11"
          onClick={() => setOpen(true)}
          data-testid="due-date-change"
        >
          {due ? t("dueF.change") : t("dueF.set")}
        </Button>
      ) : null}
      {open ? (
        <ChangeDueDateSheet
          godownId={doc.godownId}
          doc={doc}
          label={label}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Change or clear a deal's due date (a field update only). */
export function ChangeDueDateSheet({
  godownId,
  doc,
  label,
  onClose,
}: {
  godownId: string;
  doc: Doc;
  label: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(dueDateOf(doc) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dealDate = dealDateOf(doc);
  if (!dealDate || !isDueDateType(doc.type)) return null;
  const invalid = !!checkDueDate(value || undefined, dealDate, todayIST()).error;
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await setDueDate(godownId, doc._id, value || null);
      lazyToast(t(value ? "dueF.saved" : "dueF.cleared"), "success");
      onClose();
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("dueF.change")}
      description={t("dueF.sheetHint")}
      testId="due-date-sheet"
    >
      <DueDateField
        label={label}
        value={value}
        onChange={setValue}
        dealDate={dealDate}
        dealType={doc.type}
        testId="due-date-input"
      />
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        className="h-12 text-base"
        disabled={busy || invalid}
        onClick={() => void save()}
        data-testid="due-date-save"
      >
        {t("common.save")}
      </Button>
    </BottomSheet>
  );
}

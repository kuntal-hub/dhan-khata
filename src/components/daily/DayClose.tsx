"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { CheckCircle2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateField, TextField } from "@/components/forms/fields";
import { AmountInput, CountInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { Money } from "@/components/money/display";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { errorKey } from "@/client/errors";
import { useGodownRole } from "@/client/hooks";
import { dashboardData } from "@/client/queries/dashboard";
import { closeDay, unlockDay } from "@/client/repo";
import { paiseToInput, parseAmountField, parseCountField } from "@/client/ui/parse";
import { countDenominations } from "@/domain/calc/settlement";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

const NOTES = ["500", "200", "100", "50", "20", "10"] as const;

/** দিন শেষ (spec §9.10): expected vs counted cash, CASH_DIFF, per-godown day lock. */
export function DayClose({ initialDate }: { initialDate?: string }) {
  const { t, money, count } = useI18n();
  const { godownId, godown, readOnly } = useWriteGodown();
  const role = useGodownRole();
  const [date, setDate] = useState(initialDate ?? todayIST());
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [coins, setCoins] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [reason, setReason] = useState("");
  const data = useLiveQuery(
    async () => (godownId ? dashboardData(godownId, date) : null),
    [godownId, date],
  );
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || !data) return <Loading />;

  const countedVal = parseAmountField(counted, true);
  const diff =
    countedVal.value !== undefined ? countedVal.value - data.expectedClosingCashPaise : null;
  const closed = data.dayStatus?.closed === true;
  const canClose = role === "owner" || role === "manager";

  // Denomination helper total.
  const counts: Record<string, number> = {};
  let helperOk = true;
  for (const n of NOTES) {
    const r = parseCountField(notes[n] ?? "");
    if (r.error) helperOk = false;
    if (r.value) counts[n] = Number(r.value);
  }
  const coinsParsed = parseAmountField(coins);
  if (coinsParsed.error) helperOk = false;
  if (coinsParsed.value) counts.coinsPaise = Number(coinsParsed.value);
  const helperTotal = helperOk ? countDenominations(counts) : null;

  const save = async () => {
    setShowErrors(true);
    if (countedVal.value === undefined) return;
    if (diff !== null && diff !== 0n && !note.trim()) return;
    setSaving(true);
    try {
      await closeDay(godownId, {
        date,
        countedCashPaise: countedVal.value,
        ...(Object.keys(counts).length ? { denominations: counts } : {}),
        ...(note.trim() ? { notes: note.trim() } : {}),
      });
      toast.success(t("dayClose.done"));
      setCounted("");
      setNote("");
      setShowErrors(false);
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };

  const unlock = async () => {
    try {
      await unlockDay(godownId, date, reason);
      setUnlockOpen(false);
      setReason("");
      toast.success(t("dayClose.unlocked"));
    } catch (e) {
      toast.error(t(errorKey(e)));
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="day-close">
      <h1 className="text-xl font-semibold">
        {t("dayClose.title", { godown: godown?.name ?? "" })}
      </h1>
      <DateField
        label={t("common.date")}
        value={date}
        max={todayIST()}
        onChange={(d) => d && setDate(d)}
        testId="day-close-date"
      />
      <Card>
        <CardContent className="flex flex-col gap-1 pt-6 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t("dayClose.opening")}</span>
            <Money paise={data.openingCashPaise} />
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t("dayClose.cashIn")}</span>
            <Money paise={data.cashInPaise} />
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t("dayClose.cashOut")}</span>
            <Money paise={data.cashOutPaise} />
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t pt-2">
            <span className="font-medium">{t("dayClose.expected")}</span>
            <Money
              paise={data.expectedClosingCashPaise}
              className="text-2xl font-semibold"
              testId="day-close-expected"
            />
          </div>
        </CardContent>
      </Card>

      {closed ? (
        <Card data-testid="day-closed">
          <CardContent className="flex flex-col gap-3 pt-6">
            <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-5" aria-hidden />
              {t("dayClose.closedOn", {
                amount: money(BigInt(data.dayStatus?.countedCashPaise ?? "0")),
              })}
            </div>
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Lock className="size-4" aria-hidden />
              {t("dayClose.lockedNote")}
            </p>
            {role === "owner" ? (
              <Button
                variant="outline"
                className="h-11 self-start"
                onClick={() => setUnlockOpen(true)}
                data-testid="day-unlock"
              >
                {t("dayClose.unlock")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : canClose ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("dayClose.denominations")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-2">
                {NOTES.map((n) => (
                  <CountInput
                    key={n}
                    label={`₹${count(Number(n))} ×`}
                    value={notes[n] ?? ""}
                    onChange={(v) => setNotes((x) => ({ ...x, [n]: v }))}
                    testId={`denom-${n}`}
                  />
                ))}
              </div>
              <AmountInput label={t("dayClose.coins")} value={coins} onChange={setCoins} />
              <Button
                type="button"
                variant="secondary"
                className="h-11"
                disabled={helperTotal === null || helperTotal === 0n}
                onClick={() => helperTotal !== null && setCounted(paiseToInput(helperTotal))}
                data-testid="denom-use"
              >
                {helperTotal !== null
                  ? `${t("dayClose.useCount")} · ${money(helperTotal)}`
                  : t("dayClose.useCount")}
              </Button>
            </CardContent>
          </Card>
          <AmountInput
            label={t("dayClose.counted")}
            value={counted}
            onChange={setCounted}
            required
            error={showErrors ? countedVal.error : null}
            testId="day-close-counted"
          />
          {diff !== null ? (
            <p
              className={`text-base font-semibold ${diff === 0n ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
              data-testid="day-close-diff"
              data-paise={diff.toString()}
            >
              {t("dayClose.difference")}
              {": "}
              {diff === 0n
                ? t("dayClose.matched")
                : diff < 0n
                  ? t("dayClose.short", { amount: money(-diff) })
                  : t("dayClose.excess", { amount: money(diff) })}
            </p>
          ) : null}
          {diff !== null && diff !== 0n ? (
            <TextField
              label={t("dayClose.note")}
              value={note}
              onChange={setNote}
              required
              maxLength={1000}
              error={showErrors && !note.trim() ? "errors.domain.NOTE_REQUIRED" : null}
              testId="day-close-note"
            />
          ) : null}
          <Button
            className="h-12 text-base"
            disabled={saving}
            onClick={() => void save()}
            data-testid="day-close-save"
          >
            {t("dayClose.save")}
          </Button>
        </>
      ) : (
        <ReadOnlyNotice reason="viewer" />
      )}

      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("dayClose.unlock")}</DialogTitle>
          </DialogHeader>
          <TextField
            label={t("dayClose.unlockReason")}
            value={reason}
            onChange={setReason}
            required
            testId="unlock-reason"
          />
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setUnlockOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              className="h-11"
              disabled={!reason.trim()}
              onClick={() => void unlock()}
              data-testid="unlock-confirm"
            >
              {t("dayClose.unlock")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

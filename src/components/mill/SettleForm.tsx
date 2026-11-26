"use client";

/**
 * "চূড়ান্ত হিসাব / Final settlement" of a mill dispatch (requirement_v2.1 §12.8E): the weight the
 * mill accepted, its final rate, the moisture / quality cut and the date. The rest of the paddy
 * still at the mill for this dispatch is a reasoned weight shortfall. Before saving it shows the
 * value at the dispatch rate, what the mill finally pays, the difference and the new receivable.
 * It adjusts THIS dispatch's receivable: no sale is created (no double income).
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { DateField, FieldBox } from "@/components/entry/Fields";
import { varietyName } from "@/components/entry/Variety";
import {
  emptyWeight,
  parseWeightState,
  WeightBlockInput,
  type WeightState,
} from "@/components/entry/WeightBlockInput";
import { FormShell } from "@/components/forms/FormShell";
import { AmountInput, RateInput } from "@/components/money/inputs";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { VoiceText } from "@/components/voice/VoiceText";
import { errorKey } from "@/client/errors";
import { useBusiness } from "@/client/hooks";
import { dispatchRows } from "@/client/queries/mill";
import { saveMillSettlement } from "@/client/repo";
import { paiseToInput, parseAmountField, parseRateField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import type { Godown } from "@/domain/schemas";
import { formatWeightNumber, gramsToInput } from "@/domain/units";
import { settlementAmounts } from "@/domain/v2/recompute";
import { STOCK_ADJUST_REASONS_V2 } from "@/domain/v2/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

type Reason = (typeof STOCK_ADJUST_REASONS_V2)[number];

interface State {
  dispatchId?: string;
  date: string;
  weight: WeightState;
  rate: string;
  deduction: string;
  reason: Reason;
  notes: string;
}

export function FinalSettlementForm({
  godown,
  dispatchId,
}: {
  godown: Godown;
  dispatchId?: string;
}) {
  const { t, money, digits, date } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const monKg = business?.monKg ?? 40;
  const o = { digits, monKg };
  const [s, setS] = useState<State>({
    ...(dispatchId ? { dispatchId } : {}),
    date: todayIST(),
    weight: emptyWeight("MANUAL"),
    rate: "",
    deduction: "0",
    reason: "WEIGHING",
    notes: "",
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [over, setOver] = useState<{ have: bigint; need: bigint } | null>(null);
  const set = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
    setOver(null);
  };

  const dispatches = useLiveQuery(
    () => dispatchRows(godown._id, { open: true, unsettled: true }),
    [godown._id],
  );
  const chosen = dispatches?.find((r) => r.doc._id === s.dispatchId);
  // Prefill once the chosen dispatch is known (e.g. opened from the dispatch page).
  if (chosen && s.rate === "" && !dirty) {
    setS((x) => ({
      ...x,
      rate: paiseToInput(chosen.doc.ratePaisePerQtl),
      weight: {
        ...emptyWeight("MANUAL"),
        manual: gramsToInput(chosen.balance.remainingG, "QTL", monKg),
      },
    }));
  }
  const w = parseWeightState(s.weight, monKg, false);
  const rate = parseRateField(s.rate, true, 0n);
  const deduction = parseAmountField(s.deduction, false, 0n);
  const acceptedG = w.result?.netG;
  const remainingG = chosen?.balance.remainingG ?? 0n;
  const shortfallG =
    acceptedG !== undefined && acceptedG < remainingG ? remainingG - acceptedG : 0n;
  const amounts =
    chosen && acceptedG !== undefined && rate.value !== undefined && deduction.value !== undefined
      ? settlementAmounts({
          acceptedG: acceptedG.toString(),
          shortfallG: shortfallG.toString(),
          dispatchRatePaisePerQtl: chosen.doc.ratePaisePerQtl,
          finalRatePaisePerQtl: rate.value.toString(),
          deductionPaise: deduction.value.toString(),
        })
      : undefined;
  const newReceivable =
    chosen && amounts ? chosen.money.receivablePaise - amounts.adjustmentPaise : undefined;
  const qtl = (g: bigint) => formatWeightNumber(g, "QTL", o);

  const pick = (id: string) => {
    const r = dispatches?.find((x) => x.doc._id === id);
    set({
      dispatchId: id,
      ...(r
        ? {
            weight: {
              ...emptyWeight("MANUAL"),
              manual: gramsToInput(r.balance.remainingG, "QTL", monKg),
            },
            rate: paiseToInput(r.doc.ratePaisePerQtl),
          }
        : {}),
    });
  };

  const save = async (acceptOver: boolean) => {
    setShowErrors(true);
    setError(null);
    if (!chosen || acceptedG === undefined || rate.value === undefined || !amounts) {
      return setError(t("acct.required"));
    }
    if (amounts.finalValuePaise < 0n) return setError(t("errors.domain.VALIDATION_FAILED"));
    if (!acceptOver && acceptedG > remainingG) {
      setOver({ have: remainingG, need: acceptedG });
      return;
    }
    setSaving(true);
    try {
      await saveMillSettlement(godown._id, {
        dispatchId: chosen.doc._id,
        date: s.date,
        acceptedG: acceptedG.toString(),
        finalRatePaisePerQtl: rate.value.toString(),
        deductionPaise: (deduction.value ?? 0n).toString(),
        shortfallG: shortfallG.toString(),
        ...(shortfallG > 0n ? { shortfallReason: s.reason } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      });
      setDirty(false);
      lazyToast(t("mill.finalDone"), "success");
      router.replace(`/mill/dispatch/view?id=${chosen.doc._id}`);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };

  const adj = amounts?.adjustmentPaise ?? 0n;
  return (
    <FormShell
      title={t("mill.finalTitle", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save(false)}
      saveLabel={t("mill.finalSave")}
      testId="settle-form"
      backHref="/mill?tab=settlement"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t("mill.finalNewReceivable")}</span>
          <span
            className="tabular text-lg font-semibold text-emerald-700"
            data-testid="settle-total"
          >
            {newReceivable !== undefined ? money(newReceivable) : "—"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <p className="bg-gold-100 text-accent-foreground flex items-start gap-2 rounded-xl px-3 py-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("mill.finalInfo")}
        </p>
        <FieldBox
          label={t("mill.finalDispatch")}
          error={showErrors && !s.dispatchId ? t("acct.required") : null}
        >
          {dispatches && dispatches.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("mill.finalNone")}</p>
          ) : (
            <div className="flex flex-col gap-2" role="radiogroup" data-testid="settle-dispatch">
              {(dispatches ?? []).map((r) => (
                <button
                  key={r.doc._id}
                  type="button"
                  role="radio"
                  aria-checked={s.dispatchId === r.doc._id}
                  onClick={() => pick(r.doc._id)}
                  className={cn("choice min-h-12 px-3 text-left text-sm")}
                >
                  {t("mill.dispatchPick", {
                    mill: r.mill?.name ?? "",
                    date: date(r.doc.dispatchDate, "short"),
                    variety: varietyName(r.variety, t),
                    qty: qtl(r.balance.remainingG),
                  })}
                  <span className="text-muted-foreground block text-xs">
                    {r.doc.number} · {t("mill.remaining")}: {money(r.money.receivablePaise)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </FieldBox>
        <DateField
          label={t("mill.finalDate")}
          value={s.date}
          onChange={(d) => set({ date: d })}
          testId="settle-date"
        />
        <FieldBox label={t("mill.finalAccepted")} error={showErrors && w.error ? t(w.error) : null}>
          <WeightBlockInput
            value={s.weight}
            onChange={(weight) => set({ weight })}
            monKg={monKg}
            deductionsEnabled={false}
            testId="settle-weight"
          />
        </FieldBox>
        <RateInput
          label={t("mill.finalRate")}
          value={s.rate}
          onChange={(r) => set({ rate: r })}
          required
          testId="settle-rate"
        />
        <AmountInput
          label={t("mill.finalDeduction")}
          value={s.deduction}
          onChange={(v) => set({ deduction: v })}
          allowZero
          testId="settle-deduction"
        />
        {shortfallG > 0n ? (
          <div
            className="flex flex-col gap-2 rounded-2xl border p-3"
            data-testid="settle-shortfall"
          >
            <span className="text-sm">
              {t("mill.finalShortfall")}:{" "}
              <span className="tabular font-semibold">
                {qtl(shortfallG)} {t("ui.unitQtlShort")}
              </span>
            </span>
            <FieldBox label={t("mill.finalShortfallReason")}>
              <select
                className="bg-card min-h-12 rounded-xl border px-3 text-base"
                value={s.reason}
                onChange={(e) => set({ reason: e.target.value as Reason })}
                data-testid="settle-shortfall-reason"
              >
                {STOCK_ADJUST_REASONS_V2.map((r) => (
                  <option key={r} value={r}>
                    {t(`stk.reasons.${r}` as TKey)}
                  </option>
                ))}
              </select>
            </FieldBox>
          </div>
        ) : null}
        {amounts && chosen ? (
          <dl
            className="bg-card shadow-card grid grid-cols-2 gap-3 rounded-2xl border p-4 text-sm"
            data-testid="settle-preview"
          >
            <div>
              <dt className="text-muted-foreground text-xs">{t("mill.finalBilled")}</dt>
              <dd className="tabular font-medium">{money(amounts.billedPaise)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t("mill.finalValue")}</dt>
              <dd className="tabular font-medium" data-testid="settle-final-value">
                {money(amounts.finalValuePaise)}
              </dd>
            </div>
            <div className="col-span-2">
              <dd
                className={cn(
                  "tabular font-semibold",
                  adj > 0n ? "text-red-700" : adj < 0n ? "text-emerald-700" : "",
                )}
                data-testid="settle-diff"
                data-paise={adj.toString()}
              >
                {adj > 0n
                  ? t("mill.finalCut", { amount: money(adj) })
                  : adj < 0n
                    ? t("mill.finalExtra", { amount: money(-adj) })
                    : t("mill.finalSame")}
              </dd>
            </div>
            <div className="col-span-2 rounded-xl bg-emerald-50 p-3">
              <dt className="text-xs text-emerald-900">{t("mill.finalNewReceivable")}</dt>
              <dd
                className="tabular text-2xl font-semibold text-emerald-800"
                data-testid="settle-new-receivable"
              >
                {newReceivable !== undefined ? money(newReceivable) : "—"}
              </dd>
            </div>
          </dl>
        ) : null}
        <FieldBox label={t("mill.notes")}>
          <VoiceText value={s.notes} onChange={(notes) => set({ notes })} />
        </FieldBox>
        {over ? (
          <div
            className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            role="alert"
          >
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("mill.finalWarn", { have: qtl(over.have), need: qtl(over.need) })}
            </span>
            <Button variant="outline" className="h-11 bg-white" onClick={() => void save(true)}>
              {t("mill.saveAnyway")}
            </Button>
          </div>
        ) : null}
        {error ? (
          <p
            className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </FormShell>
  );
}

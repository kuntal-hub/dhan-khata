"use client";

/**
 * Consignment settlement (requirement_v2 §12.8E): pick a CONSIGNMENT dispatch with paddy still at
 * the mill, the quantity the mill accepted, the final rate and the date → a CONFIRMED sale to the
 * mill from mill stock, linked to the dispatch (DECISIONS D5). Advances already received on the
 * dispatch move onto the sale (shown before saving). Paddy the mill did not take is recorded as a
 * return.
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
import { RateInput } from "@/components/money/inputs";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { VoiceText } from "@/components/voice/VoiceText";
import { errorKey } from "@/client/errors";
import { useBusiness, useGodownSettings } from "@/client/hooks";
import { dispatchRows } from "@/client/queries/mill";
import { settleConsignment } from "@/client/repo";
import { paiseToInput, parseRateField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import type { Godown } from "@/domain/schemas";
import { formatWeightNumber, gramsToInput } from "@/domain/units";
import { computeBill } from "@/domain/v2/weightBlock";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

interface State {
  dispatchId?: string;
  date: string;
  weight: WeightState;
  rate: string;
  dueDate: string;
  notes: string;
}

export function SettleForm({ godown, dispatchId }: { godown: Godown; dispatchId?: string }) {
  const { t, money, digits, date } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const settings = useGodownSettings(godown._id);
  const monKg = business?.monKg ?? 40;
  const o = { digits, monKg };
  const [s, setS] = useState<State>({
    ...(dispatchId ? { dispatchId } : {}),
    date: todayIST(),
    weight: emptyWeight("MANUAL"),
    rate: "",
    dueDate: "",
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
    () =>
      dispatchRows(godown._id, { type: "CONSIGNMENT", open: true }).then((rows) =>
        rows.filter((r) => r.doc.status === "active"),
      ),
    [godown._id],
  );
  const chosen = dispatches?.find((r) => r.doc._id === s.dispatchId);
  const w = parseWeightState(s.weight, monKg, false);
  const rate = parseRateField(s.rate, true, 1n);
  const roundToRupee = settings?.rounding.roundToRupee ?? false;
  const bill =
    w.result && rate.value !== undefined
      ? computeBill(w.result.netG, rate.value, roundToRupee)
      : undefined;
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
            rate: s.rate || paiseToInput(r.doc.ratePaisePerQtl),
          }
        : {}),
    });
  };

  const save = async (acceptOver: boolean) => {
    setShowErrors(true);
    setError(null);
    if (!chosen || !w.block || !w.result || rate.value === undefined) {
      return setError(t("acct.required"));
    }
    if (!acceptOver && w.result.netG > chosen.balance.remainingG) {
      setOver({ have: chosen.balance.remainingG, need: w.result.netG });
      return;
    }
    setSaving(true);
    try {
      const { sale } = await settleConsignment(godown._id, {
        dispatchId: chosen.doc._id,
        date: s.date,
        weight: w.block,
        ratePaisePerQtl: rate.value.toString(),
        roundToRupee,
        ...(s.dueDate ? { dueDate: s.dueDate } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      });
      setDirty(false);
      lazyToast(t("mill.settleDone"), "success");
      router.replace(`/sales/view?id=${sale._id}`);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell
      title={t("mill.settleTitle", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save(false)}
      saveLabel={t("mill.settleSave")}
      testId="settle-form"
      backHref="/mill?tab=consignment"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t("mill.settleTotal")}</span>
          <span className="tabular text-lg font-semibold" data-testid="settle-total">
            {bill ? money(bill.totalPaise) : "—"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <p className="bg-gold-100 text-accent-foreground flex items-start gap-2 rounded-xl px-3 py-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("mill.settleInfo")}
        </p>
        <FieldBox
          label={t("mill.settleDispatch")}
          error={showErrors && !s.dispatchId ? t("acct.required") : null}
        >
          {dispatches && dispatches.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("mill.noConsignment")}</p>
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
                    {r.doc.number}
                    {r.paidPaise > 0n
                      ? ` · ${t("mill.advanceHeld", { amount: money(r.paidPaise) })}`
                      : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </FieldBox>
        <DateField
          label={t("mill.settleDate")}
          value={s.date}
          onChange={(d) => set({ date: d })}
          testId="settle-date"
        />
        <FieldBox label={t("mill.settleQty")} error={showErrors && w.error ? t(w.error) : null}>
          <WeightBlockInput
            value={s.weight}
            onChange={(weight) => set({ weight })}
            monKg={monKg}
            deductionsEnabled={false}
            testId="settle-weight"
          />
        </FieldBox>
        <RateInput
          label={t("mill.settleRate")}
          value={s.rate}
          onChange={(r) => set({ rate: r })}
          required
          testId="settle-rate"
        />
        <div className="bg-card shadow-card flex flex-col rounded-2xl border p-4">
          <span className="text-muted-foreground text-sm">{t("mill.settleTotal")}</span>
          <span className="tabular text-3xl font-semibold" data-testid="settle-total-big">
            {bill ? money(bill.totalPaise) : "—"}
          </span>
          {bill && w.result && rate.value !== undefined ? (
            <span className="text-muted-foreground tabular mt-1 text-sm">
              {qtl(w.result.netG)} {t("ui.unitQtlShort")} × {money(rate.value)} ={" "}
              {money(bill.amountPaise)}
            </span>
          ) : null}
          {chosen && chosen.paidPaise > 0n ? (
            <span className="mt-2 text-sm text-emerald-800" data-testid="settle-advance">
              {t("mill.settleAdvance", { amount: money(chosen.paidPaise) })}
            </span>
          ) : null}
        </div>
        <DateField
          label={t("sl.dueDate")}
          value={s.dueDate}
          onChange={(dueDate) => set({ dueDate })}
          allowFuture
        />
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
              {t("mill.settleWarn", { have: qtl(over.have), need: qtl(over.need) })}
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

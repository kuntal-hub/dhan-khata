"use client";

/**
 * Mill dispatch (requirement_v2.1 §12.8B): paddy delivered to a mill that the MILL PAYS for.
 * Mill (+ create inline), date, variety, bag-wise or total weight, "মিলের রেট (মিল দেবে)" →
 * "মোট পাওনা", the money the mill gave now ("মিল দিয়েছে": an IN collection), the remaining
 * receivable, due date (a COLLECT reminder), vehicle, driver, notes. Warehouse paddy goes down
 * once and mill paddy up once. Stock going negative needs "তবুও সেভ করুন" (§9.3).
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { DateField, FieldBox, PartyPicker } from "@/components/entry/Fields";
import { DueDateField } from "@/components/entry/DueDate";
import { checkDueDate } from "@/domain/v2/dueDate";
import { emptyPay, PaymentFields, toPart, type PayState } from "@/components/entry/Payments";
import { VarietyPicker } from "@/components/entry/Variety";
import {
  emptyWeight,
  parseWeightState,
  weightFromBlock,
  WeightBlockInput,
  type WeightState,
} from "@/components/entry/WeightBlockInput";
import { FormShell } from "@/components/forms/FormShell";
import { RateInput } from "@/components/money/inputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceText } from "@/components/voice/VoiceText";
import { errorKey } from "@/client/errors";
import { useBusiness } from "@/client/hooks";
import { stockAvailable } from "@/client/queries/sales";
import { linkFromLoadItem, newId, saveBillWithInitialPayment, type DraftOf } from "@/client/repo";
import { paiseToInput, parseRateField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import { amountForWeight } from "@/domain/money";
import type { DocOf, Godown } from "@/domain/schemas";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";

type Dispatch = DocOf<"MILL_DISPATCH">;

interface State {
  millId?: string;
  date: string;
  varietyId?: string;
  weight: WeightState;
  rate: string;
  pay: PayState;
  dueDate: string;
  vehicle: string;
  driver: string;
  notes: string;
}

function initial(existing?: Dispatch, load?: DocOf<"LOAD">): State {
  if (existing) {
    return {
      millId: existing.millPartyId,
      date: existing.dispatchDate,
      varietyId: existing.varietyId,
      weight: weightFromBlock(existing.weight),
      rate: paiseToInput(existing.ratePaisePerQtl),
      pay: emptyPay(existing.dispatchDate),
      dueDate: existing.dueDate ?? "",
      vehicle: existing.vehicleNumber ?? "",
      driver: existing.driverName ?? "",
      notes: existing.notes ?? "",
    };
  }
  const date = load?.transactionDate ?? todayIST();
  return {
    date,
    ...(load?.destinationMillId ? { millId: load.destinationMillId } : {}),
    ...(load ? { varietyId: load.varietyId } : {}),
    weight: load ? weightFromBlock(load.weight) : emptyWeight("BAGS"),
    rate: "",
    pay: emptyPay(date, "0"),
    dueDate: "",
    vehicle: load?.vehicleNumber ?? "",
    driver: load?.driverName ?? "",
    notes: "",
  };
}

export function DispatchForm({
  godown,
  existing,
  fromLoad,
}: {
  godown: Godown;
  existing?: Dispatch;
  /** Create this dispatch from a load khata entry (prefilled, linked 1:1, §12.5). */
  fromLoad?: DocOf<"LOAD">;
}) {
  const { t, money, digits } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const monKg = business?.monKg ?? 40;
  const deductions = business?.settings.deductionsEnabled ?? false;
  const [s, setS] = useState<State>(() => initial(existing, fromLoad));
  const [id] = useState(() => existing?._id ?? newId());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [stockWarn, setStockWarn] = useState<{ have: bigint; need: bigint } | null>(null);
  const set = (patch: Partial<State>) => {
    setS((x) => ({
      ...x,
      ...patch,
      ...(patch.date && !existing && x.pay.date === x.date
        ? { pay: { ...x.pay, date: patch.date } }
        : {}),
    }));
    setDirty(true);
    setStockWarn(null);
  };

  const o = { digits, monKg };
  const w = parseWeightState(s.weight, monKg, deductions);
  const rate = parseRateField(s.rate, false, 0n);
  const rateValue = rate.value ?? 0n;
  const total = w.result ? amountForWeight(w.result.netG, rateValue) : undefined;
  const payPart = existing ? { part: null } : toPart(s.pay, true, s.date);
  const dueCheck = checkDueDate(existing ? undefined : s.dueDate || undefined, s.date, todayIST());
  const paid = payPart.part ? BigInt(payPart.part.amountPaise) : 0n;
  const remaining = total !== undefined ? total - paid : undefined;

  const available = useLiveQuery(async () => {
    if (!s.varietyId) return undefined;
    return stockAvailable(
      godown._id,
      { product: "PADDY", location: "WAREHOUSE", varietyId: s.varietyId },
      undefined,
      existing?._id,
    );
  }, [godown._id, s.varietyId, existing?._id]);

  const save = async (anyway: boolean) => {
    setShowErrors(true);
    setError(null);
    if (!s.millId || !s.varietyId || !w.block || rate.error || total === undefined) {
      setError(t("acct.required"));
      return;
    }
    if (payPart.error) return setError(t(payPart.error));
    if (dueCheck.error) return setError(t("errors.domain.DUE_BEFORE_DEAL"));
    if (paid > total) return setError(t("errors.domain.OVERPAYMENT"));
    if (!anyway && available !== undefined && w.result && w.result.netG > available) {
      setStockWarn({ have: available, need: w.result.netG });
      return;
    }
    setSaving(true);
    try {
      const draft: DraftOf<"MILL_DISPATCH"> = {
        type: "MILL_DISPATCH",
        ...(existing ? {} : { _id: id }),
        // Old records keep their (ignored) dispatchType; new ones have none.
        ...(existing?.dispatchType ? { dispatchType: existing.dispatchType } : {}),
        millPartyId: s.millId,
        dispatchDate: s.date,
        varietyId: s.varietyId,
        weight: w.block,
        ratePaisePerQtl: rateValue.toString(),
        totalValuePaise: "0",
        ...(s.vehicle.trim() ? { vehicleNumber: s.vehicle.trim().toUpperCase() } : {}),
        ...(s.driver.trim() ? { driverName: s.driver.trim() } : {}),
        ...(!existing && s.dueDate ? { dueDate: s.dueDate } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
        ...((existing?.linkedLoadId ?? fromLoad?._id)
          ? { linkedLoadId: existing?.linkedLoadId ?? fromLoad?._id }
          : {}),
      };
      const r = await saveBillWithInitialPayment(
        godown._id,
        draft,
        payPart.part,
        existing
          ? { id: existing._id }
          : fromLoad
            ? {
                extra: [
                  await linkFromLoadItem(godown._id, fromLoad._id, {
                    type: "MILL_DISPATCH",
                    id,
                  }),
                ],
              }
            : {},
      );
      setDirty(false);
      if (existing) router.replace(`/mill/dispatch/view?id=${existing._id}`);
      else setSaved(r.bill._id);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div
        className="bg-background fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 p-6 text-center"
        data-testid="dispatch-saved"
      >
        <CheckCircle2
          className="animate-in zoom-in-50 size-16 text-emerald-600 duration-300"
          aria-hidden
        />
        <p className="text-xl font-semibold">{t("mill.saved")}</p>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Button
            className="h-12 text-base"
            onClick={() => router.replace(`/mill/dispatch/view?id=${saved}`)}
            data-testid="dispatch-open-detail"
          >
            {t("mill.openDetail")}
          </Button>
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => router.replace("/mill?tab=dispatch")}
          >
            {t("sections.millTabs.dispatch")}
          </Button>
        </div>
      </div>
    );
  }

  const qtl = w.result ? formatWeightNumber(w.result.netG, "QTL", o) : "";
  return (
    <FormShell
      title={t(existing ? "mill.dispatchEdit" : "mill.dispatchNew", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save(false)}
      saveLabel={t("mill.save")}
      testId="dispatch-form"
      backHref="/mill?tab=dispatch"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t("mill.total")}</span>
          <span
            className="tabular text-lg font-semibold text-emerald-700"
            data-testid="dispatch-total"
          >
            {total !== undefined ? money(total) : "—"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <p
          className="flex items-start gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          data-testid="dispatch-mill-pays"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("mill.millPays")}
        </p>
        <PartyPicker
          godownId={godown._id}
          roles={["MILL"]}
          createRole="MILL"
          value={s.millId}
          onChange={(millId) => set({ millId })}
          label={t("mill.mill")}
          testId="dispatch-mill"
          error={showErrors && !s.millId ? t("acct.required") : null}
        />
        <DateField
          label={t("mill.date")}
          value={s.date}
          onChange={(d) => set({ date: d })}
          testId="dispatch-date"
        />
        <VarietyPicker
          godownId={godown._id}
          value={s.varietyId}
          onChange={(varietyId) => set({ varietyId })}
          product="PADDY"
          testId="dispatch-variety"
          error={showErrors && !s.varietyId ? t("acct.required") : null}
        />
        {available !== undefined ? (
          <p className="text-muted-foreground -mt-3 text-xs" data-testid="dispatch-stock-now">
            {t("mill.stockNow", { qty: formatWeightNumber(available, "QTL", o) })}
          </p>
        ) : null}
        <FieldBox label={t("mill.quantity")} error={showErrors && w.error ? t(w.error) : null}>
          <WeightBlockInput
            value={s.weight}
            onChange={(weight) => set({ weight })}
            monKg={monKg}
            deductionsEnabled={deductions}
            testId="dispatch-weight"
          />
        </FieldBox>
        <RateInput
          label={t("mill.rate")}
          value={s.rate}
          onChange={(r) => set({ rate: r })}
          testId="dispatch-rate"
        />
        <div className="bg-card shadow-card flex flex-col rounded-2xl border p-4">
          <span className="text-muted-foreground text-sm">{t("mill.total")}</span>
          <span
            className="tabular text-3xl font-semibold text-emerald-700"
            data-testid="dispatch-total-big"
          >
            {total !== undefined ? money(total) : "—"}
          </span>
          {total !== undefined ? (
            <span className="text-muted-foreground tabular mt-1 text-sm">
              {qtl} {t("ui.unitQtlShort")} × {money(rateValue)} = {money(total)}
            </span>
          ) : null}
        </div>
        {existing ? null : (
          <section className="bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4">
            <PaymentFields
              godownId={godown._id}
              value={s.pay}
              onChange={(pay) => set({ pay })}
              amountLabel={t("mill.collectNow")}
              hint={t("mill.payHint")}
              testId="dispatch-pay"
              allowZero
              minDate={s.date}
            />
            <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2">
              <span className="text-sm text-emerald-900">{t("mill.remaining")}</span>
              <span
                className="tabular text-lg font-semibold text-emerald-800"
                data-testid="dispatch-due"
              >
                {remaining !== undefined ? money(remaining) : "—"}
              </span>
            </div>
            <DueDateField
              label={t("mill.dueDate")}
              value={s.dueDate}
              onChange={(dueDate) => set({ dueDate })}
              dealDate={s.date}
              dealType="MILL_DISPATCH"
              testId="dispatch-due-date"
            />
          </section>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FieldBox label={t("mill.vehicle")}>
            <Input
              className="h-12 text-base uppercase"
              value={s.vehicle}
              onChange={(e) => set({ vehicle: e.target.value })}
              data-testid="dispatch-vehicle"
            />
          </FieldBox>
          <FieldBox label={t("mill.driver")}>
            <Input
              className="h-12 text-base"
              value={s.driver}
              onChange={(e) => set({ driver: e.target.value })}
            />
          </FieldBox>
        </div>
        <FieldBox label={t("mill.notes")}>
          <VoiceText value={s.notes} onChange={(notes) => set({ notes })} />
        </FieldBox>
        {stockWarn ? (
          <div
            className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            role="alert"
            data-testid="dispatch-stock-warning"
          >
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("mill.stockWarn", {
                have: formatWeightNumber(stockWarn.have, "QTL", o),
                need: formatWeightNumber(stockWarn.need, "QTL", o),
              })}
            </span>
            <Button
              variant="outline"
              className="h-11 bg-white"
              onClick={() => void save(true)}
              data-testid="dispatch-save-anyway"
            >
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

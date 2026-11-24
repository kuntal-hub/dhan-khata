"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormShell, RestoreDraftBanner } from "@/components/forms/FormShell";
import {
  Choice,
  DateField,
  PayModeFields,
  Section,
  TextField,
  emptyPayMode,
  type PayModeState,
} from "@/components/forms/fields";
import { LoadPicker, PartyPicker, VehicleOnlyPicker } from "@/components/forms/pickers";
import { Computed } from "@/components/money/display";
import { AmountInput, CountInput, RateInput, WeightInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { saveSimple, type VoucherDraft } from "@/client/repo";
import {
  gramsToKgInput,
  paiseToInput,
  parseAmountField,
  parseCountField,
  parseRateField,
  parseWeightField,
} from "@/client/ui/parse";
import { useFormDraft } from "@/client/ui/hooks";
import { formatScaled, parseScaled } from "@/domain/decimal";
import { normalizeDigits } from "@/domain/digits";
import { amountForWeight } from "@/domain/money";
import { TRIP_EXPENSE_KINDS, type Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { today, useAfterSave, useGodownTitle, useSaveError } from "@/components/trade/common";
import { useVoucher } from "@/components/trade/hooks";

type Kind = (typeof TRIP_EXPENSE_KINDS)[number];

interface ExpenseRow {
  kind: Kind;
  amount: string;
  litres: string;
  pay: PayModeState;
  creditPartyId?: string;
}

interface State {
  date: string;
  vehicleId?: string;
  driverPartyId?: string;
  loadingPlace: string;
  unloadingPlace: string;
  ownTrade: boolean;
  ownTradeLoadId?: string;
  hirerPartyId?: string;
  qty: string;
  rateMode: "PER_QUINTAL" | "FIXED";
  rate: string;
  advance: string;
  advancePay: PayModeState;
  expenses: ExpenseRow[];
  odoStart: string;
  odoEnd: string;
  notes: string;
  reason: string;
}

const emptyExpense = (kind: Kind = "DIESEL"): ExpenseRow => ({
  kind,
  amount: "",
  litres: "",
  pay: emptyPayMode(),
});

function initialState(v: Voucher | null, vehicleId?: string): State {
  if (v && v.type === "TRIP") {
    return {
      date: v.date,
      vehicleId: v.vehicleId,
      ...(v.driverPartyId ? { driverPartyId: v.driverPartyId } : {}),
      loadingPlace: v.loadingPlace,
      unloadingPlace: v.unloadingPlace,
      ownTrade: !!v.ownTradeLoadId,
      ...(v.ownTradeLoadId ? { ownTradeLoadId: v.ownTradeLoadId } : {}),
      ...(v.hirerPartyId ? { hirerPartyId: v.hirerPartyId } : {}),
      qty: gramsToKgInput(v.qtyG),
      rateMode: v.rateMode,
      rate: paiseToInput(v.ratePaise),
      advance: paiseToInput(v.advanceReceivedPaise),
      advancePay: {
        ...emptyPayMode(),
        mode: v.advanceMode ?? "CASH",
        ...(v.advanceBankAccountId ? { bankAccountId: v.advanceBankAccountId } : {}),
      },
      expenses: v.expenses.map((e) => ({
        kind: e.kind,
        amount: paiseToInput(e.amountPaise),
        litres: e.litresMl ? formatScaled(BigInt(e.litresMl), 3).replace(/\.?0+$/, "") : "",
        pay: {
          ...emptyPayMode(),
          mode: e.mode,
          ...(e.bankAccountId ? { bankAccountId: e.bankAccountId } : {}),
        },
        ...(e.creditPartyId ? { creditPartyId: e.creditPartyId } : {}),
      })),
      odoStart: v.odometerStartKm !== undefined ? String(v.odometerStartKm) : "",
      odoEnd: v.odometerEndKm !== undefined ? String(v.odometerEndKm) : "",
      notes: v.notes ?? "",
      reason: "",
    };
  }
  return {
    date: today(),
    ...(vehicleId ? { vehicleId } : {}),
    loadingPlace: "",
    unloadingPlace: "",
    ownTrade: false,
    qty: "",
    rateMode: "PER_QUINTAL",
    rate: "",
    advance: "",
    advancePay: emptyPayMode(),
    expenses: [emptyExpense("DIESEL")],
    odoStart: "",
    odoEnd: "",
    notes: "",
    reason: "",
  };
}

/** Litres text ("16.5") → millilitres; null when invalid. */
function litresMl(text: string): bigint | null | undefined {
  if (!text.trim()) return undefined;
  const r = parseScaled(normalizeDigits(text), 3);
  return r.ok && r.value >= 0n ? r.value : null;
}

/** গাড়ির ট্রিপ (spec §9.7). */
export function TripForm({ editId, vehicleId }: { editId?: string; vehicleId?: string }) {
  const { godownId, readOnly } = useWriteGodown();
  const existing = useVoucher(editId);
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || existing === undefined) return <Loading />;
  if (editId && (!existing || existing.type !== "TRIP"))
    return <ReadOnlyNotice reason="notFound" />;
  return (
    <TripFormInner
      key={editId ?? "new"}
      godownId={godownId}
      existing={existing}
      initial={initialState(existing, vehicleId)}
    />
  );
}

function TripFormInner({
  godownId,
  existing,
  initial,
}: {
  godownId: string;
  existing: Voucher | null;
  initial: State;
}) {
  const { t, money } = useI18n();
  const godownName = useGodownTitle();
  const [s, setS] = useState<State>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const afterSave = useAfterSave();
  const onError = useSaveError();
  const draft = useFormDraft(
    existing ? `trip:edit:${existing._id}` : `trip:new:${godownId}`,
    s,
    dirty,
  );
  const update = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const setExpense = (i: number, patch: Partial<ExpenseRow>) =>
    update({ expenses: s.expenses.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const vehicle = useLiveQuery(
    async () => (s.vehicleId ? ((await db().vehicles.get(s.vehicleId)) ?? null) : null),
    [s.vehicleId],
  );

  const qty = parseWeightField(s.qty, s.rateMode === "PER_QUINTAL" && !s.ownTrade);
  const rate =
    s.rateMode === "PER_QUINTAL"
      ? parseRateField(s.rate, !s.ownTrade)
      : parseAmountField(s.rate, !s.ownTrade);
  const advance = parseAmountField(s.advance);
  const freight = s.ownTrade
    ? 0n
    : s.rateMode === "PER_QUINTAL"
      ? qty.value !== undefined && rate.value !== undefined
        ? amountForWeight(qty.value, rate.value)
        : undefined
      : rate.value;
  const due = freight !== undefined ? freight - (advance.value ?? 0n) : undefined;
  const rows = s.expenses.map((e) => ({
    amount: parseAmountField(e.amount, true, 1n),
    ml: e.kind === "DIESEL" ? litresMl(e.litres) : undefined,
  }));
  let expTotal = 0n;
  for (const r of rows) expTotal += r.amount.value ?? 0n;
  const odoStart = parseCountField(s.odoStart);
  const odoEnd = parseCountField(s.odoEnd);
  const synced = existing?.serverSeq !== undefined;
  const needsHirer = !s.ownTrade && ((freight ?? 0n) > 0n || (advance.value ?? 0n) > 0n);

  const save = async () => {
    setShowErrors(true);
    if (!s.vehicleId) return;
    if (needsHirer && !s.hirerPartyId) return;
    if (s.ownTrade && !s.ownTradeLoadId) return;
    if (qty.error || rate.error || advance.error || odoStart.error || odoEnd.error) return;
    if (rows.some((r) => r.amount.value === undefined || r.ml === null)) return;
    if (s.advancePay.mode !== "CASH" && (advance.value ?? 0n) > 0n && !s.advancePay.bankAccountId) {
      if (s.advancePay.mode !== "CHEQUE" && s.advancePay.mode !== "DD") return;
    }
    if (synced && !s.reason.trim()) return;
    setSaving(true);
    try {
      const adv = s.ownTrade ? 0n : (advance.value ?? 0n);
      const d = {
        type: "TRIP",
        date: s.date,
        vehicleId: s.vehicleId,
        ...((s.driverPartyId ?? vehicle?.driverPartyId)
          ? { driverPartyId: s.driverPartyId ?? vehicle?.driverPartyId }
          : {}),
        ...(!s.ownTrade && s.hirerPartyId ? { hirerPartyId: s.hirerPartyId } : {}),
        loadingPlace: s.loadingPlace.trim(),
        unloadingPlace: s.unloadingPlace.trim(),
        ...(qty.value !== undefined ? { qtyG: qty.value.toString() } : {}),
        rateMode: s.rateMode,
        ratePaise: s.ownTrade ? "0" : (rate.value ?? 0n).toString(),
        freightPaise: "0",
        ...(adv > 0n
          ? {
              advanceReceivedPaise: adv.toString(),
              advanceMode: s.advancePay.mode,
              ...(s.advancePay.mode !== "CASH" && s.advancePay.bankAccountId
                ? { advanceBankAccountId: s.advancePay.bankAccountId }
                : {}),
            }
          : {}),
        expenses: s.expenses.map((e, i) => ({
          kind: e.kind,
          amountPaise: rows[i]!.amount.value!.toString(),
          ...(rows[i]!.ml ? { litresMl: rows[i]!.ml!.toString() } : {}),
          mode: e.creditPartyId ? "CASH" : e.pay.mode,
          ...(!e.creditPartyId && e.pay.mode !== "CASH" && e.pay.bankAccountId
            ? { bankAccountId: e.pay.bankAccountId }
            : {}),
          ...(e.creditPartyId ? { creditPartyId: e.creditPartyId } : {}),
        })),
        duePaise: "0",
        ...(s.ownTrade && s.ownTradeLoadId ? { ownTradeLoadId: s.ownTradeLoadId } : {}),
        ...(odoStart.value !== undefined ? { odometerStartKm: Number(odoStart.value) } : {}),
        ...(odoEnd.value !== undefined ? { odometerEndKm: Number(odoEnd.value) } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      } as VoucherDraft;
      const res = await saveSimple(godownId, d, {
        ...(existing ? { id: existing._id } : {}),
        ...(s.reason.trim() ? { reason: s.reason.trim() } : {}),
      });
      setDirty(false);
      await draft.clear();
      afterSave(res.primary._id, "/voucher/view", { receipt: false });
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell
      title={t(existing ? "trip.editTitle" : "trip.newTitle", { godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="trip-form"
      restoreBanner={
        draft.restore && !dirty ? (
          <RestoreDraftBanner
            onRestore={() => {
              setS(draft.restore as State);
              setDirty(true);
              draft.dismiss();
            }}
            onDismiss={() => void draft.clear()}
          />
        ) : null
      }
      totals={
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">{t("trip.profit")}</span>
          <span className="tabular text-lg font-semibold" data-testid="trip-profit">
            {freight !== undefined ? money(freight - expTotal) : "—"}
          </span>
        </div>
      }
    >
      <VehicleOnlyPicker
        godownId={godownId}
        label={t("trip.vehicle")}
        value={s.vehicleId}
        onChange={(vehicleId) => update({ vehicleId })}
        required
        error={showErrors && !s.vehicleId ? "errors.validation.required" : null}
        testId="trip-vehicle"
      />
      <DateField
        label={t("common.date")}
        value={s.date}
        max={today()}
        onChange={(date) => update({ date })}
      />
      <PartyPicker
        godownId={godownId}
        label={t("trip.driver")}
        value={s.driverPartyId ?? vehicle?.driverPartyId}
        onChange={(driverPartyId) => update({ driverPartyId })}
        role="driver"
        newRoles={["driver"]}
        allowClear
      />
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label={t("trip.loadingPlace")}
          value={s.loadingPlace}
          onChange={(loadingPlace) => update({ loadingPlace })}
          maxLength={80}
          testId="trip-from"
        />
        <TextField
          label={t("trip.unloadingPlace")}
          value={s.unloadingPlace}
          onChange={(unloadingPlace) => update({ unloadingPlace })}
          maxLength={80}
          testId="trip-to"
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={s.ownTrade}
          onChange={(e) => update({ ownTrade: e.target.checked })}
          data-testid="trip-own-trade"
        />
        {t("trip.ownTrade")}
      </label>
      {s.ownTrade ? (
        <LoadPicker
          godownId={godownId}
          label={t("trip.ownTradeLoad")}
          value={s.ownTradeLoadId}
          onChange={(ownTradeLoadId) => update({ ownTradeLoadId })}
          required
          error={showErrors && !s.ownTradeLoadId ? "errors.validation.required" : null}
        />
      ) : (
        <PartyPicker
          godownId={godownId}
          label={t("trip.hirer")}
          value={s.hirerPartyId}
          onChange={(hirerPartyId) => update({ hirerPartyId })}
          newRoles={["party"]}
          required={needsHirer}
          error={
            showErrors && needsHirer && !s.hirerPartyId ? "errors.domain.HIRER_REQUIRED" : null
          }
          testId="trip-hirer"
        />
      )}
      <WeightInput
        label={t("trip.qty")}
        value={s.qty}
        onChange={(q) => update({ qty: q })}
        testId="trip-qty"
      />
      {!s.ownTrade ? (
        <Section title={t("trip.freight")}>
          <Choice
            label={t("trip.rateMode")}
            value={s.rateMode}
            onChange={(rateMode) => update({ rateMode, rate: "" })}
            options={[
              { value: "PER_QUINTAL", label: t("trip.perQuintal") },
              { value: "FIXED", label: t("trip.fixed") },
            ]}
            testId="trip-rate-mode"
          />
          {s.rateMode === "PER_QUINTAL" ? (
            <RateInput
              label={t("trip.rate")}
              value={s.rate}
              onChange={(r) => update({ rate: r })}
              testId="trip-rate"
            />
          ) : (
            <AmountInput
              label={t("trip.fixedAmount")}
              value={s.rate}
              onChange={(r) => update({ rate: r })}
              testId="trip-rate"
            />
          )}
          <Computed
            label={t("trip.freight")}
            value={freight !== undefined ? money(freight) : "—"}
            testId="trip-freight"
          />
          <AmountInput
            label={t("trip.advance")}
            value={s.advance}
            onChange={(a) => update({ advance: a })}
            testId="trip-advance"
          />
          {(advance.value ?? 0n) > 0n ? (
            <PayModeFields
              godownId={godownId}
              value={s.advancePay}
              onChange={(advancePay) => update({ advancePay })}
              showCheque
            />
          ) : null}
          <Computed
            label={t("trip.due")}
            value={due !== undefined ? money(due) : "—"}
            testId="trip-due"
          />
        </Section>
      ) : null}
      <Section title={t("trip.expenses")} testId="trip-expenses">
        {s.expenses.map((e, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-md border p-2"
            data-testid={`trip-exp-${i}`}
          >
            <div className="flex items-end gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm">{t("trip.kind")}</span>
                <select
                  className="border-input h-12 rounded-md border px-2 text-base"
                  value={e.kind}
                  onChange={(ev) => setExpense(i, { kind: ev.target.value as Kind })}
                  data-testid={`trip-exp-${i}-kind`}
                >
                  {TRIP_EXPENSE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`vehicle.expenseKind.${k}` as TKey)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-12"
                aria-label={t("trip.removeExpense")}
                onClick={() => update({ expenses: s.expenses.filter((_, j) => j !== i) })}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <AmountInput
                label={t("common.amount")}
                value={e.amount}
                onChange={(amount) => setExpense(i, { amount })}
                required
                allowZero={false}
                error={showErrors ? rows[i]!.amount.error : null}
                testId={`trip-exp-${i}-amount`}
              />
              {e.kind === "DIESEL" ? (
                <TextField
                  label={t("trip.litres")}
                  value={e.litres}
                  inputMode="decimal"
                  onChange={(litres) => setExpense(i, { litres })}
                  error={rows[i]!.ml === null ? "errors.number.invalid" : null}
                  testId={`trip-exp-${i}-litres`}
                />
              ) : null}
            </div>
            {!e.creditPartyId ? (
              <PayModeFields
                godownId={godownId}
                value={e.pay}
                onChange={(pay) => setExpense(i, { pay })}
              />
            ) : null}
            <PartyPicker
              godownId={godownId}
              label={t("trip.onCreditTo")}
              value={e.creditPartyId}
              onChange={(creditPartyId) => setExpense(i, { creditPartyId })}
              newRoles={["pump"]}
              allowClear
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => update({ expenses: [...s.expenses, emptyExpense("DRIVER")] })}
          data-testid="trip-add-expense"
        >
          {t("trip.addExpense")}
        </Button>
        <Computed label={t("fleet.totalExpenses")} value={money(expTotal)} />
      </Section>
      <div className="grid grid-cols-2 gap-2">
        <CountInput
          label={t("trip.odometerStart")}
          value={s.odoStart}
          onChange={(odoStart) => update({ odoStart })}
        />
        <CountInput
          label={t("trip.odometerEnd")}
          value={s.odoEnd}
          onChange={(odoEnd) => update({ odoEnd })}
        />
      </div>
      <TextField
        label={t("trip.note")}
        value={s.notes}
        onChange={(notes) => update({ notes })}
        multiline
        maxLength={1000}
      />
      {synced ? (
        <TextField
          label={t("voucher.editReason")}
          value={s.reason}
          onChange={(reason) => update({ reason })}
          required
          error={showErrors && !s.reason.trim() ? "errors.validation.required" : null}
          testId="edit-reason"
        />
      ) : null}
    </FormShell>
  );
}

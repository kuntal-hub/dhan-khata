"use client";

import { useState } from "react";
import { FormShell, RestoreDraftBanner } from "@/components/forms/FormShell";
import {
  DateField,
  PayModeFields,
  TextField,
  emptyPayMode,
  type PayModeState,
} from "@/components/forms/fields";
import {
  CategoryPicker,
  LoadPicker,
  PartyPicker,
  VehicleOnlyPicker,
} from "@/components/forms/pickers";
import { AmountInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { saveSimple, type VoucherDraft } from "@/client/repo";
import { paiseToInput, parseAmountField } from "@/client/ui/parse";
import { useFormDraft } from "@/client/ui/hooks";
import type { Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { today, useAfterSave, useGodownTitle, useSaveError } from "@/components/trade/common";
import { useVoucher } from "@/components/trade/hooks";

interface State {
  date: string;
  categoryCode?: string;
  amount: string;
  pay: PayModeState;
  onCredit: boolean;
  payeePartyId?: string;
  payeeText: string;
  description: string;
  vehicleId?: string;
  loadId?: string;
  reason: string;
}

function initialState(
  v: Voucher | null,
  preset: { categoryCode?: string; vehicleId?: string },
): State {
  if (v && v.type === "EXPENSE") {
    return {
      date: v.date,
      categoryCode: v.categoryCode,
      amount: paiseToInput(v.amountPaise),
      pay: {
        mode: v.mode,
        ...(v.bankAccountId ? { bankAccountId: v.bankAccountId } : {}),
        ref: "",
        chequeNo: "",
        chequeDate: "",
      },
      onCredit: v.onCredit === true,
      ...(v.payeePartyId ? { payeePartyId: v.payeePartyId } : {}),
      payeeText: v.payeeText ?? "",
      description: v.description,
      ...(v.vehicleId ? { vehicleId: v.vehicleId } : {}),
      ...(v.loadId ? { loadId: v.loadId } : {}),
      reason: "",
    };
  }
  return {
    date: today(),
    ...(preset.categoryCode ? { categoryCode: preset.categoryCode } : {}),
    amount: "",
    pay: emptyPayMode(),
    onCredit: false,
    payeeText: "",
    description: "",
    ...(preset.vehicleId ? { vehicleId: preset.vehicleId } : {}),
    reason: "",
  };
}

/** দৈনিক খরচ entry (spec §9.4): description is required; optional load/vehicle tag. */
export function ExpenseForm({
  editId,
  categoryCode,
  vehicleId,
}: {
  editId?: string;
  categoryCode?: string;
  vehicleId?: string;
}) {
  const { godownId, readOnly } = useWriteGodown();
  const existing = useVoucher(editId);
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || existing === undefined) return <Loading />;
  if (editId && (!existing || existing.type !== "EXPENSE")) {
    return <ReadOnlyNotice reason="notFound" />;
  }
  return (
    <ExpenseFormInner
      key={editId ?? "new"}
      godownId={godownId}
      existing={existing}
      initial={initialState(existing, {
        ...(categoryCode ? { categoryCode } : {}),
        ...(vehicleId ? { vehicleId } : {}),
      })}
    />
  );
}

function ExpenseFormInner({
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
    existing ? `expense:edit:${existing._id}` : `expense:new:${godownId}`,
    s,
    dirty,
  );
  const update = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const amount = parseAmountField(s.amount, true, 1n);
  const synced = existing?.serverSeq !== undefined;
  const needsBank = !s.onCredit && s.pay.mode !== "CASH" && s.pay.mode !== "OTHER";

  const save = async () => {
    setShowErrors(true);
    if (!s.categoryCode || amount.value === undefined || !s.description.trim()) return;
    if (s.onCredit && !s.payeePartyId) return;
    if (needsBank && !s.pay.bankAccountId) return;
    if (synced && !s.reason.trim()) return;
    setSaving(true);
    try {
      const d = {
        type: "EXPENSE",
        date: s.date,
        categoryCode: s.categoryCode,
        amountPaise: amount.value.toString(),
        mode: s.onCredit ? "CASH" : s.pay.mode,
        ...(!s.onCredit && s.pay.mode !== "CASH" && s.pay.bankAccountId
          ? { bankAccountId: s.pay.bankAccountId }
          : {}),
        ...(s.payeePartyId ? { payeePartyId: s.payeePartyId } : {}),
        ...(!s.payeePartyId && s.payeeText.trim() ? { payeeText: s.payeeText.trim() } : {}),
        ...(s.onCredit ? { onCredit: true } : {}),
        description: s.description.trim(),
        ...(s.vehicleId ? { vehicleId: s.vehicleId } : {}),
        ...(s.loadId ? { loadId: s.loadId } : {}),
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
      title={t(existing ? "exp.editTitle" : "exp.newTitle", { godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="expense-form"
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
          <span className="text-muted-foreground text-xs">{t("common.amount")}</span>
          <span className="tabular text-lg font-semibold">
            {amount.value !== undefined ? money(amount.value) : "—"}
          </span>
        </div>
      }
    >
      <CategoryPicker
        godownId={godownId}
        label={t("exp.category")}
        value={s.categoryCode}
        onChange={(categoryCode) => update({ categoryCode })}
        required
        error={showErrors && !s.categoryCode ? "errors.validation.required" : null}
        testId="expense-category"
      />
      <DateField
        label={t("common.date")}
        value={s.date}
        max={today()}
        onChange={(date) => update({ date })}
      />
      <AmountInput
        label={t("common.amount")}
        value={s.amount}
        onChange={(a) => update({ amount: a })}
        required
        allowZero={false}
        error={showErrors ? amount.error : null}
        testId="expense-amount"
      />
      <TextField
        label={t("expense.description")}
        value={s.description}
        onChange={(description) => update({ description })}
        required
        maxLength={300}
        error={showErrors && !s.description.trim() ? "errors.validation.required" : null}
        testId="expense-description"
      />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={s.onCredit}
          onChange={(e) => update({ onCredit: e.target.checked })}
          data-testid="expense-on-credit"
        />
        {t("exp.onCredit")}
      </label>
      {!s.onCredit ? (
        <PayModeFields
          godownId={godownId}
          value={s.pay}
          onChange={(pay) => update({ pay })}
          bankError={
            showErrors && needsBank && !s.pay.bankAccountId
              ? "errors.domain.BANK_ACCOUNT_REQUIRED"
              : null
          }
          testId="expense-mode"
        />
      ) : null}
      <PartyPicker
        godownId={godownId}
        label={t("exp.payee")}
        value={s.payeePartyId}
        onChange={(payeePartyId) => update({ payeePartyId })}
        role={undefined}
        newRoles={["labour"]}
        allowClear
        required={s.onCredit}
        error={showErrors && s.onCredit && !s.payeePartyId ? "errors.domain.PARTY_REQUIRED" : null}
        testId="expense-payee"
      />
      {!s.payeePartyId ? (
        <TextField
          label={t("exp.payeeText")}
          value={s.payeeText}
          onChange={(payeeText) => update({ payeeText })}
          maxLength={80}
        />
      ) : null}
      <VehicleOnlyPicker
        godownId={godownId}
        label={t("exp.tagVehicle")}
        value={s.vehicleId}
        onChange={(vehicleId) => update({ vehicleId })}
        allowClear
      />
      <LoadPicker
        godownId={godownId}
        label={t("exp.tagLoad")}
        value={s.loadId}
        onChange={(loadId) => update({ loadId })}
        allowClear
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

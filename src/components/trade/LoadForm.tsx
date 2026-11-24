"use client";

import { useState } from "react";
import { FormShell, RestoreDraftBanner } from "@/components/forms/FormShell";
import { Choice, DateField, SeasonField, Section, TextField } from "@/components/forms/fields";
import { PartyPicker, PlacePicker, VarietyPicker } from "@/components/forms/pickers";
import { Computed } from "@/components/money/display";
import { AmountInput, CountInput, RateInput, WeightInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useMayViewVoucher, useWriteGodown } from "@/components/system/page";
import { saveLoad, type VoucherDraft } from "@/client/repo";
import {
  gramsToKgInput,
  paiseToInput,
  parseAmountField,
  parseCountField,
  parseRateField,
  parseWeightField,
} from "@/client/ui/parse";
import { useFormDraft } from "@/client/ui/hooks";
import { seasonOf } from "@/domain/dates";
import { amountForWeight } from "@/domain/money";
import { normalizeVehicleNumber, type GodownSettings, type Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { useGodownSettings, useVoucher } from "./hooks";
import { today, useAfterSave, useGodownTitle, useSaveError } from "./common";

interface State {
  mode: "OWN_TRADE" | "AGENT";
  date: string;
  season?: "AMAN" | "BORO" | "AUS";
  placeId?: string;
  placeText: string;
  fromStore: boolean;
  fromPartyId?: string;
  toMillPartyId?: string;
  secondPartyId?: string;
  vehicleText: string;
  varietyId?: string;
  bags: string;
  gross: string;
  net: string;
  partySellRate: string;
  millRate: string;
  commissionKind: "RATE" | "FIXED";
  commissionValue: string;
  commissionPayer: "MILL" | "SELLER";
  notes: string;
  reason: string;
}

function initialState(v: Voucher | null): State {
  if (v && v.type === "LOAD") {
    return {
      mode: v.mode,
      date: v.date,
      ...(v.season ? { season: v.season } : {}),
      ...(v.loadPlaceId ? { placeId: v.loadPlaceId } : {}),
      placeText: v.loadPlaceText ?? "",
      fromStore: v.fromStore === true,
      ...(v.fromPartyId ? { fromPartyId: v.fromPartyId } : {}),
      toMillPartyId: v.toMillPartyId,
      ...(v.secondPartyId ? { secondPartyId: v.secondPartyId } : {}),
      vehicleText: v.vehicleNumber,
      varietyId: v.varietyId,
      bags: v.bags !== undefined ? String(v.bags) : "",
      gross: gramsToKgInput(v.grossG),
      net: gramsToKgInput(v.netG),
      partySellRate: paiseToInput(v.partySellRatePaisePerQtl),
      millRate: paiseToInput(v.millRatePaisePerQtl),
      commissionKind: v.commission?.ratePaisePerQtl ? "RATE" : "FIXED",
      commissionValue: paiseToInput(v.commission?.ratePaisePerQtl ?? v.commission?.amountPaise),
      commissionPayer: v.commission?.payer ?? "MILL",
      notes: v.notes ?? "",
      reason: "",
    };
  }
  return {
    mode: "OWN_TRADE",
    date: today(),
    placeText: "",
    fromStore: false,
    vehicleText: "",
    bags: "",
    gross: "",
    net: "",
    partySellRate: "",
    millRate: "",
    commissionKind: "RATE",
    commissionValue: "",
    commissionPayer: "MILL",
    notes: "",
    reason: "",
  };
}

/** Daily load khata entry (spec §9.5). */
export function LoadForm({ editId }: { editId?: string }) {
  const { godownId, readOnly } = useWriteGodown();
  const settings = useGodownSettings(godownId);
  const existing = useVoucher(editId);
  const mayView = useMayViewVoucher();
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || !settings || existing === undefined) return <Loading />;
  if (editId && (!existing || existing.type !== "LOAD"))
    return <ReadOnlyNotice reason="notFound" />;
  // The `entry` role opens only its own entries.
  if (!mayView) return <Loading />;
  if (existing && !mayView(existing)) return <ReadOnlyNotice reason="entryRole" />;
  return (
    <LoadFormInner
      key={editId ?? "new"}
      godownId={godownId}
      settings={settings}
      existing={existing}
      initial={initialState(existing)}
    />
  );
}

function LoadFormInner({
  godownId,
  settings,
  existing,
  initial,
}: {
  godownId: string;
  settings: GodownSettings;
  existing: Voucher | null;
  initial: State;
}) {
  const { t, money, weightOf, rate } = useI18n();
  const godownName = useGodownTitle();
  const [s, setS] = useState<State>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const afterSave = useAfterSave();
  const onError = useSaveError();
  const formKey = existing ? `load:edit:${existing._id}` : `load:new:${godownId}`;
  const draft = useFormDraft(formKey, s, dirty);
  const update = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const own = s.mode === "OWN_TRADE";
  const gross = parseWeightField(s.gross, true, 1n);
  const netText = s.net.trim() === "" ? s.gross : s.net;
  const net = parseWeightField(netText, true, 1n);
  const bags = parseCountField(s.bags, false);
  const sellRate = parseRateField(
    s.partySellRate,
    own && !s.fromStore,
    own && !s.fromStore ? 1n : 0n,
  );
  const millRate = parseRateField(s.millRate, own, own ? 1n : 0n);
  const comm =
    s.commissionKind === "RATE"
      ? parseRateField(s.commissionValue, !own)
      : parseAmountField(s.commissionValue, !own);
  const netG = net.value;
  const purchaseAmount = netG && sellRate.value ? amountForWeight(netG, sellRate.value) : 0n;
  const saleAmount = netG && millRate.value ? amountForWeight(netG, millRate.value) : 0n;
  const commission =
    !own && netG && comm.value
      ? s.commissionKind === "RATE"
        ? amountForWeight(netG, comm.value)
        : comm.value
      : 0n;
  const netExceeds = gross.value !== undefined && netG !== undefined && netG > gross.value;
  const synced = existing?.serverSeq !== undefined;

  const err = (cond: boolean) =>
    (showErrors && cond ? "errors.validation.required" : null) as
      "errors.validation.required" | null;

  const save = async () => {
    setShowErrors(true);
    if (!s.varietyId || !s.toMillPartyId || gross.error || net.error || netExceeds || bags.error)
      return;
    if (own && (millRate.error || (!s.fromStore && (sellRate.error || !s.fromPartyId)))) return;
    if (!own && (comm.error || comm.value === undefined)) return;
    if (synced && !s.reason.trim()) return;
    setSaving(true);
    try {
      const d = {
        type: "LOAD",
        mode: s.mode,
        date: s.date,
        ...(s.season ? { season: s.season } : {}),
        ...(s.placeId ? { loadPlaceId: s.placeId } : {}),
        ...(s.placeText.trim() && !s.placeId ? { loadPlaceText: s.placeText.trim() } : {}),
        ...(s.fromStore && own ? { fromStore: true } : {}),
        ...(!s.fromStore && s.fromPartyId ? { fromPartyId: s.fromPartyId } : {}),
        toMillPartyId: s.toMillPartyId,
        ...(s.secondPartyId ? { secondPartyId: s.secondPartyId } : {}),
        vehicleNumber: normalizeVehicleNumber(s.vehicleText),
        varietyId: s.varietyId,
        ...(bags.value !== undefined ? { bags: Number(bags.value) } : {}),
        grossG: gross.value!.toString(),
        netG: netG!.toString(),
        ...(sellRate.value ? { partySellRatePaisePerQtl: sellRate.value.toString() } : {}),
        ...(millRate.value ? { millRatePaisePerQtl: millRate.value.toString() } : {}),
        totalAmountPaise: "0",
        ...(!own
          ? {
              commission: {
                ...(s.commissionKind === "RATE" && comm.value
                  ? { ratePaisePerQtl: comm.value.toString() }
                  : {}),
                amountPaise:
                  s.commissionKind === "FIXED" && comm.value ? comm.value.toString() : "0",
                payer: s.commissionPayer,
              },
            }
          : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      } as VoucherDraft;
      const res = await saveLoad(godownId, d, {
        ...(existing ? { id: existing._id } : {}),
        ...(s.reason.trim() ? { reason: s.reason.trim() } : {}),
      });
      setDirty(false);
      await draft.clear();
      afterSave(res.primary._id, "/load/view", { receipt: false });
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell
      title={t(existing ? "load.editTitle" : "load.newTitle", { godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="load-form"
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
          <span className="text-muted-foreground text-xs">
            {own ? t("load.saleAmount") : t("load.commission")}
          </span>
          <span className="tabular text-lg font-semibold" data-testid="load-total">
            {money(own ? saleAmount : commission)}
          </span>
        </div>
      }
    >
      <Choice
        label={t("load.mode")}
        value={s.mode}
        onChange={(mode) => update({ mode })}
        options={[
          { value: "OWN_TRADE", label: t("load.modeOwn") },
          { value: "AGENT", label: t("load.modeAgent") },
        ]}
        testId="load-mode"
      />
      <div className="grid grid-cols-2 gap-2">
        <DateField
          label={t("common.date")}
          value={s.date}
          max={today()}
          onChange={(date) => update({ date })}
        />
        <SeasonField
          value={s.season ?? seasonOf(s.date, settings.seasonMap)}
          onChange={(season) => update({ season })}
        />
      </div>
      <PlacePicker
        godownId={godownId}
        label={t("load.loadPlace")}
        value={s.placeId}
        onChange={(placeId) => update({ placeId })}
        text={s.placeText}
        onTextChange={(placeText) => update({ placeText })}
        testId="load-place"
      />
      {own ? (
        <Choice
          label={t("load.from")}
          value={s.fromStore ? "STORE" : "PARTY"}
          onChange={(v) => update({ fromStore: v === "STORE" })}
          options={[
            { value: "PARTY", label: t("load.fromParty") },
            { value: "STORE", label: t("load.fromStore") },
          ]}
          testId="load-from"
        />
      ) : null}
      {!s.fromStore || !own ? (
        <PartyPicker
          godownId={godownId}
          label={t("load.seller")}
          value={s.fromPartyId}
          onChange={(fromPartyId) => update({ fromPartyId })}
          newRoles={["farmer"]}
          required={own}
          error={err(own && !s.fromStore && !s.fromPartyId)}
          testId="load-seller"
        />
      ) : null}
      <PartyPicker
        godownId={godownId}
        label={t("load.toMill")}
        value={s.toMillPartyId}
        onChange={(toMillPartyId) => update({ toMillPartyId })}
        newRoles={["mill"]}
        required
        error={err(!s.toMillPartyId)}
        testId="load-mill"
      />
      <PartyPicker
        godownId={godownId}
        label={t("load.secondParty")}
        value={s.secondPartyId}
        onChange={(secondPartyId) => update({ secondPartyId })}
        role="party"
        newRoles={["party"]}
        allowClear
      />
      <TextField
        label={t("sale.vehicleNumber")}
        value={s.vehicleText}
        onChange={(vehicleText) => update({ vehicleText })}
        testId="load-vehicle"
        maxLength={20}
      />
      <VarietyPicker
        godownId={godownId}
        label={t("trade.variety")}
        value={s.varietyId}
        onChange={(varietyId) => update({ varietyId })}
        required
        error={err(!s.varietyId)}
        testId="load-variety"
      />
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <CountInput label={t("units.bag")} value={s.bags} onChange={(b) => update({ bags: b })} />
        <WeightInput
          label={t("trade.grossWeight")}
          value={s.gross}
          onChange={(g) => update({ gross: g })}
          required
          testId="load-gross"
        />
      </div>
      <WeightInput
        label={t("trade.netWeight")}
        value={s.net}
        onChange={(n) => update({ net: n })}
        placeholder={s.gross}
        testId="load-net"
        error={netExceeds ? "errors.domain.NET_EXCEEDS_GROSS" : null}
      />
      {own ? (
        <>
          {!s.fromStore ? (
            <RateInput
              label={t("load.partySell")}
              value={s.partySellRate}
              onChange={(partySellRate) => update({ partySellRate })}
              required
              testId="load-sell-rate"
            />
          ) : null}
          <RateInput
            label={t("load.millRate")}
            value={s.millRate}
            onChange={(m) => update({ millRate: m })}
            required
            testId="load-mill-rate"
          />
        </>
      ) : null}
      {!own ? (
        <Section title={t("load.commission")}>
          <Choice
            value={s.commissionKind}
            onChange={(commissionKind) => update({ commissionKind })}
            options={[
              { value: "RATE", label: t("sale.perQuintal") },
              { value: "FIXED", label: t("sale.fixed") },
            ]}
          />
          {s.commissionKind === "RATE" ? (
            <RateInput
              label={t("load.commission")}
              value={s.commissionValue}
              onChange={(commissionValue) => update({ commissionValue })}
              required={!own}
            />
          ) : (
            <AmountInput
              label={t("load.commission")}
              value={s.commissionValue}
              onChange={(commissionValue) => update({ commissionValue })}
              required={!own}
            />
          )}
          <Choice
            label={t("load.commissionPayer")}
            value={s.commissionPayer}
            onChange={(commissionPayer) => update({ commissionPayer })}
            options={[
              { value: "MILL", label: t("load.payerMill") },
              { value: "SELLER", label: t("load.payerSeller") },
            ]}
          />
        </Section>
      ) : null}
      {netG ? (
        <Section title={t("sale.summary")} testId="load-summary">
          <div className="grid grid-cols-2 gap-2">
            {own && !s.fromStore ? (
              <Computed
                label={t("load.purchaseAmount")}
                value={money(purchaseAmount)}
                formula={
                  sellRate.value
                    ? `${weightOf(netG)} × ${rate(sellRate.value)} = ${money(purchaseAmount)}`
                    : undefined
                }
              />
            ) : null}
            {own ? (
              <Computed
                label={t("load.saleAmount")}
                value={money(saleAmount)}
                testId="load-sale-amount"
                formula={
                  millRate.value
                    ? `${weightOf(netG)} × ${rate(millRate.value)} = ${money(saleAmount)}`
                    : undefined
                }
              />
            ) : null}
            {own && !s.fromStore ? (
              <Computed
                label={t("load.margin")}
                value={money(saleAmount - purchaseAmount)}
                testId="load-margin"
              />
            ) : null}
            {commission > 0n ? (
              <Computed label={t("load.commission")} value={money(commission)} />
            ) : null}
          </div>
        </Section>
      ) : null}
      <TextField
        label={t("common.notes")}
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
          error={err(!s.reason.trim())}
          testId="edit-reason"
        />
      ) : null}
    </FormShell>
  );
}

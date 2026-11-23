"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { FormShell, RestoreDraftBanner } from "@/components/forms/FormShell";
import {
  Choice,
  DateField,
  PayModeFields,
  SeasonField,
  Section,
  TextField,
  emptyPayMode,
  type PayModeState,
} from "@/components/forms/fields";
import { PartyPicker, VehiclePicker } from "@/components/forms/pickers";
import { Computed } from "@/components/money/display";
import { AmountInput, RateInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { useGodownRole } from "@/client/hooks";
import { stockOf } from "@/client/queries/stock";
import { getLastUsed, saveSale, upsertMaster, type VoucherDraft } from "@/client/repo";
import { paiseToInput, parseAmountField, parseRateField } from "@/client/ui/parse";
import { useFormDraft } from "@/client/ui/hooks";
import { perQuintalOrFixed, totalNetG } from "@/domain/calc/trade";
import { estimatedSaleProfit, saleSummary } from "@/domain/calc/sale";
import { seasonOf } from "@/domain/dates";
import { divRoundHalfUp } from "@/domain/rounding";
import {
  normalizeVehicleNumber,
  type GodownSettings,
  type SaleVoucher,
  type Voucher,
} from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { useGodownSettings, useVoucher } from "./hooks";
import { ChargesEditor, LinesEditor } from "./LinesEditor";
import {
  chargeFromVoucher,
  evalCharges,
  evalLine,
  lineFromVoucher,
  newLine,
  previewBill,
  type ChargeState,
  type LineState,
} from "./lineState";
import { today, useAfterSave, useGodownTitle, useSaveError } from "./common";

type RateOrFixed = "RATE" | "FIXED";

interface State {
  partyId?: string;
  millPartyId?: string;
  vehicleId?: string;
  vehicleText: string;
  date: string;
  season?: "AMAN" | "BORO" | "AUS";
  source: "STORE" | "TRANSIT";
  lines: LineState[];
  charges: ChargeState[];
  advance: string;
  advancePay: PayModeState;
  advanceVia: string;
  vehAdvance: string;
  vehAdvancePay: PayModeState;
  loadingKind: RateOrFixed;
  loadingValue: string;
  loadingPayTo: "CASH_NOW" | "LABOUR_PARTY";
  labourPartyId?: string;
  freightKind: RateOrFixed;
  freightValue: string;
  freightPayer: "US" | "MILL" | "BUYER";
  transporterPartyId?: string;
  expectedPaymentDate: string;
  notes: string;
  reason: string;
  confirmStock: boolean;
}

function initialState(settings: GodownSettings, v: Voucher | null): State {
  if (v && v.type === "SALE") {
    return {
      partyId: v.partyId,
      ...(v.millPartyId ? { millPartyId: v.millPartyId } : {}),
      ...(v.vehicleId ? { vehicleId: v.vehicleId } : {}),
      vehicleText: v.vehicleId ? "" : v.vehicleNumber,
      date: v.date,
      ...(v.season ? { season: v.season } : {}),
      source: v.source,
      lines: v.lines.map(lineFromVoucher),
      charges: v.charges.map(chargeFromVoucher),
      advance: paiseToInput(v.advanceReceived?.amountPaise),
      advancePay: {
        ...emptyPayMode(),
        mode: v.advanceReceived?.mode ?? "CASH",
        ...(v.advanceReceived?.bankAccountId
          ? { bankAccountId: v.advanceReceived.bankAccountId }
          : {}),
        ref: v.advanceReceived?.ref ?? "",
      },
      advanceVia: v.advanceReceived?.via ?? "",
      vehAdvance: paiseToInput(v.vehicleAdvance?.amountPaise),
      vehAdvancePay: {
        ...emptyPayMode(),
        mode: v.vehicleAdvance?.mode ?? "CASH",
        ...(v.vehicleAdvance?.bankAccountId
          ? { bankAccountId: v.vehicleAdvance.bankAccountId }
          : {}),
      },
      loadingKind: v.loading?.ratePaisePerQtl ? "RATE" : "FIXED",
      loadingValue: paiseToInput(v.loading?.ratePaisePerQtl ?? v.loading?.fixedPaise),
      loadingPayTo: v.loading?.payTo ?? "CASH_NOW",
      ...(v.loading?.labourPartyId ? { labourPartyId: v.loading.labourPartyId } : {}),
      freightKind: v.delivery?.ratePaisePerQtl ? "RATE" : "FIXED",
      freightValue: paiseToInput(v.delivery?.ratePaisePerQtl ?? v.delivery?.fixedPaise),
      freightPayer: v.delivery?.payer ?? "US",
      ...(v.delivery?.transporterPartyId
        ? { transporterPartyId: v.delivery.transporterPartyId }
        : {}),
      expectedPaymentDate: v.expectedPaymentDate ?? "",
      notes: v.notes ?? "",
      reason: "",
      confirmStock: false,
    };
  }
  return {
    vehicleText: "",
    date: today(),
    source: "STORE",
    lines: [newLine(settings.defaults.deductions)],
    charges: [],
    advance: "",
    advancePay: emptyPayMode(),
    advanceVia: "",
    vehAdvance: "",
    vehAdvancePay: emptyPayMode(),
    loadingKind: "RATE",
    loadingValue: "",
    loadingPayTo: "CASH_NOW",
    freightKind: "RATE",
    freightValue: "",
    freightPayer: "US",
    expectedPaymentDate: "",
    notes: "",
    reason: "",
    confirmStock: false,
  };
}

/** New / edit sale (spec §9.3). */
export function SaleForm({ editId }: { editId?: string }) {
  const { godownId, readOnly } = useWriteGodown();
  const settings = useGodownSettings(godownId);
  const existing = useVoucher(editId);
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || !settings || existing === undefined) return <Loading />;
  if (editId && (!existing || existing.type !== "SALE"))
    return <ReadOnlyNotice reason="notFound" />;
  return (
    <SaleFormInner
      key={editId ?? "new"}
      godownId={godownId}
      settings={settings}
      existing={existing}
      initial={initialState(settings, existing)}
    />
  );
}

function amountPart(kind: RateOrFixed, text: string) {
  const r = kind === "RATE" ? parseRateField(text, false) : parseAmountField(text, false);
  return { value: r.value, error: r.error };
}

function SaleFormInner({
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
  const { t, money, weightOf } = useI18n();
  const godownName = useGodownTitle();
  const role = useGodownRole();
  const canConfirmStock = role === "owner" || role === "manager";
  const showProfit = role === "owner";
  const [s, setS] = useState<State>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const afterSave = useAfterSave();
  const onError = useSaveError();
  const formKey = existing ? `sale:edit:${existing._id}` : `sale:new:${godownId}`;
  const draft = useFormDraft(formKey, s, dirty);
  const update = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const roundToRupee =
    existing && existing.type === "SALE" ? existing.roundToRupee : settings.rounding.roundToRupee;

  const evals = s.lines.map(evalLine);
  const ch = evalCharges(s.charges);
  const bill = previewBill(evals, ch.charges, roundToRupee);
  const net = evals.every((e) => e.result) ? evals.reduce((a, e) => a + e.result!.netG, 0n) : 0n;
  const loadingP = amountPart(s.loadingKind, s.loadingValue);
  const freightP = amountPart(s.freightKind, s.freightValue);
  const advanceP = parseAmountField(s.advance, false);
  const vehAdvP = parseAmountField(s.vehAdvance, false);
  const loadingAmount = perQuintalOrFixed(
    net,
    s.loadingKind === "RATE" ? loadingP.value : undefined,
    s.loadingKind === "FIXED" ? loadingP.value : undefined,
  );
  const freightAmount = perQuintalOrFixed(
    net,
    s.freightKind === "RATE" ? freightP.value : undefined,
    s.freightKind === "FIXED" ? freightP.value : undefined,
  );

  // Stock available in this godown's store for each variety (adding back this sale's own moves).
  const varietyKey = s.lines.map((l) => l.varietyId ?? "").join(",");
  const stock = useLiveQuery(async () => {
    const m = new Map<string, { qtyG: bigint; valuePaise: bigint }>();
    const own = existing
      ? await db().stockMoves.where("voucherId").equals(existing._id).toArray()
      : [];
    for (const v of new Set(s.lines.map((l) => l.varietyId).filter((x): x is string => !!x))) {
      const pos = await stockOf(godownId, v, "STORE");
      let q = pos.qtyG;
      let val = pos.valuePaise;
      for (const mv of own) {
        if (mv.varietyId === v && mv.location === "STORE") {
          q -= BigInt(mv.qtyG);
          val -= BigInt(mv.valuePaise);
        }
      }
      m.set(v, { qtyG: q, valuePaise: val });
    }
    return m;
  }, [varietyKey, godownId, existing?._id]);
  const shortVarieties =
    s.source === "STORE" && stock
      ? s.lines.filter((l, i) => {
          const r = evals[i]?.result;
          if (!l.varietyId || !r) return false;
          return r.netG > (stock.get(l.varietyId)?.qtyG ?? 0n);
        })
      : [];
  const needsStockConfirm = shortVarieties.length > 0;

  // Estimated cost of goods (store: weighted average; transit: unknown here → not shown).
  let estCost: bigint | null = null;
  if (s.source === "STORE" && stock && evals.every((e) => e.result)) {
    estCost = 0n;
    s.lines.forEach((l, i) => {
      const pos = stock.get(l.varietyId ?? "");
      const q = evals[i]!.result!.netG;
      if (pos && pos.qtyG > 0n) estCost! += divRoundHalfUp(q * pos.valuePaise, pos.qtyG);
    });
  }

  const onParty = async (partyId: string | undefined) => {
    update({ partyId });
    if (!partyId || existing) return;
    const pristine = s.lines.length === 1 && !s.lines[0]!.gross && !s.lines[0]!.rate;
    if (!pristine) return;
    const last = await getLastUsed(godownId, partyId);
    if (!last) return;
    // Remembered per party (spec §9): suggest the last variety, rate and deductions.
    setS((x) => ({
      ...x,
      lines: [
        newLine(
          { ...settings.defaults.deductions, ...last.deductions },
          last.varietyId,
          last.ratePaisePerQtl,
        ),
      ],
    }));
  };

  const buildDraft = (): VoucherDraft | null => {
    if (!s.partyId || evals.some((e) => !e.draft) || !ch.charges) return null;
    if (loadingP.error || freightP.error || advanceP.error || vehAdvP.error) return null;
    const loadingVal = loadingP.value ?? 0n;
    const freightVal = freightP.value ?? 0n;
    return {
      type: "SALE",
      date: s.date,
      ...(s.season ? { season: s.season } : {}),
      partyId: s.partyId,
      ...(s.millPartyId ? { millPartyId: s.millPartyId } : {}),
      ...(s.vehicleId ? { vehicleId: s.vehicleId } : {}),
      vehicleNumber: normalizeVehicleNumber(s.vehicleText),
      source: s.source,
      lines: evals.map((e) => e.draft!),
      charges: ch.charges,
      roundToRupee,
      roundOffPaise: "0",
      ...(loadingVal > 0n
        ? {
            loading: {
              ...(s.loadingKind === "RATE"
                ? { ratePaisePerQtl: loadingVal.toString() }
                : { fixedPaise: loadingVal.toString() }),
              amountPaise: "0",
              payTo: s.loadingPayTo,
              ...(s.loadingPayTo === "LABOUR_PARTY" && s.labourPartyId
                ? { labourPartyId: s.labourPartyId }
                : {}),
            },
          }
        : {}),
      ...(freightVal > 0n
        ? {
            delivery: {
              ...(s.freightKind === "RATE"
                ? { ratePaisePerQtl: freightVal.toString() }
                : { fixedPaise: freightVal.toString() }),
              amountPaise: "0",
              payer: s.freightPayer,
              ...(s.transporterPartyId ? { transporterPartyId: s.transporterPartyId } : {}),
            },
          }
        : {}),
      ...((vehAdvP.value ?? 0n) > 0n
        ? {
            vehicleAdvance: {
              amountPaise: vehAdvP.value!.toString(),
              mode: s.vehAdvancePay.mode,
              ...(s.vehAdvancePay.mode !== "CASH" && s.vehAdvancePay.bankAccountId
                ? { bankAccountId: s.vehAdvancePay.bankAccountId }
                : {}),
            },
          }
        : {}),
      ...((advanceP.value ?? 0n) > 0n
        ? {
            advanceReceived: {
              amountPaise: advanceP.value!.toString(),
              mode: s.advancePay.mode,
              ...(s.advancePay.mode !== "CASH" && s.advancePay.bankAccountId
                ? { bankAccountId: s.advancePay.bankAccountId }
                : {}),
              ...(s.advancePay.ref.trim() ? { ref: s.advancePay.ref.trim() } : {}),
              ...(s.advanceVia.trim() ? { via: s.advanceVia.trim() } : {}),
            },
          }
        : {}),
      totalPaise: "0",
      duePaise: "0",
      ...(s.expectedPaymentDate ? { expectedPaymentDate: s.expectedPaymentDate } : {}),
      settlementStatus:
        existing && existing.type === "SALE" ? existing.settlementStatus : "PENDING",
      ...(existing && existing.type === "SALE" && existing.loadId
        ? { loadId: existing.loadId }
        : {}),
      ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
    } as VoucherDraft;
  };

  const previewSale = (() => {
    const d = buildDraft();
    if (!d || !bill) return null;
    const v = {
      ...(d as SaleVoucher),
      totalPaise: bill.total.toString(),
      loading: (d as SaleVoucher).loading
        ? { ...(d as SaleVoucher).loading!, amountPaise: loadingAmount.toString() }
        : undefined,
      delivery: (d as SaleVoucher).delivery
        ? { ...(d as SaleVoucher).delivery!, amountPaise: freightAmount.toString() }
        : undefined,
    } as SaleVoucher;
    return v;
  })();
  const summary = previewSale ? saleSummary(previewSale) : null;
  const synced = existing?.serverSeq !== undefined;

  const save = async () => {
    setShowErrors(true);
    const d = buildDraft();
    if (!d) return;
    if (synced && !s.reason.trim()) return;
    if (needsStockConfirm && !s.confirmStock) return;
    setSaving(true);
    try {
      let vehicleId = s.vehicleId;
      const number = normalizeVehicleNumber(s.vehicleText);
      if (!vehicleId && number.length >= 2) {
        // Free-text vehicle number auto-creates an external vehicle (spec §9.3).
        const found = await db()
          .vehicles.where("[godownId+number]")
          .equals([godownId, number])
          .first();
        vehicleId =
          found?._id ??
          (await upsertMaster(godownId, "vehicle", { number, ownership: "external" }))._id;
      }
      const final = {
        ...(d as SaleVoucher),
        ...(vehicleId ? { vehicleId } : {}),
      } as unknown as VoucherDraft;
      if (vehicleId && !number) {
        const veh = await db().vehicles.get(vehicleId);
        (final as SaleVoucher).vehicleNumber = veh?.number ?? "";
      }
      const res = await saveSale(godownId, final, {
        ...(existing ? { id: existing._id } : {}),
        ...(s.reason.trim() ? { reason: s.reason.trim() } : {}),
      });
      setDirty(false);
      await draft.clear();
      afterSave(res.primary._id, "/sale/view");
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell
      title={t(existing ? "sale.editTitle" : "sale.newTitle", { godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="sale-form"
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
          <span className="text-muted-foreground text-xs">{t("sale.netReceivable")}</span>
          <span className="tabular text-lg font-semibold" data-testid="sale-total">
            {summary ? money(summary.netReceivable) : "—"}
          </span>
        </div>
      }
    >
      <PartyPicker
        godownId={godownId}
        label={t("sale.party")}
        value={s.partyId}
        onChange={(partyId) => void onParty(partyId)}
        newRoles={["mill"]}
        required
        error={showErrors && !s.partyId ? "errors.validation.required" : null}
        testId="sale-party"
      />
      <PartyPicker
        godownId={godownId}
        label={t("sale.millIfDifferent")}
        value={s.millPartyId}
        onChange={(millPartyId) => update({ millPartyId })}
        role="mill"
        newRoles={["mill"]}
        allowClear
        testId="sale-mill"
      />
      <VehiclePicker
        godownId={godownId}
        label={t("sale.vehicleNumber")}
        value={s.vehicleId}
        onChange={(vehicleId) => update({ vehicleId })}
        text={s.vehicleText}
        onTextChange={(vehicleText) => update({ vehicleText })}
        testId="sale-vehicle"
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
      <Choice
        label={t("sale.source")}
        value={s.source}
        onChange={(source) => update({ source })}
        options={[
          { value: "STORE", label: t("sale.fromStore") },
          { value: "TRANSIT", label: t("purchase.directLoad") },
        ]}
      />
      <LinesEditor
        godownId={godownId}
        lines={s.lines}
        onChange={(lines) => update({ lines })}
        defaults={settings.defaults.deductions}
        showErrors={showErrors}
      />
      {stock && s.source === "STORE"
        ? s.lines.map((l) =>
            l.varietyId ? (
              <p key={l.key} className="text-muted-foreground tabular text-xs">
                {t("sale.stockAvailable", { qty: weightOf(stock.get(l.varietyId)?.qtyG ?? 0n) })}
              </p>
            ) : null,
          )
        : null}
      {needsStockConfirm ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          role="alert"
        >
          <p>{t("sale.stockNegativeWarning")}</p>
          {canConfirmStock ? (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={s.confirmStock}
                onChange={(e) => update({ confirmStock: e.target.checked })}
                data-testid="sale-confirm-stock"
              />
              {t("sale.confirmNegativeStock")}
            </label>
          ) : (
            <p>{t("sale.askManager")}</p>
          )}
        </div>
      ) : null}
      <Section title={t("trade.charges")}>
        <ChargesEditor charges={s.charges} onChange={(charges) => update({ charges })} />
      </Section>
      <Section title={t("sale.loadingRate")}>
        <Choice
          value={s.loadingKind}
          onChange={(loadingKind) => update({ loadingKind })}
          options={[
            { value: "RATE", label: t("sale.perQuintal") },
            { value: "FIXED", label: t("sale.fixed") },
          ]}
        />
        {s.loadingKind === "RATE" ? (
          <RateInput
            label={t("sale.loadingRate")}
            value={s.loadingValue}
            onChange={(loadingValue) => update({ loadingValue })}
          />
        ) : (
          <AmountInput
            label={t("sale.loadingAmount")}
            value={s.loadingValue}
            onChange={(loadingValue) => update({ loadingValue })}
          />
        )}
        <Choice
          label={t("sale.loadingPayTo")}
          value={s.loadingPayTo}
          onChange={(loadingPayTo) => update({ loadingPayTo })}
          options={[
            { value: "CASH_NOW", label: t("sale.loadingCashNow") },
            { value: "LABOUR_PARTY", label: t("sale.loadingLabourParty") },
          ]}
        />
        {s.loadingPayTo === "LABOUR_PARTY" ? (
          <PartyPicker
            godownId={godownId}
            label={t("partyRole.labour")}
            value={s.labourPartyId}
            onChange={(labourPartyId) => update({ labourPartyId })}
            role="labour"
            newRoles={["labour"]}
          />
        ) : null}
      </Section>
      <Section title={t("sale.deliveryRate")}>
        <Choice
          value={s.freightKind}
          onChange={(freightKind) => update({ freightKind })}
          options={[
            { value: "RATE", label: t("sale.perQuintal") },
            { value: "FIXED", label: t("sale.fixed") },
          ]}
        />
        {s.freightKind === "RATE" ? (
          <RateInput
            label={t("sale.deliveryRate")}
            value={s.freightValue}
            onChange={(freightValue) => update({ freightValue })}
          />
        ) : (
          <AmountInput
            label={t("sale.freightAmount")}
            value={s.freightValue}
            onChange={(freightValue) => update({ freightValue })}
          />
        )}
        <Choice
          label={t("sale.freightPayer")}
          value={s.freightPayer}
          onChange={(freightPayer) => update({ freightPayer })}
          options={[
            { value: "US", label: t("sale.payerUs") },
            { value: "MILL", label: t("sale.payerMill") },
            { value: "BUYER", label: t("sale.payerBuyer") },
          ]}
        />
        <PartyPicker
          godownId={godownId}
          label={t("sale.transporter")}
          value={s.transporterPartyId}
          onChange={(transporterPartyId) => update({ transporterPartyId })}
          role="transporter"
          newRoles={["transporter"]}
          allowClear
        />
        <AmountInput
          label={t("sale.vehicleAdvance")}
          value={s.vehAdvance}
          onChange={(vehAdvance) => update({ vehAdvance })}
        />
        {(vehAdvP.value ?? 0n) > 0n ? (
          <PayModeFields
            godownId={godownId}
            value={s.vehAdvancePay}
            onChange={(vehAdvancePay) => update({ vehAdvancePay })}
          />
        ) : null}
      </Section>
      <Section title={t("sale.advanceReceived")}>
        <AmountInput
          label={t("common.amount")}
          value={s.advance}
          onChange={(advance) => update({ advance })}
          testId="sale-advance"
        />
        {(advanceP.value ?? 0n) > 0n ? (
          <>
            <PayModeFields
              godownId={godownId}
              value={s.advancePay}
              onChange={(advancePay) => update({ advancePay })}
            />
            <TextField
              label={t("payment.cashVia")}
              value={s.advanceVia}
              onChange={(advanceVia) => update({ advanceVia })}
              maxLength={80}
            />
          </>
        ) : null}
        <DateField
          label={t("sale.expectedPaymentDate")}
          value={s.expectedPaymentDate}
          min={s.date}
          optional
          onChange={(expectedPaymentDate) => update({ expectedPaymentDate })}
        />
      </Section>
      {summary ? (
        <Section title={t("sale.summary")} testId="sale-summary">
          <div className="grid grid-cols-2 gap-2">
            <Computed
              label={t("sale.goodsValue")}
              value={money(summary.goodsValue)}
              testId="sale-goods"
            />
            <Computed label={t("sale.freight")} value={money(summary.freight)} />
            <Computed label={t("sale.loading")} value={money(summary.loading)} />
            <Computed label={t("sale.vehicleAdvance")} value={money(summary.vehicleAdvance)} />
          </div>
          <Computed
            label={t("sale.netReceivable")}
            value={money(summary.netReceivable)}
            large
            formula={`${money(summary.goodsValue)} − ${money(summary.advanceReceived)}${s.freightPayer === "MILL" ? ` − ${money(summary.freight)}` : ""}`}
          />
          {showProfit && estCost !== null && previewSale ? (
            <Computed
              label={t("sale.estimatedProfit")}
              value={money(estimatedSaleProfit(previewSale, estCost))}
              testId="sale-profit"
            />
          ) : null}
          {net > 0n ? (
            <p className="text-muted-foreground tabular text-xs">
              {weightOf(totalNetG(evals.map((e) => e.draft!)))}
            </p>
          ) : null}
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
          error={showErrors && !s.reason.trim() ? "errors.validation.required" : null}
          testId="edit-reason"
        />
      ) : null}
    </FormShell>
  );
}

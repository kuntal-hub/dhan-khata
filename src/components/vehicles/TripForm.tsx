"use client";

/**
 * Vehicle trip (requirement_v2 §12.7): date, customer (+ create inline), vehicle (+ create inline),
 * driver, loading location, destination, rate per quintal (with quantity) or fixed → total income,
 * advance received (IN payment), remaining due, due date, costs (driver, diesel with litres, other;
 * each "paid now" with its mode and date), notes. Shows
 * `Net profit = Total income − Driver cost − Diesel cost − Other expenses` live.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { DateField, FieldBox, PartyPicker, Segmented } from "@/components/entry/Fields";
import { emptyPay, PaymentFields, toPart, type PayState } from "@/components/entry/Payments";
import {
  emptyWeight,
  parseWeightState,
  WeightBlockInput,
  type WeightState,
} from "@/components/entry/WeightBlockInput";
import { FormShell } from "@/components/forms/FormShell";
import { AmountInput } from "@/components/money/inputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceText } from "@/components/voice/VoiceText";
import { errorKey } from "@/client/errors";
import { useBusiness } from "@/client/hooks";
import { newId, saveTrip, type DraftOf, type PaymentPart } from "@/client/repo";
import { paiseToInput, parseAmountField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import { amountForWeight } from "@/domain/money";
import { VEHICLE_COST_KINDS, type DocOf, type Godown } from "@/domain/schemas";
import { gramsToInput, parseWeightIn } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { VehiclePicker } from "./VehiclePicker";

type Trip = DocOf<"TRIP">;
type Kind = (typeof VEHICLE_COST_KINDS)[number];

interface CostState {
  id: string;
  kind: Kind;
  amount: string;
  litres: string;
  payee: string;
  paidNow: boolean;
  pay: PayState;
}

interface State {
  date: string;
  customerId?: string;
  vehicleId?: string;
  driver: string;
  from: string;
  to: string;
  rateMode: Trip["rateMode"];
  qty: WeightState;
  rate: string;
  pay: PayState;
  dueDate: string;
  costs: CostState[];
  notes: string;
}

const costRow = (kind: Kind, date: string): CostState => ({
  id: newId(),
  kind,
  amount: "",
  litres: "",
  payee: "",
  paidNow: true,
  pay: emptyPay(date),
});

function initial(existing?: Trip): State {
  if (existing) {
    return {
      date: existing.transactionDate,
      ...(existing.customerPartyId ? { customerId: existing.customerPartyId } : {}),
      vehicleId: existing.vehicleId,
      driver: existing.driverName ?? "",
      from: existing.loadingLocation,
      to: existing.destination,
      rateMode: existing.rateMode,
      qty: {
        ...emptyWeight("MANUAL"),
        manual: existing.qtyG ? gramsToInput(BigInt(existing.qtyG), "QTL") : "",
      },
      rate: paiseToInput(existing.ratePaise),
      pay: emptyPay(existing.transactionDate),
      dueDate: existing.dueDate ?? "",
      costs: existing.costs.map((c) => ({
        id: c.id,
        kind: c.kind,
        amount: paiseToInput(c.amountPaise),
        litres: c.litresMl ? gramsToInput(BigInt(c.litresMl), "KG") : "",
        payee: c.payeeText ?? "",
        paidNow: false,
        pay: emptyPay(existing.transactionDate),
      })),
      notes: existing.notes ?? "",
    };
  }
  const today = todayIST();
  return {
    date: today,
    driver: "",
    from: "",
    to: "",
    rateMode: "FIXED",
    qty: emptyWeight("MANUAL"),
    rate: "",
    pay: emptyPay(today, "0"),
    dueDate: "",
    costs: [costRow("DRIVER", today), costRow("DIESEL", today), costRow("OTHER", today)],
    notes: "",
  };
}

export function TripForm({ godown, existing }: { godown: Godown; existing?: Trip }) {
  const { t, money } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const monKg = business?.monKg ?? 40;
  const [s, setS] = useState<State>(() => initial(existing));
  const [id] = useState(() => existing?._id ?? newId());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const setCost = (i: number, patch: Partial<CostState>) =>
    set({ costs: s.costs.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const qty = s.rateMode === "PER_QTL" ? parseWeightState(s.qty, monKg, false) : undefined;
  const rate = parseAmountField(s.rate, false, 0n).value ?? 0n;
  const income =
    s.rateMode === "PER_QTL" ? (qty?.result ? amountForWeight(qty.result.netG, rate) : 0n) : rate;
  const costAmounts = s.costs.map((c) => parseAmountField(c.amount, false, 0n).value ?? 0n);
  const costTotal = costAmounts.reduce((a, b) => a + b, 0n);
  const net = income - costTotal;
  const advance = existing ? { part: null } : toPart(s.pay, true);
  const received = advance.part ? BigInt(advance.part.amountPaise) : 0n;

  const save = async () => {
    setShowErrors(true);
    setError(null);
    if (!s.vehicleId || !s.from.trim() || !s.to.trim()) return setError(t("acct.required"));
    if (s.rateMode === "PER_QTL" && (!qty?.result || qty.result.netG <= 0n))
      return setError(t("acct.required"));
    if (income > 0n && !s.customerId) return setError(t("errors.domain.PARTY_REQUIRED"));
    if (advance.error) return setError(t(advance.error));
    if (received > income) return setError(t("errors.domain.OVERPAYMENT"));
    const costPays: Record<string, PaymentPart> = {};
    const costs: Trip["costs"] = [];
    for (let i = 0; i < s.costs.length; i++) {
      const c = s.costs[i]!;
      const amt = costAmounts[i]!;
      if (amt <= 0n) continue;
      // Litres with up to 3 decimals, stored exactly in millilitres (same scale as kg → g).
      const litres = c.kind === "DIESEL" && c.litres.trim() ? parseWeightIn(c.litres, "KG") : null;
      if (litres && !litres.ok) return setError(t(litres.error as TKey));
      costs.push({
        id: c.id,
        kind: c.kind,
        amountPaise: amt.toString(),
        ...(litres?.ok && litres.value > 0n ? { litresMl: litres.value.toString() } : {}),
        ...(c.payee.trim() ? { payeeText: c.payee.trim() } : {}),
      });
      if (!existing && c.paidNow) {
        const r = toPart({ ...c.pay, amount: paiseToInput(amt) }, false);
        if (r.error) return setError(t(r.error));
        if (r.part) costPays[c.id] = r.part;
      }
    }
    setSaving(true);
    try {
      const draft: DraftOf<"TRIP"> = {
        type: "TRIP",
        ...(existing ? {} : { _id: id }),
        transactionDate: s.date,
        ...(s.customerId ? { customerPartyId: s.customerId } : {}),
        vehicleId: s.vehicleId,
        ...(s.driver.trim() ? { driverName: s.driver.trim() } : {}),
        loadingLocation: s.from.trim(),
        destination: s.to.trim(),
        ...(s.rateMode === "PER_QTL" && qty?.result ? { qtyG: qty.result.netG.toString() } : {}),
        rateMode: s.rateMode,
        ratePaise: rate.toString(),
        totalIncomePaise: "0",
        ...(s.dueDate ? { dueDate: s.dueDate } : {}),
        costs,
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      };
      await saveTrip(
        godown._id,
        draft,
        { advance: advance.part, costs: costPays },
        existing ? { id: existing._id } : {},
      );
      setDirty(false);
      if (existing) router.replace(`/vehicles/trip/view?id=${existing._id}`);
      else setSaved(true);
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
        data-testid="trip-saved"
      >
        <CheckCircle2
          className="animate-in zoom-in-50 size-16 text-emerald-600 duration-300"
          aria-hidden
        />
        <p className="text-xl font-semibold">{t("veh.saved")}</p>
        <Button
          className="h-12 w-full max-w-sm text-base"
          onClick={() => router.replace(`/vehicles/trip/view?id=${id}`)}
          data-testid="trip-open-detail"
        >
          {t("mill.openDetail")}
        </Button>
      </div>
    );
  }

  return (
    <FormShell
      title={t(existing ? "veh.editTitle" : "veh.newTitle", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      saveLabel={t("mill.save")}
      testId="trip-form"
      backHref="/vehicles"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t("veh.net")}</span>
          <span
            className={`tabular text-lg font-semibold ${net < 0n ? "text-money-out" : ""}`}
            data-testid="trip-net"
            data-paise={net.toString()}
          >
            {money(net)}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <DateField
          label={t("veh.date")}
          value={s.date}
          onChange={(d) => set({ date: d })}
          testId="trip-date"
        />
        <PartyPicker
          godownId={godown._id}
          roles={["VEHICLE_CUSTOMER", "CUSTOMER"]}
          createRole="VEHICLE_CUSTOMER"
          value={s.customerId}
          onChange={(customerId) => set({ customerId })}
          label={t("veh.customer")}
          testId="trip-customer"
        />
        <VehiclePicker
          godownId={godown._id}
          value={s.vehicleId}
          onChange={(vehicleId) => set({ vehicleId })}
          testId="trip-vehicle"
          error={showErrors && !s.vehicleId ? t("acct.required") : null}
        />
        <FieldBox label={t("veh.driver")}>
          <Input
            className="h-12 text-base"
            value={s.driver}
            onChange={(e) => set({ driver: e.target.value })}
          />
        </FieldBox>
        <div className="grid grid-cols-2 gap-3">
          <FieldBox
            label={t("veh.from")}
            error={showErrors && !s.from.trim() ? t("acct.required") : null}
          >
            <Input
              className="h-12 text-base"
              value={s.from}
              onChange={(e) => set({ from: e.target.value })}
              data-testid="trip-from"
            />
          </FieldBox>
          <FieldBox
            label={t("veh.to")}
            error={showErrors && !s.to.trim() ? t("acct.required") : null}
          >
            <Input
              className="h-12 text-base"
              value={s.to}
              onChange={(e) => set({ to: e.target.value })}
              data-testid="trip-to"
            />
          </FieldBox>
        </div>
        <FieldBox label={t("veh.rateMode")}>
          <Segmented
            label={t("veh.rateMode")}
            value={s.rateMode}
            options={[
              ["FIXED", t("veh.FIXED")],
              ["PER_QTL", t("veh.PER_QTL")],
            ]}
            onChange={(rateMode) => set({ rateMode })}
            testId="trip-rate-mode"
          />
        </FieldBox>
        {s.rateMode === "PER_QTL" ? (
          <FieldBox label={t("veh.qty")} error={showErrors && qty?.error ? t(qty.error) : null}>
            <WeightBlockInput
              value={s.qty}
              onChange={(q) => set({ qty: q })}
              monKg={monKg}
              deductionsEnabled={false}
              testId="trip-qty"
            />
          </FieldBox>
        ) : null}
        <AmountInput
          label={t(s.rateMode === "FIXED" ? "veh.fixedAmount" : "veh.ratePerQtl")}
          value={s.rate}
          onChange={(r) => set({ rate: r })}
          allowZero
          testId="trip-rate"
        />
        <div className="bg-card shadow-card flex flex-col rounded-2xl border p-4">
          <span className="text-muted-foreground text-sm">{t("veh.income")}</span>
          <span className="tabular text-3xl font-semibold" data-testid="trip-income">
            {money(income)}
          </span>
        </div>
        {existing ? null : (
          <section className="bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4">
            <PaymentFields
              godownId={godown._id}
              value={s.pay}
              onChange={(pay) => set({ pay })}
              amountLabel={t("veh.advance")}
              hint={t("mill.payHint")}
              testId="trip-pay"
              allowZero
            />
            <div className="bg-forest-100/60 flex items-center justify-between rounded-xl px-3 py-2">
              <span className="text-forest text-sm">{t("sl.remainingDue")}</span>
              <span className="tabular text-forest text-lg font-semibold" data-testid="trip-due">
                {money(income - received)}
              </span>
            </div>
          </section>
        )}
        <DateField
          label={t("veh.dueDate")}
          value={s.dueDate}
          onChange={(dueDate) => set({ dueDate })}
          allowFuture
        />

        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">{t("veh.costs")}</h2>
          {s.costs.map((c, i) => (
            <div
              key={c.id}
              className="bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4"
              data-testid={`trip-cost-${c.kind}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{t(`veh.cost.${c.kind}`)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={t("veh.removeCost")}
                  onClick={() => set({ costs: s.costs.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <AmountInput
                  label={t("pay.amount")}
                  value={c.amount}
                  onChange={(amount) => setCost(i, { amount })}
                  allowZero
                  testId={`trip-cost-${c.kind}-amount`}
                />
                {c.kind === "DIESEL" ? (
                  <FieldBox label={t("veh.litres")}>
                    <Input
                      className="h-12 text-base"
                      inputMode="decimal"
                      value={c.litres}
                      onChange={(e) => setCost(i, { litres: e.target.value })}
                    />
                  </FieldBox>
                ) : (
                  <FieldBox label={t("veh.payee")}>
                    <Input
                      className="h-12 text-base"
                      value={c.payee}
                      onChange={(e) => setCost(i, { payee: e.target.value })}
                    />
                  </FieldBox>
                )}
              </div>
              {existing ? null : (
                <>
                  <label className="flex min-h-11 items-center gap-3 text-[15px]">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={c.paidNow}
                      onChange={(e) => setCost(i, { paidNow: e.target.checked })}
                    />
                    {t("veh.paidNow")}
                  </label>
                  {c.paidNow ? (
                    <PaymentFields
                      godownId={godown._id}
                      value={c.pay}
                      onChange={(pay) => setCost(i, { pay })}
                      amountLabel={t("pay.amount")}
                      hideAmount
                      testId={`trip-cost-${c.kind}-pay`}
                    />
                  ) : null}
                </>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            className="h-11 self-start"
            onClick={() => set({ costs: [...s.costs, costRow("OTHER", s.date)] })}
          >
            <Plus className="size-4" aria-hidden />
            {t("veh.addCost")}
          </Button>
        </section>
        <div
          className="bg-forest-100/60 text-forest flex flex-col rounded-2xl p-4"
          data-testid="trip-formula"
        >
          <span className="text-sm">{t("veh.net")}</span>
          <span className="tabular text-2xl font-semibold">{money(net)}</span>
          <span className="tabular text-xs">
            {t("veh.netFormula", {
              income: money(income),
              driver: money(
                costAmounts.reduce((a, x, i) => (s.costs[i]!.kind === "DRIVER" ? a + x : a), 0n),
              ),
              diesel: money(
                costAmounts.reduce((a, x, i) => (s.costs[i]!.kind === "DIESEL" ? a + x : a), 0n),
              ),
              other: money(
                costAmounts.reduce((a, x, i) => (s.costs[i]!.kind === "OTHER" ? a + x : a), 0n),
              ),
            })}
          </span>
        </div>
        <FieldBox label={t("mill.notes")}>
          <VoiceText value={s.notes} onChange={(notes) => set({ notes })} />
        </FieldBox>
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

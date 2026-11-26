"use client";

/**
 * New / edit sale (requirement_v2 §12.3): buyer or mill (+ create inline), date, product (ধান /
 * চাল), variety, bag-wise or total weight, rate → total (tap: formula), advance received (IN
 * payment, isInitial), remaining due + due date, vehicle, driver, delivery status, source (Gola /
 * direct delivery from a purchase / mill), optional charges (noted only, D4), notes; saved as
 * Confirmed (default; stock out once) or Order (no effect until confirmed). Stock going negative
 * needs "তবুও সেভ করুন" (§9.3). One transaction: sale + advance (one op group).
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { FormShell } from "@/components/forms/FormShell";
import { AmountInput, RateInput } from "@/components/money/inputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceText } from "@/components/voice/VoiceText";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useBusiness, useGodownSettings } from "@/client/hooks";
import { openTransitPurchases, stockAvailable } from "@/client/queries/sales";
import { linkFromLoadItem, newId, saveBillWithInitialPayment, type DraftOf } from "@/client/repo";
import { paiseToInput, parseAmountField, parseRateField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import { DELIVERY_STATUSES, type DocOf, type Godown, type Sale } from "@/domain/schemas";
import { formatWeightNumber } from "@/domain/units";
import { computeBill } from "@/domain/v2/weightBlock";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { DateField, FieldBox, PartyPicker, Segmented } from "@/components/entry/Fields";
import { DueDateField } from "@/components/entry/DueDate";
import { checkDueDate } from "@/domain/v2/dueDate";
import { VarietyPicker } from "@/components/entry/Variety";
import { emptyPay, PaymentFields, toPart, type PayState } from "@/components/entry/Payments";
import {
  emptyWeight,
  parseWeightState,
  weightFromBlock,
  WeightBlockInput,
  type WeightState,
} from "@/components/entry/WeightBlockInput";

type Load = DocOf<"LOAD">;
type Source = Sale["source"];
type Delivery = Sale["deliveryStatus"];

interface State {
  partyId?: string;
  date: string;
  product: "PADDY" | "RICE";
  varietyId?: string;
  weight: WeightState;
  rate: string;
  pay: PayState;
  dueDate: string;
  vehicle: string;
  driver: string;
  delivery: Delivery;
  source: Source;
  millId?: string;
  transitGroup?: string;
  loading: string;
  freight: string;
  vehicleAdvance: string;
  notes: string;
  saleStatus: Sale["saleStatus"];
}

function initial(existing?: Sale, load?: Load): State {
  if (existing) {
    return {
      partyId: existing.partyId,
      date: existing.transactionDate,
      product: existing.product,
      varietyId: existing.varietyId,
      weight: weightFromBlock(existing.weight),
      rate: paiseToInput(existing.ratePaisePerQtl),
      pay: emptyPay(existing.transactionDate),
      dueDate: existing.dueDate ?? "",
      vehicle: existing.vehicleNumber ?? "",
      driver: existing.driverName ?? "",
      delivery: existing.deliveryStatus,
      source: existing.source,
      ...(existing.sourceMillId ? { millId: existing.sourceMillId } : {}),
      ...(existing.source === "TRANSIT" && existing.groupId
        ? { transitGroup: existing.groupId }
        : {}),
      loading: existing.charges?.loadingPaise ? paiseToInput(existing.charges.loadingPaise) : "",
      freight: existing.charges?.freightPaise ? paiseToInput(existing.charges.freightPaise) : "",
      vehicleAdvance: existing.charges?.vehicleAdvancePaise
        ? paiseToInput(existing.charges.vehicleAdvancePaise)
        : "",
      notes: existing.notes ?? "",
      saleStatus: existing.saleStatus,
    };
  }
  const today = todayIST();
  const date = load?.transactionDate ?? today;
  return {
    date,
    product: "PADDY",
    ...(load?.destinationMillId ? { partyId: load.destinationMillId } : {}),
    ...(load ? { varietyId: load.varietyId } : {}),
    weight: load ? weightFromBlock(load.weight) : emptyWeight("BAGS"),
    rate: load && load.ratePaisePerQtl !== "0" ? paiseToInput(load.ratePaisePerQtl) : "",
    pay: emptyPay(date, "0"),
    dueDate: "",
    vehicle: load?.vehicleNumber ?? "",
    driver: load?.driverName ?? "",
    delivery: "PENDING",
    source: "WAREHOUSE",
    loading: "",
    freight: "",
    vehicleAdvance: "",
    notes: "",
    saleStatus: "CONFIRMED",
  };
}

const optionalPaise = (s: string): string | undefined => {
  const r = parseAmountField(s, false, 0n);
  return r.value && r.value > 0n ? r.value.toString() : undefined;
};

export function SaleForm({
  godown,
  existing,
  fromLoad,
}: {
  godown: Godown;
  existing?: Sale;
  /** Create this sale from a load khata entry (prefilled, linked 1:1, §12.5). */
  fromLoad?: Load;
}) {
  const { t, money, digits, date } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const settings = useGodownSettings(godown._id);
  const monKg = business?.monKg ?? 40;
  const deductions = business?.settings.deductionsEnabled ?? false;
  const [s, setS] = useState<State>(() => initial(existing, fromLoad));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [showFormula, setShowFormula] = useState(false);
  const [stockWarn, setStockWarn] = useState<{ have: bigint; need: bigint } | null>(null);
  const [more, setMore] = useState(
    !!existing && (existing.source !== "WAREHOUSE" || !!existing.charges),
  );
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
  const rate = parseRateField(s.rate, true, 1n);
  const bill =
    w.result && rate.value !== undefined
      ? computeBill(w.result.netG, rate.value, settings?.rounding.roundToRupee ?? false)
      : undefined;
  const payPart = existing ? { part: null } : toPart(s.pay, true, s.date);
  const dueCheck = checkDueDate(existing ? undefined : s.dueDate || undefined, s.date, todayIST());
  const received = payPart.part ? BigInt(payPart.part.amountPaise) : 0n;
  const due = bill ? bill.totalPaise - received : undefined;
  const source: Source = s.product === "RICE" ? "WAREHOUSE" : s.source;

  const transit = useLiveQuery(
    () =>
      source === "TRANSIT"
        ? openTransitPurchases(godown._id, existing?.groupId)
        : Promise.resolve([]),
    [godown._id, source, existing?.groupId],
  );
  const available = useLiveQuery(async () => {
    if (!s.varietyId || source === "TRANSIT") return undefined;
    if (source === "MILL" && !s.millId) return undefined;
    return stockAvailable(
      godown._id,
      {
        product: s.product,
        location: source,
        varietyId: s.varietyId,
        ...(source === "MILL" && s.millId ? { millPartyId: s.millId } : {}),
      },
      undefined,
      existing?._id,
    );
  }, [godown._id, s.product, source, s.varietyId, s.millId, existing?._id]);

  const lastRate = useLiveQuery(async () => {
    if (!s.partyId || existing) return undefined;
    const last = await db()
      .vouchers.where("[godownId+partyId]")
      .equals([godown._id, s.partyId])
      .filter((x) => x.type === "SALE" && x.status === "active")
      .last();
    return last && last.type === "SALE" ? last : undefined;
  }, [s.partyId, godown._id]);

  const save = async (anyway: boolean) => {
    setShowErrors(true);
    setError(null);
    if (!s.partyId || !s.varietyId || !w.block || rate.value === undefined || !bill) {
      setError(t("acct.required"));
      return;
    }
    if (source === "MILL" && !s.millId) return setError(t("errors.domain.MILL_REQUIRED"));
    if (source === "TRANSIT" && !s.transitGroup) return setError(t("acct.required"));
    if (payPart.error) return setError(t(payPart.error));
    if (dueCheck.error) return setError(t("errors.domain.DUE_BEFORE_DEAL"));
    if (received > bill.totalPaise) return setError(t("errors.domain.OVERPAYMENT"));
    if (
      !anyway &&
      s.saleStatus === "CONFIRMED" &&
      available !== undefined &&
      w.result &&
      w.result.netG > available
    ) {
      setStockWarn({ have: available, need: w.result.netG });
      return;
    }
    setSaving(true);
    try {
      const loading = optionalPaise(s.loading);
      const freight = optionalPaise(s.freight);
      const vAdv = optionalPaise(s.vehicleAdvance);
      const charges =
        loading || freight || vAdv
          ? {
              ...(loading ? { loadingPaise: loading } : {}),
              ...(freight ? { freightPaise: freight } : {}),
              ...(vAdv ? { vehicleAdvancePaise: vAdv } : {}),
            }
          : undefined;
      const deliveryChanged = !existing || existing.deliveryStatus !== s.delivery;
      const log = existing?.deliveryLog ?? [];
      const saleId = existing?._id ?? newId();
      const draft: DraftOf<"SALE"> = {
        type: "SALE",
        ...(existing ? {} : { _id: saleId }),
        transactionDate: s.date,
        partyId: s.partyId,
        product: s.product,
        varietyId: s.varietyId,
        source,
        ...(source === "MILL" && s.millId ? { sourceMillId: s.millId } : {}),
        ...(source === "TRANSIT" && s.transitGroup ? { groupId: s.transitGroup } : {}),
        weight: w.block,
        ratePaisePerQtl: rate.value.toString(),
        amountPaise: "0",
        ...(settings?.rounding.roundToRupee ? { roundToRupee: true } : {}),
        roundOffPaise: "0",
        totalPaise: "0",
        saleStatus: s.saleStatus,
        deliveryStatus: s.delivery,
        deliveryLog:
          deliveryChanged && (existing || s.delivery !== "PENDING")
            ? [...log, { status: s.delivery, at: new Date().toISOString() }]
            : log,
        ...(s.vehicle.trim() ? { vehicleNumber: s.vehicle.trim().toUpperCase() } : {}),
        ...(s.driver.trim() ? { driverName: s.driver.trim() } : {}),
        ...(!existing && s.dueDate ? { dueDate: s.dueDate } : {}),
        ...(charges ? { charges } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
        ...((existing?.linkedLoadId ?? fromLoad?._id)
          ? { linkedLoadId: existing?.linkedLoadId ?? fromLoad?._id }
          : {}),
        ...(existing?.consignmentDispatchId
          ? { consignmentDispatchId: existing.consignmentDispatchId }
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
                  await linkFromLoadItem(godown._id, fromLoad._id, { type: "SALE", id: saleId }),
                ],
              }
            : {},
      );
      setDirty(false);
      if (existing) router.replace(`/sales/view?id=${existing._id}`);
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
        data-testid="sale-saved"
      >
        <CheckCircle2
          className="animate-in zoom-in-50 size-16 text-emerald-600 duration-300"
          aria-hidden
        />
        <p className="text-xl font-semibold">{t("sl.saved")}</p>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Button className="h-12 text-base" onClick={() => router.push(`/print/sale?id=${saved}`)}>
            {t("sl.printInvoice")}
          </Button>
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => {
              setS(initial());
              setSaved(null);
              setShowErrors(false);
            }}
            data-testid="sale-add-another"
          >
            {t("sl.addAnother")}
          </Button>
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => router.replace(`/sales/view?id=${saved}`)}
            data-testid="sale-open-detail"
          >
            {t("sl.openDetail")}
          </Button>
        </div>
      </div>
    );
  }

  const qtl = w.result ? formatWeightNumber(w.result.netG, "QTL", o) : "";
  return (
    <FormShell
      title={t(existing ? "sl.editTitle" : "sl.newTitle", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save(false)}
      saveLabel={t("sl.save")}
      testId="sale-form"
      backHref="/sales"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t("sl.total")}</span>
          <span
            className="tabular text-lg font-semibold"
            data-testid="sale-total"
            data-paise={bill?.totalPaise.toString() ?? ""}
          >
            {bill ? money(bill.totalPaise) : "—"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <PartyPicker
          godownId={godown._id}
          roles={["CUSTOMER", "MILL"]}
          createRole="CUSTOMER"
          value={s.partyId}
          onChange={(partyId) => set({ partyId })}
          label={t("sl.buyer")}
          testId="sale-party"
          error={showErrors && !s.partyId ? t("acct.required") : null}
        />
        <DateField
          label={t("sl.date")}
          value={s.date}
          onChange={(d) => set({ date: d })}
          testId="sale-date"
        />
        <FieldBox label={t("sl.product")}>
          <Segmented
            label={t("sl.product")}
            value={s.product}
            options={[
              ["PADDY", t("sl.PADDY")],
              ["RICE", t("sl.RICE")],
            ]}
            onChange={(product) => set({ product, varietyId: undefined })}
            testId="sale-product"
          />
        </FieldBox>
        <VarietyPicker
          godownId={godown._id}
          value={s.varietyId}
          onChange={(varietyId) => set({ varietyId })}
          product={s.product}
          testId="sale-variety"
          error={showErrors && !s.varietyId ? t("acct.required") : null}
        />
        {available !== undefined ? (
          <p className="text-muted-foreground -mt-3 text-xs" data-testid="sale-stock-now">
            {t("sl.stockNow", { qty: formatWeightNumber(available, "QTL", o) })}
          </p>
        ) : null}
        <FieldBox label={t("sl.quantity")} error={showErrors && w.error ? t(w.error) : null}>
          <WeightBlockInput
            value={s.weight}
            onChange={(weight) => set({ weight })}
            monKg={monKg}
            deductionsEnabled={deductions}
            testId="sale-weight"
          />
        </FieldBox>
        <RateInput
          label={t("sl.rate")}
          value={s.rate}
          onChange={(r) => set({ rate: r })}
          required
          testId="sale-rate"
          hint={lastRate ? money(BigInt(lastRate.ratePaisePerQtl)) : undefined}
        />
        <button
          type="button"
          className="bg-card shadow-card flex flex-col items-start rounded-2xl border p-4 text-left"
          onClick={() => setShowFormula((x) => !x)}
          aria-expanded={showFormula}
        >
          <span className="text-muted-foreground text-sm">{t("sl.total")}</span>
          <span className="tabular text-3xl font-semibold" data-testid="sale-total-big">
            {bill ? money(bill.totalPaise) : "—"}
          </span>
          {showFormula && bill && rate.value !== undefined ? (
            <span className="text-muted-foreground tabular mt-1 text-sm" data-testid="sale-formula">
              {qtl} {t("ui.unitQtlShort")} × {money(rate.value)} = {money(bill.amountPaise)}
              {bill.roundOffPaise !== 0n ? ` (${money(bill.roundOffPaise)})` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">{t("ui.showCalc")}</span>
          )}
        </button>
        {existing ? null : (
          <section className="bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4">
            <PaymentFields
              godownId={godown._id}
              value={s.pay}
              onChange={(pay) => set({ pay })}
              amountLabel={t("sl.advance")}
              hint={t("sl.advanceHint")}
              testId="sale-pay"
              allowZero
              minDate={s.date}
            />
            <div className="bg-forest-100/60 flex items-center justify-between rounded-xl px-3 py-2">
              <span className="text-forest text-sm">{t("sl.remainingDue")}</span>
              <span className="tabular text-forest text-lg font-semibold" data-testid="sale-due">
                {due !== undefined ? money(due) : "—"}
              </span>
            </div>
            <DueDateField
              label={t("sl.dueDate")}
              value={s.dueDate}
              onChange={(dueDate) => set({ dueDate })}
              dealDate={s.date}
              dealType="SALE"
              testId="sale-due-date"
            />
          </section>
        )}
        <FieldBox label={t("sl.saveAs")} hint={s.saleStatus === "ORDER" ? t("sl.orderHint") : null}>
          <Segmented
            label={t("sl.saveAs")}
            value={s.saleStatus}
            options={[
              ["CONFIRMED", t("sl.CONFIRMED")],
              ["ORDER", t("sl.ORDER")],
            ]}
            onChange={(saleStatus) => set({ saleStatus })}
            testId="sale-status"
          />
        </FieldBox>
        <FieldBox label={t("sl.deliveryStatus")}>
          <div
            className="grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-label={t("sl.deliveryStatus")}
          >
            {DELIVERY_STATUSES.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={s.delivery === d}
                onClick={() => set({ delivery: d })}
                data-testid={`sale-delivery-${d}`}
                className={cn("choice min-h-12 px-3 text-sm")}
              >
                {t(`sl.delivery.${d}` as TKey)}
              </button>
            ))}
          </div>
        </FieldBox>
        <div className="grid grid-cols-2 gap-3">
          <FieldBox label={t("sl.vehicle")}>
            <Input
              className="h-12 text-base uppercase"
              value={s.vehicle}
              onChange={(e) => set({ vehicle: e.target.value })}
              data-testid="sale-vehicle"
            />
          </FieldBox>
          <FieldBox label={t("sl.driver")}>
            <Input
              className="h-12 text-base"
              value={s.driver}
              onChange={(e) => set({ driver: e.target.value })}
            />
          </FieldBox>
        </div>
        <FieldBox label={t("sl.notes")}>
          <VoiceText value={s.notes} onChange={(notes) => set({ notes })} />
        </FieldBox>
        <details
          open={more}
          onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}
          className="rounded-xl border p-3"
        >
          <summary className="min-h-11 cursor-pointer content-center text-[15px] font-medium">
            {t("sl.more")}
          </summary>
          <div className="mt-2 flex flex-col gap-4">
            {s.product === "PADDY" ? (
              <FieldBox label={t("sl.source")}>
                <Segmented
                  label={t("sl.source")}
                  value={s.source}
                  // v2.1: paddy at a mill is the mill's to pay for (settled on its dispatch), so a
                  // new sale can't come "from the mill"; an old record keeps showing its source.
                  options={[
                    ["WAREHOUSE", t("sl.srcWAREHOUSE")],
                    ["TRANSIT", t("sl.srcTRANSIT")],
                    ...(existing?.source === "MILL"
                      ? [["MILL", t("sl.srcMILL")] as ["MILL", string]]
                      : []),
                  ]}
                  onChange={(src) => set({ source: src })}
                  testId="sale-source"
                />
              </FieldBox>
            ) : null}
            {source === "MILL" ? (
              <PartyPicker
                godownId={godown._id}
                roles={["MILL"]}
                createRole="MILL"
                value={s.millId}
                onChange={(millId) => set({ millId })}
                label={t("sl.mill")}
                testId="sale-mill"
              />
            ) : null}
            {source === "TRANSIT" ? (
              <FieldBox label={t("sl.transitPick")}>
                {transit && transit.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t("sl.noTransit")}</p>
                ) : (
                  <div className="flex flex-col gap-2" role="radiogroup">
                    {(transit ?? []).map((r) => {
                      const g = r.doc.groupId ?? r.doc._id;
                      return (
                        <button
                          key={r.doc._id}
                          type="button"
                          role="radio"
                          aria-checked={s.transitGroup === g}
                          onClick={() => set({ transitGroup: g, varietyId: r.doc.varietyId })}
                          className={cn("choice min-h-12 px-3 text-left text-sm")}
                        >
                          {t("sl.transitLeft", {
                            party: r.party?.name ?? "",
                            date: date(r.doc.transactionDate, "short"),
                            qty: formatWeightNumber(r.leftG, "QTL", o),
                          })}
                        </button>
                      );
                    })}
                  </div>
                )}
              </FieldBox>
            ) : null}
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium">{t("sl.charges")}</legend>
              <p className="text-muted-foreground text-xs">{t("sl.chargesHint")}</p>
              <div className="grid grid-cols-3 gap-2">
                <AmountInput
                  label={t("sl.loading")}
                  value={s.loading}
                  onChange={(loading) => set({ loading })}
                  allowZero
                />
                <AmountInput
                  label={t("sl.freight")}
                  value={s.freight}
                  onChange={(freight) => set({ freight })}
                  allowZero
                />
                <AmountInput
                  label={t("sl.vehicleAdvance")}
                  value={s.vehicleAdvance}
                  onChange={(vehicleAdvance) => set({ vehicleAdvance })}
                  allowZero
                />
              </div>
            </fieldset>
          </div>
        </details>
        {stockWarn ? (
          <div
            className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            role="alert"
            data-testid="sale-stock-warning"
          >
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("sl.stockWarn", {
                have: formatWeightNumber(stockWarn.have, "QTL", o),
                need: formatWeightNumber(stockWarn.need, "QTL", o),
              })}
            </span>
            <Button
              variant="outline"
              className="h-11 bg-white"
              onClick={() => void save(true)}
              data-testid="sale-save-anyway"
            >
              {t("sl.saveAnyway")}
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

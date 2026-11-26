"use client";

/**
 * New / edit purchase (requirement_v2 §12.2): farmer (+ mobile), date, variety, bag-wise or total
 * weight, rate per quintal → total (tap: formula), initial payment (0 = full credit; date, mode,
 * bank + reference), remaining due + optional due date (a reminder only, D54; changed later from
 * the detail page), notes; storage under "আরও". One transaction:
 * purchase + initial payment (one op group). After saving: print receipt · add another · detail.
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { FormShell } from "@/components/forms/FormShell";
import { RateInput } from "@/components/money/inputs";
import { Button } from "@/components/ui/button";
import { VoiceText } from "@/components/voice/VoiceText";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useBusiness, useGodownSettings } from "@/client/hooks";
import { newId, saveBillWithInitialPayment, type DraftOf } from "@/client/repo";
import { parseRateField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import type { Godown, Purchase } from "@/domain/schemas";
import { formatWeightNumber } from "@/domain/units";
import { computeBill } from "@/domain/v2/weightBlock";
import { useI18n } from "@/i18n/I18nProvider";
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
import { paiseToInput } from "@/client/ui/parse";

interface State {
  partyId?: string;
  date: string;
  varietyId?: string;
  weight: WeightState;
  rate: string;
  pay: PayState;
  dueDate: string;
  notes: string;
  storeAt: "WAREHOUSE" | "TRANSIT";
}

function initial(existing?: Purchase): State {
  if (existing) {
    return {
      partyId: existing.partyId,
      date: existing.transactionDate,
      varietyId: existing.varietyId,
      weight: weightFromBlock(existing.weight),
      rate: paiseToInput(existing.ratePaisePerQtl),
      pay: emptyPay(existing.transactionDate),
      dueDate: existing.dueDate ?? "",
      notes: existing.notes ?? "",
      storeAt: existing.storeAt,
    };
  }
  const today = todayIST();
  return {
    date: today,
    weight: emptyWeight("BAGS"),
    rate: "",
    pay: emptyPay(today, "0"),
    dueDate: "",
    notes: "",
    storeAt: "WAREHOUSE",
  };
}

export function PurchaseForm({ godown, existing }: { godown: Godown; existing?: Purchase }) {
  const { t, money, digits } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const settings = useGodownSettings(godown._id);
  const monKg = business?.monKg ?? 40;
  const deductions = business?.settings.deductionsEnabled ?? false;
  const [s, setS] = useState<State>(() => initial(existing));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [showFormula, setShowFormula] = useState(false);
  const [more, setMore] = useState(existing?.storeAt === "TRANSIT");
  const set = (patch: Partial<State>) => {
    setS((x) => ({
      ...x,
      ...patch,
      ...(patch.date && !existing && x.pay.date === x.date
        ? { pay: { ...x.pay, date: patch.date } }
        : {}),
    }));
    setDirty(true);
  };

  const w = parseWeightState(s.weight, monKg, deductions);
  const rate = parseRateField(s.rate, true, 1n);
  const bill =
    w.result && rate.value !== undefined
      ? computeBill(w.result.netG, rate.value, settings?.rounding.roundToRupee ?? false)
      : undefined;
  const payPart = existing ? { part: null } : toPart(s.pay, true, s.date);
  const dueCheck = checkDueDate(existing ? undefined : s.dueDate || undefined, s.date, todayIST());
  const paid = payPart.part ? BigInt(payPart.part.amountPaise) : 0n;
  const due = bill ? bill.totalPaise - paid : undefined;

  const lastRate = useLiveQuery(async () => {
    if (!s.partyId || existing) return undefined;
    const last = await db()
      .vouchers.where("[godownId+partyId]")
      .equals([godown._id, s.partyId])
      .filter((x) => x.type === "PURCHASE" && x.status === "active")
      .last();
    return last && last.type === "PURCHASE" ? last : undefined;
  }, [s.partyId, godown._id]);

  const save = async () => {
    setShowErrors(true);
    setError(null);
    if (!s.partyId || !s.varietyId || !w.block || rate.value === undefined || !bill) {
      setError(t("acct.required"));
      return;
    }
    if (payPart.error) return setError(t(payPart.error));
    if (dueCheck.error) return setError(t("errors.domain.DUE_BEFORE_DEAL"));
    if (paid > bill.totalPaise) return setError(t("errors.domain.OVERPAYMENT"));
    setSaving(true);
    try {
      const draft: DraftOf<"PURCHASE"> = {
        type: "PURCHASE",
        ...(existing ? {} : { _id: newId() }),
        transactionDate: s.date,
        partyId: s.partyId,
        varietyId: s.varietyId,
        storeAt: s.storeAt,
        weight: w.block,
        ratePaisePerQtl: rate.value.toString(),
        amountPaise: "0",
        ...(settings?.rounding.roundToRupee ? { roundToRupee: true } : {}),
        roundOffPaise: "0",
        totalPaise: "0",
        ...(!existing && s.dueDate ? { dueDate: s.dueDate } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
        ...(existing?.linkedLoadId ? { linkedLoadId: existing.linkedLoadId } : {}),
        ...(existing?.legacyCharges ? { legacyCharges: existing.legacyCharges } : {}),
      };
      const r = await saveBillWithInitialPayment(
        godown._id,
        draft,
        payPart.part,
        existing ? { id: existing._id } : {},
      );
      setDirty(false);
      if (existing) router.replace(`/purchase/view?id=${existing._id}`);
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
        data-testid="purchase-saved"
      >
        <CheckCircle2
          className="animate-in zoom-in-50 size-16 text-emerald-600 duration-300"
          aria-hidden
        />
        <p className="text-xl font-semibold">{t("pur.saved")}</p>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Button
            className="h-12 text-base"
            onClick={() => router.push(`/print/purchase?id=${saved}`)}
          >
            {t("pur.printReceipt")}
          </Button>
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => {
              setS(initial());
              setSaved(null);
              setShowErrors(false);
            }}
            data-testid="purchase-add-another"
          >
            {t("pur.addAnother")}
          </Button>
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => router.replace(`/purchase/view?id=${saved}`)}
            data-testid="purchase-open-detail"
          >
            {t("pur.openDetail")}
          </Button>
        </div>
      </div>
    );
  }

  const qtl = w.result ? formatWeightNumber(w.result.netG, "QTL", { digits, monKg }) : "";
  return (
    <FormShell
      title={t(existing ? "pur.editTitle" : "pur.newTitle", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      saveLabel={t("pur.save")}
      testId="purchase-form"
      backHref="/purchase"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t("pur.total")}</span>
          <span
            className="tabular text-lg font-semibold"
            data-testid="purchase-total"
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
          roles={["FARMER", "SUPPLIER"]}
          createRole="FARMER"
          value={s.partyId}
          onChange={(partyId) => set({ partyId })}
          label={t("pur.farmer")}
          testId="purchase-party"
          error={showErrors && !s.partyId ? t("acct.required") : null}
        />
        <DateField
          label={t("pur.date")}
          value={s.date}
          onChange={(date) => set({ date })}
          testId="purchase-date"
        />
        <VarietyPicker
          godownId={godown._id}
          value={s.varietyId}
          onChange={(varietyId) => set({ varietyId })}
          testId="purchase-variety"
          error={showErrors && !s.varietyId ? t("acct.required") : null}
        />
        <FieldBox label={t("pur.quantity")} error={showErrors && w.error ? t(w.error) : null}>
          <WeightBlockInput
            value={s.weight}
            onChange={(weight) => set({ weight })}
            monKg={monKg}
            deductionsEnabled={deductions}
            testId="purchase-weight"
          />
        </FieldBox>
        <RateInput
          label={t("pur.rate")}
          value={s.rate}
          onChange={(r) => set({ rate: r })}
          required
          testId="purchase-rate"
          hint={lastRate ? money(BigInt(lastRate.ratePaisePerQtl)) : undefined}
        />
        <button
          type="button"
          className="bg-card shadow-card flex flex-col items-start rounded-2xl border p-4 text-left"
          onClick={() => setShowFormula((x) => !x)}
          aria-expanded={showFormula}
        >
          <span className="text-muted-foreground text-sm">{t("pur.total")}</span>
          <span className="tabular text-3xl font-semibold" data-testid="purchase-total-big">
            {bill ? money(bill.totalPaise) : "—"}
          </span>
          {showFormula && bill && rate.value !== undefined ? (
            <span
              className="text-muted-foreground tabular mt-1 text-sm"
              data-testid="purchase-formula"
            >
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
              amountLabel={t("pur.initialPayment")}
              hint={t("pur.initialHint")}
              testId="purchase-pay"
              allowZero
              minDate={s.date}
            />
            <div className="flex items-center justify-between rounded-xl bg-red-50 px-3 py-2">
              <span className="text-sm text-red-900">{t("pur.remainingDue")}</span>
              <span
                className="tabular text-lg font-semibold text-red-800"
                data-testid="purchase-due"
              >
                {due !== undefined ? money(due) : "—"}
              </span>
            </div>
            <DueDateField
              label={t("pur.dueDate")}
              value={s.dueDate}
              onChange={(dueDate) => set({ dueDate })}
              dealDate={s.date}
              dealType="PURCHASE"
              testId="purchase-due-date"
            />
          </section>
        )}
        <FieldBox label={t("pur.notes")}>
          <VoiceText value={s.notes} onChange={(notes) => set({ notes })} />
        </FieldBox>
        <details
          open={more}
          onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}
          className="rounded-xl border p-3"
        >
          <summary className="min-h-11 cursor-pointer content-center text-[15px] font-medium">
            {t("pur.more")}
          </summary>
          <div className="mt-2">
            <FieldBox label={t("pur.storeAt")}>
              <Segmented
                label={t("pur.storeAt")}
                value={s.storeAt}
                options={[
                  ["WAREHOUSE", t("pur.storeWarehouse")],
                  ["TRANSIT", t("pur.storeTransit")],
                ]}
                onChange={(storeAt) => set({ storeAt })}
              />
            </FieldBox>
          </div>
        </details>
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

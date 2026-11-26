"use client";

/**
 * New / edit expense (requirement_v2 §12.4): title, category, amount, person (party or typed
 * name), expense date, entry date (auto, read-only), payment "এখনই পুরো দিলাম" (default) /
 * "কিছু দিলাম" / "এখনও দিইনি" with the ACTUAL payment date (defaults to the expense date), mode,
 * reference; due date; notes. The expense and its first payment are one op group.
 *
 * Category "কৃষক পেমেন্ট" switches to the farmer-payment flow (§7.3): pick the farmer, then an open
 * purchase or "advance"; it saves a PURCHASE / PARTY_ADVANCE payment — never an expense.
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { FormShell } from "@/components/forms/FormShell";
import { VehiclePicker } from "@/components/vehicles/VehiclePicker";
import { AmountInput } from "@/components/money/inputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceText } from "@/components/voice/VoiceText";
import { errorKey } from "@/client/errors";
import { categoryList, openPurchasesOf } from "@/client/queries/expenses";
import {
  newId,
  payAdvance,
  payBill,
  RepoError,
  saveBillWithInitialPayment,
  type DraftOf,
} from "@/client/repo";
import { paiseToInput, parseAmountField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import type { Expense, Godown } from "@/domain/schemas";
import { FARMER_PAYMENT_CODE } from "@/domain/v2/accounts";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { DateField, FieldBox, PartyPicker, Segmented } from "@/components/entry/Fields";
import { emptyPay, PaymentFields, toPart, type PayState } from "@/components/entry/Payments";
import { lazyToast } from "@/components/system/IdleToaster";
import { categoryName, NewCategorySheet } from "./category";

type PayMode = "FULL" | "PART" | "NONE";

interface State {
  title: string;
  categoryCode?: string;
  amount: string;
  partyId?: string;
  personText: string;
  expenseDate: string;
  payMode: PayMode;
  pay: PayState;
  notes: string;
  /** Optional: the vehicle this expense is for (shown with that vehicle's costs). */
  vehicleId?: string;
  // Farmer-payment flow
  farmerId?: string;
  billId?: string | "ADVANCE";
}

function initial(existing?: Expense): State {
  if (existing) {
    return {
      title: existing.title,
      categoryCode: existing.categoryCode,
      amount: paiseToInput(existing.amountPaise),
      ...(existing.partyId ? { partyId: existing.partyId } : {}),
      personText: existing.personText ?? "",
      expenseDate: existing.expenseDate,
      payMode: "NONE",
      pay: emptyPay(existing.expenseDate),
      notes: existing.notes ?? "",
      ...(existing.vehicleId ? { vehicleId: existing.vehicleId } : {}),
    };
  }
  const today = todayIST();
  return {
    title: "",
    amount: "",
    personText: "",
    expenseDate: today,
    payMode: "FULL",
    pay: emptyPay(today),
    notes: "",
  };
}

export function ExpenseForm({
  godown,
  existing,
  presetCategory,
}: {
  godown: Godown;
  existing?: Expense;
  presetCategory?: string;
}) {
  const { t, money, date } = useI18n();
  const router = useRouter();
  const [s, setS] = useState<State>(() => ({
    ...initial(existing),
    ...(presetCategory && !existing ? { categoryCode: presetCategory } : {}),
  }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [over, setOver] = useState<bigint | null>(null);
  const [newCat, setNewCat] = useState(false);
  const set = (patch: Partial<State>) => {
    setS((x) => ({
      ...x,
      ...patch,
      ...(patch.expenseDate && !existing && x.pay.date === x.expenseDate
        ? { pay: { ...x.pay, date: patch.expenseDate } }
        : {}),
    }));
    setDirty(true);
    setOver(null);
  };
  const cats = useLiveQuery(() => categoryList(godown._id), [godown._id]);
  const isFarmer = s.categoryCode === FARMER_PAYMENT_CODE;
  const bills = useLiveQuery(
    () => (isFarmer && s.farmerId ? openPurchasesOf(godown._id, s.farmerId) : Promise.resolve([])),
    [godown._id, isFarmer, s.farmerId],
  );

  const amount = parseAmountField(s.amount, true, 1n);
  const part =
    s.payMode === "NONE" || existing
      ? { part: null as null }
      : toPart(s.payMode === "FULL" ? { ...s.pay, amount: s.amount } : s.pay, false);
  const paid = part.part ? BigInt(part.part.amountPaise) : 0n;
  const left = amount.value !== undefined ? amount.value - paid : undefined;

  const saveExpense = async () => {
    if (!s.title.trim() || !s.categoryCode || amount.value === undefined) {
      return setError(t("acct.required"));
    }
    if (part.error) return setError(t(part.error));
    if (paid > amount.value) return setError(t("errors.domain.OVERPAYMENT"));
    setSaving(true);
    try {
      const draft: DraftOf<"EXPENSE"> = {
        type: "EXPENSE",
        ...(existing ? {} : { _id: newId() }),
        title: s.title.trim(),
        categoryCode: s.categoryCode,
        amountPaise: amount.value.toString(),
        ...(s.partyId ? { partyId: s.partyId } : {}),
        ...(!s.partyId && s.personText.trim() ? { personText: s.personText.trim() } : {}),
        expenseDate: s.expenseDate,
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
        ...(s.vehicleId ? { vehicleId: s.vehicleId } : {}),
        ...(existing?.linkedTripId ? { linkedTripId: existing.linkedTripId } : {}),
      };
      const r = await saveBillWithInitialPayment(
        godown._id,
        draft,
        part.part,
        existing ? { id: existing._id } : {},
      );
      setDirty(false);
      if (existing) router.replace(`/expenses/view?id=${existing._id}`);
      else setSaved(r.bill._id);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };

  const saveFarmer = async (extraAsAdvance: boolean) => {
    if (!s.farmerId || !s.billId) return setError(t("acct.required"));
    const r = toPart(s.pay, false);
    if (r.error || !r.part) return setError(t(r.error ?? "acct.required"));
    setSaving(true);
    try {
      if (s.billId === "ADVANCE") {
        await payAdvance(godown._id, s.farmerId, "OUT", r.part);
      } else {
        const bill = bills?.find((b) => b.doc._id === s.billId);
        if (!bill) return setError(t("acct.required"));
        await payBill(godown._id, bill.doc, r.part, { extraAsAdvance });
      }
      setDirty(false);
      lazyToast(t("xp.farmerSaved"), "success");
      router.replace("/expenses");
    } catch (e) {
      if (e instanceof RepoError && e.code === "OVERPAYMENT") setOver(BigInt(e.detail ?? "0"));
      else setError(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    setShowErrors(true);
    setError(null);
    void (isFarmer ? saveFarmer(false) : saveExpense());
  };

  if (saved) {
    return (
      <div
        className="bg-background fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 p-6 text-center"
        data-testid="expense-saved"
      >
        <CheckCircle2
          className="animate-in zoom-in-50 size-16 text-emerald-600 duration-300"
          aria-hidden
        />
        <p className="text-xl font-semibold">{t("xp.saved")}</p>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Button
            className="h-12 text-base"
            onClick={() => {
              setS(initial());
              setSaved(null);
              setShowErrors(false);
            }}
            data-testid="expense-add-another"
          >
            {t("xp.addAnother")}
          </Button>
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => router.replace(`/expenses/view?id=${saved}`)}
            data-testid="expense-open-detail"
          >
            {t("xp.openDetail")}
          </Button>
        </div>
      </div>
    );
  }

  const shownCats = (cats ?? []).filter(
    (c) =>
      (c.enabled || c.code === s.categoryCode) && (!existing || c.code !== FARMER_PAYMENT_CODE),
  );
  return (
    <FormShell
      title={t(existing ? "xp.editTitle" : "xp.newTitle", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={save}
      saveLabel={isFarmer ? t("xp.farmerSave") : t("xp.save")}
      testId="expense-form"
      backHref="/expenses"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">
            {isFarmer ? t("pay.amount") : t("xp.amount")}
          </span>
          <span className="tabular text-lg font-semibold" data-testid="expense-total">
            {isFarmer
              ? (() => {
                  const a = parseAmountField(s.pay.amount, false, 1n).value;
                  return a ? money(a) : "—";
                })()
              : amount.value !== undefined
                ? money(amount.value)
                : "—"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <FieldBox
          label={t("xp.category")}
          error={showErrors && !s.categoryCode ? t("acct.required") : null}
        >
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("xp.category")}>
            {shownCats.map((c) => (
              <button
                key={c._id}
                type="button"
                role="radio"
                aria-checked={s.categoryCode === c.code}
                onClick={() => set({ categoryCode: c.code })}
                data-testid={`expense-cat-${c.code}`}
                className={cn(
                  "chip min-h-11",
                  c.code === FARMER_PAYMENT_CODE &&
                    s.categoryCode !== c.code &&
                    "bg-gold-100 border-gold-300",
                )}
              >
                {categoryName(c, t)}
              </button>
            ))}
            {existing ? null : (
              <button
                type="button"
                onClick={() => setNewCat(true)}
                className="press text-primary flex min-h-11 items-center gap-1 rounded-full border border-dashed px-4 text-sm"
                data-testid="expense-cat-new"
              >
                <Plus className="size-4" aria-hidden />
                {t("xp.newCategory")}
              </button>
            )}
          </div>
        </FieldBox>

        {isFarmer ? (
          <section className="flex flex-col gap-4" data-testid="farmer-payment">
            <p className="bg-gold-100 text-accent-foreground rounded-xl px-3 py-2 text-sm">
              {t("xp.farmerHint")}
            </p>
            <PartyPicker
              godownId={godown._id}
              roles={["FARMER", "SUPPLIER"]}
              createRole="FARMER"
              value={s.farmerId}
              onChange={(farmerId) => set({ farmerId, billId: undefined })}
              label={t("xp.farmer")}
              testId="farmer-pay-party"
              error={showErrors && !s.farmerId ? t("acct.required") : null}
            />
            {s.farmerId ? (
              <FieldBox label={t("xp.whichBill")}>
                <div className="flex flex-col gap-2" role="radiogroup">
                  {bills && bills.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{t("xp.noOpenBills")}</p>
                  ) : null}
                  {(bills ?? []).map((b, i) => (
                    <button
                      key={b.doc._id}
                      type="button"
                      role="radio"
                      aria-checked={s.billId === b.doc._id}
                      data-testid={`farmer-bill-${i}`}
                      onClick={() =>
                        set({
                          billId: b.doc._id,
                          pay: { ...s.pay, amount: paiseToInput(b.state.duePaise) },
                        })
                      }
                      className={cn(
                        "press tabular min-h-12 rounded-xl border px-3 text-left text-sm",
                        s.billId === b.doc._id ? "border-primary bg-forest-100/60" : "bg-card",
                      )}
                    >
                      {t("xp.billLine", {
                        date: date(b.doc.transactionDate, "short"),
                        number: b.doc.number,
                        due: money(b.state.duePaise),
                      })}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={s.billId === "ADVANCE"}
                    data-testid="farmer-bill-advance"
                    onClick={() => set({ billId: "ADVANCE" })}
                    className={cn("choice min-h-12 px-3 text-left text-sm")}
                  >
                    {t("xp.advanceOption")}
                  </button>
                </div>
              </FieldBox>
            ) : null}
            {s.billId ? (
              <PaymentFields
                godownId={godown._id}
                value={s.pay}
                onChange={(pay) => set({ pay })}
                amountLabel={t("pay.amount")}
                testId="farmer-pay"
              />
            ) : null}
            {over !== null ? (
              <div
                className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                role="alert"
              >
                {t("pay.over", { extra: money(over) })}
                <Button
                  variant="outline"
                  className="h-11 bg-white"
                  onClick={() => void saveFarmer(true)}
                  data-testid="keep-advance"
                >
                  {t("pay.keepAsAdvance")}
                </Button>
              </div>
            ) : null}
          </section>
        ) : (
          <>
            <FieldBox
              label={t("xp.title")}
              error={showErrors && !s.title.trim() ? t("acct.required") : null}
            >
              <VoiceText
                value={s.title}
                placeholder={t("xp.titlePh")}
                onChange={(title) => set({ title })}
                testId="expense-title"
              />
            </FieldBox>
            <AmountInput
              label={t("xp.amount")}
              value={s.amount}
              onChange={(a) => set({ amount: a })}
              required
              testId="expense-amount"
            />
            <DateField
              label={t("xp.expenseDate")}
              value={s.expenseDate}
              onChange={(expenseDate) => set({ expenseDate })}
              testId="expense-date"
            />
            <p className="text-muted-foreground -mt-3 text-xs" data-testid="expense-entry-date">
              {t("xp.entryDate")}: {date(existing?.entryDate ?? todayIST(), "short")}
            </p>
            <PartyPicker
              godownId={godown._id}
              roles={["LABOUR", "DRIVER", "OTHER", "SUPPLIER", "SECOND_PARTY"]}
              createRole="LABOUR"
              value={s.partyId}
              onChange={(partyId) => set({ partyId })}
              label={t("xp.person")}
              testId="expense-party"
            />
            {s.partyId ? null : (
              <FieldBox label={t("xp.personText")}>
                <Input
                  className="h-12 text-base"
                  value={s.personText}
                  onChange={(e) => set({ personText: e.target.value })}
                  data-testid="expense-person-text"
                />
              </FieldBox>
            )}
            {existing ? null : (
              <section className="bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4">
                <FieldBox label={t("xp.payState")}>
                  <Segmented
                    label={t("xp.payState")}
                    value={s.payMode}
                    options={[
                      ["FULL", t("xp.FULL")],
                      ["PART", t("xp.PART")],
                      ["NONE", t("xp.NONE")],
                    ]}
                    onChange={(payMode) => set({ payMode })}
                    testId="expense-paystate"
                  />
                </FieldBox>
                {s.payMode === "PART" ? (
                  <PaymentFields
                    godownId={godown._id}
                    value={s.pay}
                    onChange={(pay) => set({ pay })}
                    amountLabel={t("xp.paidAmount")}
                    testId="expense-pay"
                  />
                ) : s.payMode === "FULL" ? (
                  <PaymentFields
                    godownId={godown._id}
                    value={{ ...s.pay, amount: s.amount }}
                    onChange={(pay) => set({ pay })}
                    amountLabel={t("xp.paidAmount")}
                    testId="expense-pay"
                    hideAmount
                  />
                ) : null}
                <div className="flex items-center justify-between rounded-xl bg-red-50 px-3 py-2">
                  <span className="text-sm text-red-900">{t("xp.unpaidLeft")}</span>
                  <span
                    className="tabular text-lg font-semibold text-red-800"
                    data-testid="expense-left"
                  >
                    {left !== undefined ? money(left) : "—"}
                  </span>
                </div>
              </section>
            )}
            <FieldBox label={t("xp.notes")}>
              <VoiceText value={s.notes} onChange={(notes) => set({ notes })} />
            </FieldBox>
            <VehiclePicker
              godownId={godown._id}
              value={s.vehicleId}
              onChange={(vehicleId) => set({ vehicleId })}
              testId="expense-vehicle"
            />
          </>
        )}
        {error ? (
          <p
            className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
      {newCat ? (
        <NewCategorySheet
          godownId={godown._id}
          onClose={(code) => {
            setNewCat(false);
            if (code) set({ categoryCode: code });
          }}
        />
      ) : null}
    </FormShell>
  );
}

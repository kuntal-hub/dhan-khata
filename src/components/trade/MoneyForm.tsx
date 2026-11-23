"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
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
import { PartyPicker } from "@/components/forms/pickers";
import { Computed } from "@/components/money/display";
import { AmountInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { partyBills } from "@/client/queries/parties";
import { saveMoney, type VoucherDraft } from "@/client/repo";
import { paiseToInput, parseAmountField } from "@/client/ui/parse";
import { useFormDraft } from "@/client/ui/hooks";
import { dot } from "@/client/ui/text";
import { allocateFifo } from "@/domain/allocation";
import { normalizeVehicleNumber, type Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { usePriorBalance, useVoucher } from "./hooks";
import { today, useAfterSave, useGodownTitle, useSaveError } from "./common";

type Kind = "PAYMENT" | "RECEIPT";

interface State {
  partyId?: string;
  date: string;
  amount: string;
  pay: PayModeState;
  theirBank: string;
  cashViaKind: "VEHICLE" | "PERSON";
  cashVia: string;
  tds: string;
  purpose: "BILL" | "ADVANCE" | "OTHER";
  manual: boolean;
  /** voucherId → amount text */
  alloc: Record<string, string>;
  dueDate: string;
  notes: string;
  reason: string;
}

function initialState(kind: Kind, v: Voucher | null, partyId?: string, purpose?: string): State {
  if (v && (v.type === "PAYMENT" || v.type === "RECEIPT")) {
    return {
      partyId: v.partyId,
      date: v.date,
      amount: paiseToInput(v.amountPaise),
      pay: {
        mode: v.mode,
        ...(v.ourBankAccountId ? { bankAccountId: v.ourBankAccountId } : {}),
        ref: v.utrOrRef ?? "",
        chequeNo: v.chequeNo ?? "",
        chequeDate: v.chequeDate ?? "",
      },
      theirBank: v.theirBankText ?? "",
      cashViaKind: v.cashVia?.personName ? "PERSON" : "VEHICLE",
      cashVia: v.cashVia?.personName ?? v.cashVia?.vehicleNumber ?? "",
      tds: v.type === "RECEIPT" ? paiseToInput(v.tdsPaise) : "",
      purpose: v.purpose,
      manual: (v.allocations?.length ?? 0) > 0,
      alloc: Object.fromEntries(
        (v.allocations ?? []).map((a) => [a.voucherId, paiseToInput(a.amountPaise)]),
      ),
      dueDate: v.dueDate ?? "",
      notes: v.notes ?? "",
      reason: "",
    };
  }
  return {
    ...(partyId ? { partyId } : {}),
    date: today(),
    amount: "",
    pay: emptyPayMode(),
    theirBank: "",
    cashViaKind: "VEHICLE",
    cashVia: "",
    tds: "",
    purpose: purpose === "ADVANCE" ? "ADVANCE" : purpose === "OTHER" ? "OTHER" : "BILL",
    manual: false,
    alloc: {},
    dueDate: "",
    notes: "",
    reason: "",
  };
}

/** PAYMENT ("পেমেন্ট দিলাম") / RECEIPT ("টাকা পেলাম") — spec §9.6, §9.8. */
export function MoneyForm({
  kind,
  editId,
  partyId,
  purpose,
}: {
  kind: Kind;
  editId?: string;
  partyId?: string;
  purpose?: string;
}) {
  const { godownId, readOnly } = useWriteGodown();
  const existing = useVoucher(editId);
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || existing === undefined) return <Loading />;
  if (editId && (!existing || (existing.type !== "PAYMENT" && existing.type !== "RECEIPT"))) {
    return <ReadOnlyNotice reason="notFound" />;
  }
  const k: Kind =
    existing && (existing.type === "PAYMENT" || existing.type === "RECEIPT") ? existing.type : kind;
  return (
    <MoneyFormInner
      key={editId ?? `${k}-${partyId ?? ""}-${purpose ?? ""}`}
      kind={k}
      godownId={godownId}
      existing={existing}
      initial={initialState(k, existing, partyId, purpose)}
    />
  );
}

function MoneyFormInner({
  kind,
  godownId,
  existing,
  initial,
}: {
  kind: Kind;
  godownId: string;
  existing: Voucher | null;
  initial: State;
}) {
  const { t, money, date: fmtDate } = useI18n();
  const godownName = useGodownTitle();
  const [s, setS] = useState<State>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const afterSave = useAfterSave();
  const onError = useSaveError();
  const formKey = existing ? `money:edit:${existing._id}` : `money:new:${kind}:${godownId}`;
  const draft = useFormDraft(formKey, s, dirty);
  const update = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const receipt = kind === "RECEIPT";
  const amount = parseAmountField(s.amount, true, 1n);
  const tds = parseAmountField(s.tds, false);
  const prior = usePriorBalance(godownId, s.partyId, existing?.groupId);

  // Open bills of this party (purchases for a payment, sales for a receipt), excluding this voucher.
  const openBills = useLiveQuery(async () => {
    if (!s.partyId) return [];
    const bills = await partyBills(godownId, s.partyId);
    const list = (receipt ? bills.sales : bills.purchases).map((b) => {
      const own =
        existing && (existing.type === "PAYMENT" || existing.type === "RECEIPT")
          ? BigInt(
              existing.allocations?.find((a) => a.voucherId === b.voucherId)?.amountPaise ?? "0",
            )
          : 0n;
      return { ...b, outstandingPaise: b.outstandingPaise + (s.manual ? own : 0n) };
    });
    const vs = await db().vouchers.bulkGet(list.map((b) => b.voucherId));
    return list
      .map((b, i) => ({ bill: b, voucher: vs[i] }))
      .filter((x) => x.bill.outstandingPaise > 0n && x.voucher)
      .sort((a, b) => (a.voucher!.date < b.voucher!.date ? -1 : 1));
  }, [s.partyId, godownId, receipt, existing?._id, s.manual]);

  const fifo =
    amount.value !== undefined && openBills
      ? allocateFifo(
          openBills.map((o) => ({
            voucherId: o.bill.voucherId,
            outstandingPaise: o.bill.outstandingPaise,
          })),
          amount.value + (receipt ? (tds.value ?? 0n) : 0n),
        )
      : null;
  const manualAllocs = Object.entries(s.alloc)
    .map(([id, txt]) => ({ voucherId: id, ...parseAmountField(txt, false) }))
    .filter((a) => a.value !== undefined && a.value > 0n);
  const manualTotal = manualAllocs.reduce((a, x) => a + x.value!, 0n);
  const manualTooMuch =
    s.manual && amount.value !== undefined && manualTotal > amount.value + (tds.value ?? 0n);
  const synced = existing?.serverSeq !== undefined;

  const save = async () => {
    setShowErrors(true);
    if (!s.partyId || amount.error || amount.value === undefined || tds.error || manualTooMuch)
      return;
    if (synced && !s.reason.trim()) return;
    setSaving(true);
    try {
      const viaText = s.cashVia.trim();
      const d = {
        type: kind,
        date: s.date,
        partyId: s.partyId,
        amountPaise: amount.value.toString(),
        mode: s.pay.mode,
        ...(s.pay.mode !== "CASH" && s.pay.bankAccountId
          ? { ourBankAccountId: s.pay.bankAccountId }
          : {}),
        ...(receipt && s.theirBank.trim() ? { theirBankText: s.theirBank.trim() } : {}),
        ...(s.pay.mode !== "CASH" && s.pay.ref.trim() ? { utrOrRef: s.pay.ref.trim() } : {}),
        ...((s.pay.mode === "CHEQUE" || s.pay.mode === "DD") && s.pay.chequeNo.trim()
          ? { chequeNo: s.pay.chequeNo.trim() }
          : {}),
        ...((s.pay.mode === "CHEQUE" || s.pay.mode === "DD") && s.pay.chequeDate
          ? { chequeDate: s.pay.chequeDate }
          : {}),
        ...(s.pay.mode === "CASH" && viaText
          ? {
              cashVia:
                s.cashViaKind === "VEHICLE"
                  ? { vehicleNumber: normalizeVehicleNumber(viaText) }
                  : { personName: viaText },
            }
          : {}),
        ...(receipt && (tds.value ?? 0n) > 0n ? { tdsPaise: tds.value!.toString() } : {}),
        purpose: s.purpose,
        ...(s.manual && manualAllocs.length
          ? {
              allocations: manualAllocs.map((a) => ({
                voucherId: a.voucherId,
                amountPaise: a.value!.toString(),
              })),
            }
          : {}),
        ...(s.purpose === "ADVANCE" && s.dueDate ? { dueDate: s.dueDate } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      } as VoucherDraft;
      const res = await saveMoney(godownId, d, {
        ...(existing ? { id: existing._id } : {}),
        ...(s.reason.trim() ? { reason: s.reason.trim() } : {}),
      });
      setDirty(false);
      await draft.clear();
      afterSave(res.primary._id, "/payment/view");
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  const titleKey = receipt
    ? s.purpose === "ADVANCE"
      ? "payment.advanceTakenTitle"
      : "payment.receiptTitle"
    : s.purpose === "ADVANCE"
      ? "payment.advanceGivenTitle"
      : "payment.paymentTitle";

  return (
    <FormShell
      title={t(titleKey, { godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="money-form"
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
      <PartyPicker
        godownId={godownId}
        label={receipt ? t("payment.fromParty") : t("payment.toParty")}
        value={s.partyId}
        onChange={(partyId) => update({ partyId, alloc: {} })}
        required
        error={showErrors && !s.partyId ? "errors.validation.required" : null}
        testId="money-party"
      />
      {prior ? (
        <p className="text-muted-foreground text-sm" data-testid="money-prior">
          {prior.balancePaise >= 0n
            ? t("payment.partyOwesUs", { amount: money(prior.balancePaise) })
            : t("payment.weOweParty", { amount: money(-prior.balancePaise) })}
        </p>
      ) : null}
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
        testId="money-amount"
      />
      <PayModeFields
        godownId={godownId}
        value={s.pay}
        onChange={(pay) => update({ pay })}
        showCheque={receipt}
        testId="money-mode"
      />
      {receipt ? (
        <TextField
          label={t("payment.theirBank")}
          value={s.theirBank}
          onChange={(theirBank) => update({ theirBank })}
          maxLength={120}
        />
      ) : null}
      {s.pay.mode === "CASH" ? (
        <Section title={t("payment.cashVia")}>
          <Choice
            value={s.cashViaKind}
            onChange={(cashViaKind) => update({ cashViaKind })}
            options={[
              { value: "VEHICLE", label: t("payment.viaVehicle") },
              { value: "PERSON", label: t("payment.viaPerson") },
            ]}
            testId="money-via-kind"
          />
          <TextField
            label={s.cashViaKind === "VEHICLE" ? t("sale.vehicleNumber") : t("payment.personName")}
            value={s.cashVia}
            onChange={(cashVia) => update({ cashVia })}
            maxLength={80}
            testId="money-via"
          />
        </Section>
      ) : null}
      {receipt ? (
        <AmountInput label={t("payment.tds")} value={s.tds} onChange={(x) => update({ tds: x })} />
      ) : null}
      <Choice
        label={t("payment.purpose")}
        value={s.purpose}
        onChange={(purpose) => update({ purpose })}
        options={[
          { value: "BILL", label: t("payment.purposeBill") },
          { value: "ADVANCE", label: t("payment.purposeAdvance") },
          { value: "OTHER", label: t("payment.purposeOther") },
        ]}
        testId="money-purpose"
      />
      {s.purpose === "ADVANCE" ? (
        <DateField
          label={t("payment.advanceDueDate")}
          value={s.dueDate}
          min={s.date}
          optional
          onChange={(dueDate) => update({ dueDate })}
        />
      ) : null}
      {s.purpose === "BILL" && openBills && openBills.length > 0 ? (
        <Section title={t("payment.allocation")}>
          <Choice
            value={s.manual ? "MANUAL" : "FIFO"}
            onChange={(v) => update({ manual: v === "MANUAL" })}
            options={[
              { value: "FIFO", label: t("payment.allocFifo") },
              { value: "MANUAL", label: t("payment.allocManual") },
            ]}
          />
          <ul className="flex flex-col gap-2">
            {openBills.map(({ bill, voucher }) => {
              const auto =
                fifo?.allocations.find((a) => a.voucherId === bill.voucherId)?.amountPaise ?? 0n;
              return (
                <li
                  key={bill.voucherId}
                  className="flex flex-col gap-1 rounded-md border p-2 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {dot(voucher!.number, fmtDate(voucher!.date, "short"))}
                    </span>
                    <span className="tabular">{money(bill.outstandingPaise)}</span>
                  </div>
                  {s.manual ? (
                    <AmountInput
                      label={t("payment.allocThisBill")}
                      value={s.alloc[bill.voucherId] ?? ""}
                      onChange={(v) => update({ alloc: { ...s.alloc, [bill.voucherId]: v } })}
                    />
                  ) : auto > 0n ? (
                    <span className="text-muted-foreground tabular text-xs">
                      {t("payment.allocAuto", { amount: money(auto) })}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {manualTooMuch ? (
            <p className="text-destructive text-xs">{t("payment.allocTooMuch")}</p>
          ) : null}
          {!s.manual && fifo && fifo.unallocated > 0n ? (
            <Computed label={t("payment.unallocated")} value={money(fifo.unallocated)} />
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

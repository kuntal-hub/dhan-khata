"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { FormShell } from "@/components/forms/FormShell";
import { DateField, TextField } from "@/components/forms/fields";
import { BankPicker } from "@/components/forms/pickers";
import { AmountInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { useNames } from "@/components/vouchers/names";
import { db } from "@/client/db/dexie";
import { chequesInHand } from "@/client/queries/cashbank";
import { saveSimple, type VoucherDraft } from "@/client/repo";
import { paiseToInput, parseAmountField } from "@/client/ui/parse";
import { CONTRA_KINDS, type Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { today, useAfterSave, useGodownTitle, useSaveError } from "@/components/trade/common";
import { useVoucher } from "@/components/trade/hooks";

type Kind = (typeof CONTRA_KINDS)[number];

interface State {
  kind: Kind;
  date: string;
  amount: string;
  bankAccountId?: string;
  toBankAccountId?: string;
  receiptVoucherId?: string;
  partyId?: string;
  notes: string;
  reason: string;
}

const NEEDS_BANK: ReadonlySet<Kind> = new Set([
  "CASH_DEPOSIT",
  "CASH_WITHDRAWAL",
  "BANK_TRANSFER",
  "CHEQUE_CLEAR",
]);
const OPTIONAL_BANK: ReadonlySet<Kind> = new Set(["CAPITAL_IN", "DRAWINGS"]);
const CHEQUE: ReadonlySet<Kind> = new Set(["CHEQUE_CLEAR", "CHEQUE_BOUNCE"]);

function initialState(v: Voucher | null, kind: Kind, receiptId?: string): State {
  if (v && v.type === "CONTRA") {
    return {
      kind: v.kind,
      date: v.date,
      amount: paiseToInput(v.amountPaise),
      ...(v.bankAccountId ? { bankAccountId: v.bankAccountId } : {}),
      ...(v.toBankAccountId ? { toBankAccountId: v.toBankAccountId } : {}),
      ...(v.receiptVoucherId ? { receiptVoucherId: v.receiptVoucherId } : {}),
      ...(v.partyId ? { partyId: v.partyId } : {}),
      notes: v.notes ?? "",
      reason: "",
    };
  }
  return {
    kind,
    date: today(),
    amount: "",
    ...(receiptId ? { receiptVoucherId: receiptId } : {}),
    notes: "",
    reason: "",
  };
}

/** Cash & bank entries (spec §9.9): CONTRA kinds incl. owner capital / drawings. */
export function ContraForm({
  editId,
  kind,
  receiptId,
}: {
  editId?: string;
  kind?: string;
  receiptId?: string;
}) {
  const { godownId, readOnly } = useWriteGodown();
  const existing = useVoucher(editId);
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || existing === undefined) return <Loading />;
  if (editId && (!existing || existing.type !== "CONTRA"))
    return <ReadOnlyNotice reason="notFound" />;
  const k = (CONTRA_KINDS as readonly string[]).includes(kind ?? "")
    ? (kind as Kind)
    : "CASH_DEPOSIT";
  return (
    <ContraFormInner
      key={editId ?? `${k}-${receiptId ?? ""}`}
      godownId={godownId}
      existing={existing}
      initial={initialState(existing, k, receiptId)}
    />
  );
}

function ContraFormInner({
  godownId,
  existing,
  initial,
}: {
  godownId: string;
  existing: Voucher | null;
  initial: State;
}) {
  const { t, money, date: fmtDate } = useI18n();
  const godownName = useGodownTitle();
  const names = useNames(godownId);
  const [s, setS] = useState<State>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const afterSave = useAfterSave();
  const onError = useSaveError();
  const update = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const cheques = useLiveQuery(async () => {
    const list = await chequesInHand(godownId);
    // Editing a clear/bounce: its own cheque is no longer "in hand" but must stay selectable.
    if (s.receiptVoucherId && !list.some((c) => c.receipt._id === s.receiptVoucherId)) {
      const own = await db().vouchers.get(s.receiptVoucherId);
      if (own && own.type === "RECEIPT")
        list.push({ receipt: own, amountPaise: BigInt(own.amountPaise) });
    }
    return list;
  }, [godownId, s.receiptVoucherId]);
  const isCheque = CHEQUE.has(s.kind);
  const chosen = cheques?.find((c) => c.receipt._id === s.receiptVoucherId);
  const amount =
    isCheque && chosen
      ? { value: chosen.amountPaise, error: null }
      : parseAmountField(s.amount, true, 1n);
  const needsBank = NEEDS_BANK.has(s.kind);
  const synced = existing?.serverSeq !== undefined;

  const save = async () => {
    setShowErrors(true);
    if (amount.value === undefined) return;
    if (needsBank && !s.bankAccountId) return;
    if (s.kind === "BANK_TRANSFER" && (!s.toBankAccountId || s.toBankAccountId === s.bankAccountId))
      return;
    if (isCheque && !chosen) return;
    if (synced && !s.reason.trim()) return;
    setSaving(true);
    try {
      const d = {
        type: "CONTRA",
        kind: s.kind,
        date: s.date,
        amountPaise: amount.value.toString(),
        ...((needsBank || OPTIONAL_BANK.has(s.kind)) && s.bankAccountId
          ? { bankAccountId: s.bankAccountId }
          : {}),
        ...(s.kind === "BANK_TRANSFER" && s.toBankAccountId
          ? { toBankAccountId: s.toBankAccountId }
          : {}),
        ...(isCheque && chosen ? { receiptVoucherId: chosen.receipt._id } : {}),
        ...(s.kind === "CHEQUE_BOUNCE" && chosen ? { partyId: chosen.receipt.partyId } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      } as VoucherDraft;
      const res = await saveSimple(godownId, d, {
        ...(existing ? { id: existing._id } : {}),
        ...(s.reason.trim() ? { reason: s.reason.trim() } : {}),
      });
      setDirty(false);
      afterSave(res.primary._id, "/voucher/view", { receipt: false });
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  const kindLabel = (k: Kind) => t(`cashbank.kind.${k}` as TKey);
  return (
    <FormShell
      title={t("cashbank.formTitle", { kind: kindLabel(s.kind), godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="contra-form"
      totals={
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">{t("common.amount")}</span>
          <span className="tabular text-lg font-semibold">
            {amount.value !== undefined ? money(amount.value) : "—"}
          </span>
        </div>
      }
    >
      {!existing ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("voucherType.CONTRA")}</span>
          <select
            className="border-input h-12 rounded-md border px-2 text-base"
            value={s.kind}
            onChange={(e) => update({ kind: e.target.value as Kind, receiptVoucherId: undefined })}
            data-testid="contra-kind"
          >
            {CONTRA_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <DateField
        label={t("common.date")}
        value={s.date}
        max={today()}
        onChange={(date) => update({ date })}
      />
      {isCheque ? (
        <div className="flex flex-col gap-1" role="radiogroup" aria-label={t("cashbank.cheque")}>
          <span className="text-sm font-medium">{t("cashbank.cheque")}</span>
          {(cheques ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("cashbank.noCheques")}</p>
          ) : null}
          {(cheques ?? []).map((c) => (
            <button
              key={c.receipt._id}
              type="button"
              role="radio"
              aria-checked={c.receipt._id === s.receiptVoucherId}
              data-testid="contra-cheque"
              onClick={() => update({ receiptVoucherId: c.receipt._id })}
              className={`flex min-h-12 items-center justify-between gap-2 rounded-md border px-3 text-left text-sm ${c.receipt._id === s.receiptVoucherId ? "border-primary bg-primary/10 font-semibold" : ""}`}
            >
              <span className="min-w-0 break-words">
                {t("cashbank.chequeLine", {
                  party: names?.party(c.receipt.partyId) ?? "",
                  no: c.receipt.chequeNo ?? "—",
                  date: fmtDate(c.receipt.chequeDate ?? c.receipt.date, "short"),
                })}
              </span>
              <span className="tabular shrink-0">{money(c.amountPaise)}</span>
            </button>
          ))}
        </div>
      ) : (
        <AmountInput
          label={t("common.amount")}
          value={s.amount}
          onChange={(a) => update({ amount: a })}
          required
          allowZero={false}
          error={showErrors ? amount.error : null}
          testId="contra-amount"
        />
      )}
      {isCheque && showErrors && !chosen ? (
        <p className="text-destructive text-xs">{t("cashbank.pickCheque")}</p>
      ) : null}
      {needsBank || OPTIONAL_BANK.has(s.kind) ? (
        <BankPicker
          godownId={godownId}
          label={
            s.kind === "BANK_TRANSFER"
              ? t("cashbank.fromBank")
              : OPTIONAL_BANK.has(s.kind)
                ? t("cashbank.viaBank")
                : t("cashbank.bank")
          }
          value={s.bankAccountId}
          onChange={(bankAccountId) => update({ bankAccountId })}
          required={needsBank}
          allowClear={!needsBank}
          error={
            showErrors && needsBank && !s.bankAccountId
              ? "errors.domain.BANK_ACCOUNT_REQUIRED"
              : null
          }
          testId="contra-bank"
        />
      ) : null}
      {s.kind === "BANK_TRANSFER" ? (
        <BankPicker
          godownId={godownId}
          label={t("cashbank.toBank")}
          value={s.toBankAccountId}
          onChange={(toBankAccountId) => update({ toBankAccountId })}
          required
          error={
            showErrors && (!s.toBankAccountId || s.toBankAccountId === s.bankAccountId)
              ? "errors.domain.BANK_ACCOUNT_REQUIRED"
              : null
          }
          testId="contra-to-bank"
        />
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

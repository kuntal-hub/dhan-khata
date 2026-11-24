"use client";

import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { toast } from "sonner";
import { FormShell } from "@/components/forms/FormShell";
import {
  Choice,
  DateField,
  PayModeFields,
  Section,
  TextField,
  emptyPayMode,
  type PayModeState,
} from "@/components/forms/fields";
import { VarietyPicker } from "@/components/forms/pickers";
import { Computed } from "@/components/money/display";
import { AmountInput, RateInput, WeightInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { viewPathOf } from "@/components/vouchers/VoucherView";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useGodownRole } from "@/client/hooks";
import { stockOf } from "@/client/queries/stock";
import { canWriteGodown, saveTransfer } from "@/client/repo";
import {
  gramsToKgInput,
  paiseToInput,
  parseAmountField,
  parseRateField,
  parseWeightField,
} from "@/client/ui/parse";
import { GRAMS_PER_QUINTAL, amountForWeight } from "@/domain/money";
import { divRoundHalfUp } from "@/domain/rounding";
import type { Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { today, useGodownTitle, useSaveError } from "@/components/trade/common";

interface State {
  kind: "PADDY" | "MONEY";
  toGodownId?: string;
  date: string;
  fromVarietyId?: string;
  toVarietyId?: string;
  qty: string;
  rate: string;
  amount: string;
  fromPay: PayModeState;
  toPay: PayModeState;
  notes: string;
  reason: string;
}

interface Loaded {
  fromGodownId: string;
  groupId?: string;
  send: Voucher | null;
  receive: Voucher | null;
  state: State;
}

function stateFrom(send: Voucher, receive: Voucher | null, toGodownId: string): State {
  const base = {
    toGodownId,
    date: send.date,
    notes: send.notes ?? "",
    reason: "",
    fromPay: emptyPayMode(),
    toPay: emptyPayMode(),
    qty: "",
    rate: "",
    amount: "",
  };
  if (send.type === "SALE") {
    const l = send.lines[0]!;
    const rl = receive && receive.type === "PURCHASE" ? receive.lines[0] : undefined;
    return {
      ...base,
      kind: "PADDY",
      fromVarietyId: l.varietyId,
      ...(rl ? { toVarietyId: rl.varietyId } : {}),
      qty: gramsToKgInput(l.netG),
      rate: paiseToInput(l.ratePaisePerQtl),
    };
  }
  const pay = (v: Voucher | null): PayModeState =>
    v && (v.type === "PAYMENT" || v.type === "RECEIPT")
      ? {
          ...emptyPayMode(),
          mode: v.mode,
          ...(v.ourBankAccountId ? { bankAccountId: v.ourBankAccountId } : {}),
        }
      : emptyPayMode();
  return {
    ...base,
    kind: "MONEY",
    amount: send.type === "PAYMENT" ? paiseToInput(send.amountPaise) : "",
    fromPay: pay(send),
    toPay: pay(receive),
  };
}

/** Inter-godown transfer wizard (spec §1.4 rule 5, §9.11): paddy or money, both books together. */
export function TransferForm({ editId }: { editId?: string }) {
  const { godownId, readOnly } = useWriteGodown();
  const role = useGodownRole();
  const loaded = useLiveQuery(async (): Promise<Loaded | null> => {
    if (!godownId) return null;
    if (!editId) {
      return {
        fromGodownId: godownId,
        send: null,
        receive: null,
        state: {
          kind: "PADDY",
          date: today(),
          qty: "",
          rate: "",
          amount: "",
          fromPay: emptyPayMode(),
          toPay: emptyPayMode(),
          notes: "",
          reason: "",
        },
      };
    }
    const v = await db().vouchers.get(editId);
    if (!v || !("interGodown" in v) || !v.interGodown || !v.groupId) return null;
    const ig = v.interGodown;
    const fromGodownId = ig.side === "SEND" ? v.godownId : ig.counterGodownId;
    const toGodownId = ig.side === "SEND" ? ig.counterGodownId : v.godownId;
    const side = (g: string) =>
      db()
        .vouchers.where("[godownId+groupId]")
        .equals([g, v.groupId!])
        .filter((x) => x.status === "active")
        .first();
    const send = (await side(fromGodownId)) ?? null;
    const receive = (await side(toGodownId)) ?? null;
    if (!send) return null;
    return {
      fromGodownId,
      groupId: v.groupId,
      send,
      receive,
      state: stateFrom(send, receive, toGodownId),
    };
  }, [godownId, editId]);
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (role !== "owner" && role !== "manager") return <ReadOnlyNotice reason="viewer" />;
  if (loaded === undefined) return <Loading />;
  if (loaded === null) return <ReadOnlyNotice reason="notFound" />;
  return <Inner key={editId ?? "new"} loaded={loaded} />;
}

function Inner({ loaded }: { loaded: Loaded }) {
  const { t, money, rate: fmtRate } = useI18n();
  const router = useRouter();
  const godownName = useGodownTitle();
  const { godowns } = useActiveGodown();
  const [s, setS] = useState<State>(loaded.state);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const onError = useSaveError();
  const update = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const from = loaded.fromGodownId;
  const editing = !!loaded.groupId;
  const others = (godowns ?? []).filter((g) => g.status === "active" && g._id !== from);
  const toWritable = useLiveQuery(
    async () => (s.toGodownId ? canWriteGodown(s.toGodownId) : false),
    [s.toGodownId],
  );
  const avg = useLiveQuery(async () => {
    if (!s.fromVarietyId) return null;
    const p = await stockOf(from, s.fromVarietyId);
    return p.qtyG > 0n ? divRoundHalfUp(p.valuePaise * GRAMS_PER_QUINTAL, p.qtyG) : null;
  }, [from, s.fromVarietyId]);
  const qty = parseWeightField(s.qty, s.kind === "PADDY", 1n);
  const rate = parseRateField(s.rate, s.kind === "PADDY", 1n);
  const amount = parseAmountField(s.amount, s.kind === "MONEY", 1n);
  const value =
    s.kind === "PADDY"
      ? qty.value !== undefined && rate.value !== undefined
        ? amountForWeight(qty.value, rate.value)
        : undefined
      : amount.value;
  const synced = loaded.send?.serverSeq !== undefined;

  const save = async () => {
    setShowErrors(true);
    if (!s.toGodownId) return;
    if (s.kind === "PADDY") {
      if (!s.fromVarietyId || qty.value === undefined || rate.value === undefined) return;
      if (toWritable && !s.toVarietyId) return;
    } else if (amount.value === undefined) return;
    if (synced && !s.reason.trim()) return;
    setSaving(true);
    try {
      const res = await saveTransfer(
        {
          kind: s.kind,
          date: s.date,
          fromGodownId: from,
          toGodownId: s.toGodownId,
          ...(s.kind === "PADDY"
            ? { qtyG: qty.value!, ratePaisePerQtl: rate.value! }
            : { amountPaise: amount.value! }),
          ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
          from:
            s.kind === "PADDY"
              ? { varietyId: s.fromVarietyId! }
              : {
                  mode: s.fromPay.mode,
                  ...(s.fromPay.bankAccountId ? { bankAccountId: s.fromPay.bankAccountId } : {}),
                },
          to:
            s.kind === "PADDY"
              ? { ...(s.toVarietyId ? { varietyId: s.toVarietyId } : {}) }
              : {
                  mode: s.toPay.mode,
                  ...(s.toPay.bankAccountId ? { bankAccountId: s.toPay.bankAccountId } : {}),
                },
        },
        {
          ...(loaded.groupId ? { groupId: loaded.groupId } : {}),
          ...(s.reason.trim() ? { reason: s.reason.trim() } : {}),
        },
      );
      setDirty(false);
      toast.success(t("common.saved"));
      router.replace(viewPathOf(res.send));
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  if (others.length === 0 && !editing) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        {t("transfer.noOtherGodown")}
      </p>
    );
  }
  return (
    <FormShell
      title={t(editing ? "transfer.editTitle" : "transfer.title", { godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="transfer-form"
      totals={
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">{t("transfer.value")}</span>
          <span className="tabular text-lg font-semibold" data-testid="transfer-value">
            {value !== undefined ? money(value) : "—"}
          </span>
        </div>
      }
    >
      {!editing ? (
        <Choice
          label={t("transfer.kind")}
          value={s.kind}
          onChange={(kind) => update({ kind })}
          options={[
            { value: "PADDY", label: t("transfer.paddy") },
            { value: "MONEY", label: t("transfer.money") },
          ]}
          testId="transfer-kind"
        />
      ) : null}
      <Choice
        label={t("transfer.toGodown")}
        value={s.toGodownId ?? ""}
        wrap
        onChange={(toGodownId) => !editing && update({ toGodownId, toVarietyId: undefined })}
        options={(editing ? (godowns ?? []).filter((g) => g._id === s.toGodownId) : others).map(
          (g) => ({ value: g._id, label: g.name }),
        )}
        testId="transfer-to"
      />
      {showErrors && !s.toGodownId ? (
        <p className="text-destructive text-xs">{t("errors.validation.required")}</p>
      ) : null}
      {s.toGodownId && toWritable === false ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t("transfer.unpaired")}
        </p>
      ) : null}
      <DateField
        label={t("common.date")}
        value={s.date}
        max={today()}
        onChange={(date) => update({ date })}
      />
      {s.kind === "PADDY" ? (
        <>
          <VarietyPicker
            godownId={from}
            label={t("stockPage.variety")}
            value={s.fromVarietyId}
            onChange={(fromVarietyId) => update({ fromVarietyId })}
            required
            error={showErrors && !s.fromVarietyId ? "errors.validation.required" : null}
            testId="transfer-variety"
          />
          <WeightInput
            label={t("stockPage.qty")}
            value={s.qty}
            onChange={(q) => update({ qty: q })}
            required
            error={showErrors ? qty.error : null}
            testId="transfer-qty"
          />
          <RateInput
            label={t("transfer.rate")}
            value={s.rate}
            onChange={(r) => update({ rate: r })}
            required
            error={showErrors ? rate.error : null}
            hint={avg ? t("transfer.rateHint", { rate: fmtRate(avg) }) : undefined}
            testId="transfer-rate"
          />
          {s.toGodownId && toWritable ? (
            <VarietyPicker
              godownId={s.toGodownId}
              label={t("transfer.receiverVariety")}
              value={s.toVarietyId}
              onChange={(toVarietyId) => update({ toVarietyId })}
              required
              error={showErrors && !s.toVarietyId ? "errors.validation.required" : null}
              testId="transfer-to-variety"
            />
          ) : null}
          <Computed label={t("transfer.value")} value={value !== undefined ? money(value) : "—"} />
        </>
      ) : (
        <>
          <AmountInput
            label={t("common.amount")}
            value={s.amount}
            onChange={(a) => update({ amount: a })}
            required
            allowZero={false}
            error={showErrors ? amount.error : null}
            testId="transfer-amount"
          />
          <Section title={t("transfer.fromMode")}>
            <PayModeFields
              godownId={from}
              value={s.fromPay}
              onChange={(fromPay) => update({ fromPay })}
            />
          </Section>
          {s.toGodownId && toWritable ? (
            <Section title={t("transfer.toMode")}>
              <PayModeFields
                godownId={s.toGodownId}
                value={s.toPay}
                onChange={(toPay) => update({ toPay })}
              />
            </Section>
          ) : null}
        </>
      )}
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

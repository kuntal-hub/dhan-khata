"use client";

/**
 * Second-party entry (requirement_v2 §12.8A): party (+ create inline), "আমরা দেব / We owe" or
 * "ওরা দেবে / They owe", amount, date, due date, money given / received now (a payment linked to
 * the entry: OUT for we owe, IN for they owe), notes. Later money is added on the entry or the
 * party's account. Posts against SP_CLEARING (DECISIONS D7), never as income or expense.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateField, FieldBox, PartyPicker } from "@/components/entry/Fields";
import { emptyPay, PaymentFields, toPart, type PayState } from "@/components/entry/Payments";
import { FormShell } from "@/components/forms/FormShell";
import { AmountInput } from "@/components/money/inputs";
import { lazyToast } from "@/components/system/IdleToaster";
import { VoiceText } from "@/components/voice/VoiceText";
import { errorKey } from "@/client/errors";
import { newId, saveBillWithInitialPayment, type DraftOf } from "@/client/repo";
import { paiseToInput, parseAmountField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import type { DocOf, Godown } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

type Entry = DocOf<"SECOND_PARTY">;
type Kind = Entry["kind"];

export function SecondPartyForm({
  godown,
  existing,
  partyId,
}: {
  godown: Godown;
  existing?: Entry;
  partyId?: string;
}) {
  const { t, money } = useI18n();
  const router = useRouter();
  const today = todayIST();
  const [party, setParty] = useState<string | undefined>(existing?.partyId ?? partyId);
  const [kind, setKind] = useState<Kind>(existing?.kind ?? "WE_OWE");
  const [amount, setAmount] = useState(existing ? paiseToInput(existing.amountPaise) : "");
  const [date, setDate] = useState(existing?.transactionDate ?? today);
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [pay, setPay] = useState<PayState>(emptyPay(today, "0"));
  const [id] = useState(() => existing?._id ?? newId());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const touch = () => setDirty(true);

  const amt = parseAmountField(amount, true, 1n);
  const payPart = existing ? { part: null } : toPart(pay, true);
  const now = payPart.part ? BigInt(payPart.part.amountPaise) : 0n;

  const save = async () => {
    setShowErrors(true);
    setError(null);
    if (!party || amt.value === undefined) return setError(t("acct.required"));
    if (payPart.error) return setError(t(payPart.error));
    if (now > amt.value) return setError(t("errors.domain.OVERPAYMENT"));
    setSaving(true);
    try {
      const draft: DraftOf<"SECOND_PARTY"> = {
        type: "SECOND_PARTY",
        ...(existing ? {} : { _id: id }),
        partyId: party,
        transactionDate: date,
        kind,
        amountPaise: amt.value.toString(),
        ...(dueDate ? { dueDate } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      await saveBillWithInitialPayment(
        godown._id,
        draft,
        payPart.part,
        existing ? { id: existing._id } : {},
      );
      setDirty(false);
      lazyToast(t("mill.spSaved"), "success");
      router.replace(`/mill/party?id=${party}`);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell
      title={t(existing ? "mill.spEdit" : "mill.spNew", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      saveLabel={t("mill.save")}
      testId="sp-form"
      backHref="/mill"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t(`mill.${kind}`)}</span>
          <span className="tabular text-lg font-semibold">
            {amt.value !== undefined ? money(amt.value) : "—"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <PartyPicker
          godownId={godown._id}
          roles={["SECOND_PARTY"]}
          createRole="SECOND_PARTY"
          value={party}
          onChange={(p) => {
            setParty(p);
            touch();
          }}
          label={t("mill.spParty")}
          testId="sp-party"
          error={showErrors && !party ? t("acct.required") : null}
        />
        <FieldBox label={t("mill.spKind")}>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("mill.spKind")}>
            {(["WE_OWE", "THEY_OWE"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k);
                  touch();
                }}
                data-testid={`sp-kind-${k}`}
                className={cn(
                  "press min-h-14 rounded-xl border px-3 text-[15px] font-medium",
                  kind === k ? "border-primary bg-primary text-primary-foreground" : "bg-card",
                )}
              >
                {t(`mill.${k}`)}
              </button>
            ))}
          </div>
        </FieldBox>
        <AmountInput
          label={t("mill.spAmount")}
          value={amount}
          onChange={(v) => {
            setAmount(v);
            touch();
          }}
          testId="sp-amount"
        />
        <DateField
          label={t("mill.spDate")}
          value={date}
          onChange={(d) => {
            setDate(d);
            touch();
          }}
          testId="sp-date"
        />
        <DateField
          label={t("mill.dueDate")}
          value={dueDate}
          onChange={(d) => {
            setDueDate(d);
            touch();
          }}
          allowFuture
        />
        {existing ? null : (
          <section className="bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4">
            <PaymentFields
              godownId={godown._id}
              value={pay}
              onChange={(p) => {
                setPay(p);
                touch();
              }}
              amountLabel={t(`mill.spPay${kind}`)}
              hint={t("mill.payHint")}
              testId="sp-pay"
              allowZero
            />
          </section>
        )}
        <FieldBox label={t("mill.notes")}>
          <VoiceText
            value={notes}
            onChange={(v) => {
              setNotes(v);
              touch();
            }}
          />
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

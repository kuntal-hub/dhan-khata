"use client";

/**
 * Add one of our bank accounts (requirement_v2 §7.2, §9): name, bank, last 4 digits, UPI-linked,
 * opening balance (posted as an OPENING entry). Used by the bank page and inline by BankPicker,
 * so a payment "by bank" never dead-ends when no account exists yet.
 */
import { useState } from "react";
import { AmountInput } from "@/components/money/inputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import { saveBankAccount } from "@/client/repo";
import { parseAmountField } from "@/client/ui/parse";
import { useI18n } from "@/i18n/I18nProvider";
import { FieldBox } from "./Fields";

export function BankAccountForm({
  godownId,
  initialName = "",
  onDone,
  onCancel,
}: {
  godownId: string;
  initialName?: string;
  onDone: (id: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [bank, setBank] = useState("");
  const [last4, setLast4] = useState("");
  const [upi, setUpi] = useState(false);
  const [opening, setOpening] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    if (!name.trim() || !bank.trim()) return setError(t("acct.required"));
    if (!/^\d{4}$/.test(last4.trim())) return setError(t("bankAcc.last4"));
    const o = parseAmountField(opening, false, 0n);
    if (o.error) return setError(t(o.error));
    try {
      const b = await saveBankAccount(godownId, {
        name: name.trim(),
        bank: bank.trim(),
        last4: last4.trim(),
        isUpiLinked: upi,
        ...(o.value ? { openingPaise: o.value } : {}),
      });
      onDone(b._id);
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <div className="flex flex-col gap-3" data-testid="bank-form">
      <FieldBox label={t("bankAcc.name")}>
        <Input
          className="h-12 text-base"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          data-testid="bank-name"
        />
      </FieldBox>
      <FieldBox label={t("bankAcc.bank")}>
        <Input
          className="h-12 text-base"
          value={bank}
          onChange={(e) => setBank(e.target.value)}
          data-testid="bank-bank"
        />
      </FieldBox>
      <FieldBox label={t("bankAcc.last4")}>
        <Input
          className="h-12 text-base"
          inputMode="numeric"
          maxLength={4}
          value={last4}
          onChange={(e) => setLast4(e.target.value)}
          data-testid="bank-last4"
        />
      </FieldBox>
      <label className="flex min-h-12 items-center gap-3 text-base">
        <input
          type="checkbox"
          className="size-5"
          checked={upi}
          onChange={(e) => setUpi(e.target.checked)}
        />
        {t("bankAcc.upi")}
      </label>
      <AmountInput
        label={t("bankAcc.opening")}
        value={opening}
        onChange={setOpening}
        allowZero
        hint={t("bankAcc.openingHint")}
        testId="bank-opening"
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {onCancel ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button className="h-12" onClick={() => void save()} data-testid="bank-save">
            {t("common.save")}
          </Button>
        </div>
      ) : (
        <Button className="h-12 text-base" onClick={() => void save()} data-testid="bank-save">
          {t("common.save")}
        </Button>
      )}
    </div>
  );
}

"use client";

/**
 * Our bank accounts (requirement_v2 §7.2, §9): name, bank, last 4 digits, UPI-linked, opening
 * balance (posted as an OPENING entry). Balances are derived from the ledger.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Landmark } from "lucide-react";
import { FieldBox } from "@/components/entry/Fields";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { AmountInput } from "@/components/money/inputs";
import { EmptyState, Panel, Skeleton } from "@/components/kit/Kit";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import { useActiveGodown } from "@/client/hooks";
import { bankRows } from "@/client/queries/purchases";
import { saveBankAccount } from "@/client/repo";
import { parseAmountField } from "@/client/ui/parse";
import { useI18n } from "@/i18n/I18nProvider";

export default function BanksPage() {
  const { t, money } = useI18n();
  const { godownId, godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const [adding, setAdding] = useState(false);
  const rows = useLiveQuery(() => (godownId ? bankRows(godownId) : []), [godownId]);
  return (
    <div className="flex flex-col gap-4" data-testid="banks-page">
      <PageTitle
        title={t("bankAcc.title")}
        subtitle={godown?.name}
        actions={
          readOnly ? null : (
            <Button className="h-11" onClick={() => setAdding(true)} data-testid="bank-add">
              {t("bankAcc.add")}
            </Button>
          )
        }
      />
      {rows === undefined ? (
        <Skeleton rows={2} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Landmark} title={t("bankAcc.empty")} />
      ) : (
        <Panel>
          <ul className="flex flex-col divide-y">
            {rows.map(({ bank, balancePaise }) => (
              <li key={bank._id} className="flex items-center gap-3 py-3" data-testid="bank-row">
                <span className="bg-forest-100 text-forest flex size-10 items-center justify-center rounded-xl">
                  <Landmark className="size-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-medium">{bank.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {t("bankAcc.masked", { bank: bank.bank, last4: bank.last4 })}
                    {bank.isUpiLinked ? ` · ${t("pay.UPI")}` : ""}
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="text-muted-foreground text-xs">{t("bankAcc.balance")}</span>
                  <span className="tabular font-semibold">{money(balancePaise)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {adding && godownId ? <AddBank godownId={godownId} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function AddBank({ godownId, onClose }: { godownId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
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
      await saveBankAccount(godownId, {
        name: name.trim(),
        bank: bank.trim(),
        last4: last4.trim(),
        isUpiLinked: upi,
        ...(o.value ? { openingPaise: o.value } : {}),
      });
      lazyToast(t("bankAcc.saved"), "success");
      onClose();
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <BottomSheet
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("bankAcc.add")}
      testId="bank-sheet"
    >
      <FieldBox label={t("bankAcc.name")}>
        <Input
          className="h-12 text-base"
          value={name}
          onChange={(e) => setName(e.target.value)}
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
      <Button className="h-12 text-base" onClick={() => void save()} data-testid="bank-save">
        {t("common.save")}
      </Button>
    </BottomSheet>
  );
}

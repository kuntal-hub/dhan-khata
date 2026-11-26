"use client";

/**
 * Our bank accounts (requirement_v2 §7.2, §9): name, bank, last 4 digits, UPI-linked, opening
 * balance (posted as an OPENING entry). Balances are derived from the ledger.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Landmark } from "lucide-react";
import { BankAccountForm } from "@/components/entry/BankAccountForm";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { EmptyState, Panel, Skeleton } from "@/components/kit/Kit";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { useActiveGodown } from "@/client/hooks";
import { bankRows } from "@/client/queries/purchases";
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
  return (
    <BottomSheet
      open
      onOpenChange={(v) => !v && onClose()}
      title={t("bankAcc.add")}
      testId="bank-sheet"
    >
      <BankAccountForm
        godownId={godownId}
        onDone={() => {
          lazyToast(t("bankAcc.saved"), "success");
          onClose();
        }}
      />
    </BottomSheet>
  );
}

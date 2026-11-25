"use client";

/**
 * Party account pieces shared by the farmer and customer accounts (requirement_v2 §12.2, §12.3):
 * the ledger statement (every source, running balance, link to each source) and the on-account
 * advance sheet (given = OUT, received = IN).
 */
import Link from "next/link";
import { useState } from "react";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { docPath } from "@/components/entry/docPath";
import { errorKey } from "@/client/errors";
import type { LedgerRow } from "@/client/queries/purchases";
import { payAdvance } from "@/client/repo";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { emptyPay, PaymentFields, toPart, type PayState } from "./Payments";

export function LedgerTable({
  rows,
  debitLabel,
  creditLabel,
  testId,
}: {
  rows: readonly LedgerRow[];
  debitLabel: string;
  creditLabel: string;
  testId: string;
}) {
  const { t, money, date } = useI18n();
  if (rows.length === 0)
    return <p className="text-muted-foreground py-3 text-sm">{t("ui.empty")}</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm" data-testid={testId}>
        <thead className="text-muted-foreground text-xs">
          <tr>
            <th className="py-2 text-left font-normal">{t("pay.date")}</th>
            <th className="py-2 text-right font-normal">{debitLabel}</th>
            <th className="py-2 text-right font-normal">{creditLabel}</th>
            <th className="py-2 text-right font-normal">{t("farmerV.closing")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const href = docPath(r.doc);
            const label = t(`voucherType.${r.doc.type}` as TKey);
            return (
              <tr key={r.doc._id} data-testid={`${testId}-row`} data-date={r.date}>
                <td className="py-2 whitespace-nowrap">
                  {date(r.date, "short")}
                  {href ? (
                    <Link href={href} className="text-primary block text-xs">
                      {label}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground block text-xs">{label}</span>
                  )}
                </td>
                <td className="tabular py-2 text-right">
                  {r.debitPaise ? money(r.debitPaise) : ""}
                </td>
                <td className="tabular py-2 text-right">
                  {r.creditPaise ? money(r.creditPaise) : ""}
                </td>
                <td className="tabular py-2 text-right font-medium">
                  {money(r.balancePaise < 0n ? -r.balancePaise : r.balancePaise)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AdvanceSheet({
  godownId,
  partyId,
  direction,
  title,
  onClose,
}: {
  godownId: string;
  partyId: string;
  direction: "IN" | "OUT";
  title: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [s, setS] = useState<PayState>(emptyPay());
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const r = toPart(s, false);
    if (r.error || !r.part) return setError(t(r.error ?? "errors.validation.required"));
    try {
      await payAdvance(godownId, partyId, direction, r.part);
      lazyToast(t("pay.saved"), "success");
      onClose();
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={title} testId="advance-sheet">
      <PaymentFields
        godownId={godownId}
        value={s}
        onChange={setS}
        amountLabel={t("pay.amount")}
        testId="advance-pay"
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button className="h-12 text-base" onClick={() => void save()} data-testid="advance-save">
        {t("pay.save")}
      </Button>
    </BottomSheet>
  );
}

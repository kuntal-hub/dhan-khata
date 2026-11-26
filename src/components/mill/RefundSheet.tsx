"use client";

/**
 * "টাকা ফেরত দিলাম / Refund to mill" (v2.1 rule 5): the only screen where money goes OUT to a
 * mill for a dispatch, and only when the mill paid more than it owed. Saved as a MILL_REFUND
 * payment (OUT) naming the dispatch; it shows under Cash paid.
 */
import { useState } from "react";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { emptyPay, PaymentFields, toPart, type PayState } from "@/components/entry/Payments";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { errorKey } from "@/client/errors";
import { saveMillRefund } from "@/client/repo";
import { paiseToInput } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

export function RefundSheet({
  open,
  onOpenChange,
  godownId,
  millPartyId,
  dispatchId,
  overpaidPaise,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  godownId: string;
  millPartyId: string;
  dispatchId: string;
  overpaidPaise: bigint;
}) {
  const { t } = useI18n();
  const [s, setS] = useState<PayState>(emptyPay(todayIST(), paiseToInput(overpaidPaise)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const save = async () => {
    setError(null);
    const r = toPart(s, false);
    if (r.error || !r.part) return setError(t(r.error ?? "errors.validation.required"));
    if (BigInt(r.part.amountPaise) > overpaidPaise) return setError(t("errors.domain.OVERPAYMENT"));
    setBusy(true);
    try {
      await saveMillRefund(godownId, millPartyId, r.part, dispatchId);
      lazyToast(t("pay.saved"), "success");
      onOpenChange(false);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("mill.refundTitle")}
      description={t("mill.refundHint")}
      testId="mill-refund"
    >
      <PaymentFields
        godownId={godownId}
        value={s}
        onChange={setS}
        amountLabel={t("pay.amount")}
        testId="refund-pay"
      />
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        className="h-12 text-base"
        disabled={busy}
        onClick={() => void save()}
        data-testid="refund-save"
      >
        {t("pay.save")}
      </Button>
    </BottomSheet>
  );
}

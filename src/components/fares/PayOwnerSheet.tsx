"use client";

/**
 * Pay a vehicle owner (DECISIONS D56): any amount up to what he is owed, any day (backdating
 * allowed, never in the future), cash / bank / UPI, with a note. Goes to his open fares oldest
 * first (`payVehicleOwner`); the outstanding drops at once.
 */
import { useState } from "react";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import { payVehicleOwner, RepoError } from "@/client/repo";
import { paiseToInput } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";
import { FieldBox } from "@/components/entry/Fields";
import { emptyPay, PaymentFields, toPart, type PayState } from "@/components/entry/Payments";

export function PayOwnerSheet({
  godownId,
  partyId,
  outstandingPaise,
  onClose,
}: {
  godownId: string;
  partyId: string;
  outstandingPaise: bigint;
  onClose: () => void;
}) {
  const { t, money } = useI18n();
  const [pay, setPay] = useState<PayState>(
    emptyPay(todayIST(), outstandingPaise > 0n ? paiseToInput(outstandingPaise) : ""),
  );
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(null);
    const r = toPart(pay, false);
    if (r.error || !r.part) return setError(t(r.error ?? "errors.validation.required"));
    setBusy(true);
    try {
      await payVehicleOwner(godownId, partyId, {
        ...r.part,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      const paid = BigInt(r.part.amountPaise);
      lazyToast(
        t("fare.paidToast", {
          amount: money(outstandingPaise > paid ? outstandingPaise - paid : 0n),
        }),
        "success",
      );
      onClose();
    } catch (e) {
      if (e instanceof RepoError && e.code === "OVERPAYMENT")
        setError(t("fare.overOutstanding", { amount: money(outstandingPaise) }));
      else setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("fare.payOwner")}
      description={t("fare.outstandingIs", { amount: money(outstandingPaise) })}
      testId="pay-owner"
    >
      <PaymentFields
        godownId={godownId}
        value={pay}
        onChange={setPay}
        amountLabel={t("pay.amount")}
        testId="owner-pay"
      />
      <FieldBox label={t("fare.payNote")}>
        <Input
          className="h-12 text-base"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          data-testid="owner-pay-note"
        />
      </FieldBox>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        className="h-12 text-base"
        disabled={busy}
        onClick={() => void save()}
        data-testid="owner-pay-save"
      >
        {t("pay.save")}
      </Button>
    </BottomSheet>
  );
}

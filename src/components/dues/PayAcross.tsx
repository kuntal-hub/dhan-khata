"use client";

/**
 * Pay / collect one amount from a party across its open bills (requirement_v2 §12.6): oldest
 * first by default (FIFO), each bill's part editable, the rest kept as the party's advance. Saves
 * the same Payment records as the bill screens (one per bill, one groupId).
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { emptyPay, PaymentFields, toPart, type PayState } from "@/components/entry/Payments";
import { AmountInput } from "@/components/money/inputs";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { errorKey } from "@/client/errors";
import { openBillsOf } from "@/client/queries/dues";
import { payParty } from "@/client/repo";
import { paiseToInput, parseAmountField } from "@/client/ui/parse";
import { allocateFifo } from "@/domain/v2/payments";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

export function PayAcross({
  godownId,
  partyId,
  direction,
  onDone,
}: {
  godownId: string;
  partyId: string;
  direction: "IN" | "OUT";
  onDone: () => void;
}) {
  const { t, money, date } = useI18n();
  const [pay, setPay] = useState<PayState>(emptyPay());
  const [manual, setManual] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = useLiveQuery(
    () => openBillsOf(godownId, partyId, direction),
    [godownId, partyId, direction],
  );
  const amount = parseAmountField(pay.amount, false, 0n).value ?? 0n;
  const fifo = useMemo(
    () =>
      allocateFifo(
        amount,
        (open ?? []).map((o) => o.state),
      ),
    [amount, open],
  );
  const parts: Record<string, bigint> = {};
  if (manual) {
    for (const [k, v] of Object.entries(manual)) {
      parts[k] = parseAmountField(v, false, 0n).value ?? 0n;
    }
  } else {
    for (const a of fifo.allocations) parts[a.sourceId] = a.amountPaise;
  }
  const used = Object.values(parts).reduce((s, x) => s + x, 0n);
  const advance = amount - used;
  const totalDue = (open ?? []).reduce((s, o) => s + o.state.duePaise, 0n);

  const save = async () => {
    setError(null);
    const r = toPart(pay, false);
    if (r.error || !r.part) return setError(t(r.error ?? "errors.validation.required"));
    if (advance < 0n) return setError(t("dues.overAllocated"));
    for (const o of open ?? []) {
      if ((parts[o.state.bill.sourceId] ?? 0n) > o.state.duePaise)
        return setError(t("errors.domain.OVERPAYMENT"));
    }
    setBusy(true);
    try {
      await payParty(
        godownId,
        partyId,
        direction,
        r.part,
        (open ?? [])
          .filter((o) => (parts[o.state.bill.sourceId] ?? 0n) > 0n)
          .map((o) => ({
            source: o.doc,
            sourceId: o.state.bill.sourceId,
            amountPaise: parts[o.state.bill.sourceId]!,
          })),
      );
      lazyToast(t("pay.saved"), "success");
      onDone();
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="pay-across">
      <p className="text-muted-foreground text-sm">
        {t(direction === "OUT" ? "dues.openToPay" : "dues.openToCollect", {
          amount: money(totalDue),
        })}
      </p>
      <PaymentFields
        godownId={godownId}
        value={pay}
        onChange={(p) => {
          setPay(p);
          if (p.amount !== pay.amount) setManual(null);
        }}
        amountLabel={t("pay.amount")}
        testId="pa-pay"
      />
      {open && open.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold">{t("dues.allocation")}</h3>
            {manual ? (
              <Button variant="ghost" className="h-10" onClick={() => setManual(null)}>
                {t("dues.fifoAgain")}
              </Button>
            ) : (
              <span className="text-muted-foreground text-xs">{t("dues.fifoHint")}</span>
            )}
          </div>
          <ul className="flex flex-col gap-2" data-testid="pa-bills">
            {open.map((o) => {
              const sid = o.state.bill.sourceId;
              const val = manual
                ? (manual[sid] ?? "")
                : parts[sid]
                  ? paiseToInput(parts[sid]!)
                  : "";
              return (
                <li key={sid} className="bg-card flex items-end gap-3 rounded-xl border p-3">
                  <div className="flex min-w-0 flex-1 flex-col text-sm">
                    <span className="font-medium">
                      {o.state.bill.sourceType === "VEHICLE_FARE"
                        ? t("fare.billLabel", { number: o.doc.number })
                        : `${t(`voucherType.${o.doc.type}` as TKey)} · ${o.doc.number}`}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {date(o.state.bill.date, "short")} ·{" "}
                      {t("pay.due", { amount: money(o.state.duePaise) })}
                    </span>
                  </div>
                  <div className="w-32">
                    <AmountInput
                      label={t("dues.thisBill")}
                      value={val}
                      allowZero
                      onChange={(v) => {
                        const base: Record<string, string> =
                          manual ??
                          Object.fromEntries(
                            Object.entries(parts).map(([k, x]) => [k, paiseToInput(x)]),
                          );
                        setManual({ ...base, [sid]: v });
                      }}
                      testId="pa-bill-amount"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <div className="bg-forest-100/60 flex items-center justify-between rounded-xl px-3 py-2 text-sm">
        <span className="text-forest">{t("dues.asAdvance")}</span>
        <span
          className={`tabular text-lg font-semibold ${advance < 0n ? "text-destructive" : "text-forest"}`}
          data-testid="pa-advance"
          data-paise={advance.toString()}
        >
          {money(advance)}
        </span>
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        className="h-12 text-base"
        disabled={busy}
        onClick={() => void save()}
        data-testid="pa-save"
      >
        {t("pay.save")}
      </Button>
    </div>
  );
}

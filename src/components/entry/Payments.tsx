"use client";

/**
 * Payments UI (requirement_v2 §7.2): PaymentFields (amount, actual payment date, নগদ / ব্যাংক /
 * UPI, bank account + reference), PaymentList (every payment of a bill: date, amount, mode,
 * reference, initial badge, reversed state; edit / reverse / receipt) and AddPaymentSheet
 * ("+ বাকি টাকা দিন"; more than the due only after "keep as advance").
 */
import Link from "next/link";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Pencil, Printer, Undo2 } from "lucide-react";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { AmountInput } from "@/components/money/inputs";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import { payBill, RepoError, saveDoc, voidDoc, type PaymentPart } from "@/client/repo";
import { parseAmountField, paiseToInput } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import type { Doc, Payment, PayMode } from "@/domain/schemas";
import { dealDateOf, dueDateOf } from "@/domain/v2/dueDate";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { BankPicker, DateField, FieldBox, Segmented } from "./Fields";

export interface PayState {
  amount: string;
  date: string;
  mode: PayMode;
  bankId?: string;
  reference: string;
}

export function emptyPay(date = todayIST(), amount = ""): PayState {
  return { amount, date, mode: "CASH", reference: "" };
}

export function payFromDoc(p: Payment): PayState {
  return {
    amount: paiseToInput(p.amountPaise),
    date: p.paymentDate,
    mode: p.mode,
    ...(p.bankAccountId ? { bankId: p.bankAccountId } : {}),
    reference: p.reference ?? "",
  };
}

/**
 * Validate; `allowZero` for an initial payment (0 = full credit). `minDate`: the deal's date (a
 * payment may be backdated, never before its deal, never in the future; the due date plays no part).
 */
export function toPart(
  s: PayState,
  allowZero: boolean,
  minDate?: string,
): { part: PaymentPart | null; error?: TKey } {
  const a = parseAmountField(s.amount, !allowZero, allowZero ? 0n : 1n);
  if (a.error) return { part: null, error: a.error };
  const amount = a.value ?? 0n;
  if (amount === 0n) return { part: null };
  if (s.mode !== "CASH" && !s.bankId)
    return { part: null, error: "errors.domain.BANK_ACCOUNT_REQUIRED" };
  if (s.date > todayIST()) return { part: null, error: "errors.domain.FUTURE_DATE" };
  if (minDate && s.date < minDate)
    return { part: null, error: "errors.domain.PAYMENT_BEFORE_DEAL" };
  return {
    part: {
      amountPaise: amount.toString(),
      paymentDate: s.date,
      mode: s.mode,
      ...(s.mode !== "CASH" && s.bankId ? { bankAccountId: s.bankId } : {}),
      ...(s.reference.trim() ? { reference: s.reference.trim() } : {}),
    },
  };
}

export function PaymentFields({
  godownId,
  value,
  onChange,
  amountLabel,
  testId = "pay",
  allowZero = false,
  hint,
  hideAmount = false,
  minDate,
}: {
  godownId: string;
  value: PayState;
  onChange: (s: PayState) => void;
  amountLabel: string;
  testId?: string;
  allowZero?: boolean;
  hint?: string;
  /** The amount is entered elsewhere (e.g. "paid fully now" = the expense amount). */
  hideAmount?: boolean;
  /** The deal's date: the earliest payment date. */
  minDate?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      {hideAmount ? null : (
        <AmountInput
          label={amountLabel}
          value={value.amount}
          onChange={(amount) => onChange({ ...value, amount })}
          allowZero={allowZero}
          testId={`${testId}-amount`}
          hint={hint}
        />
      )}
      <DateField
        label={t("pay.date")}
        value={value.date}
        onChange={(date) => onChange({ ...value, date })}
        testId={`${testId}-date`}
        {...(minDate ? { min: minDate } : {})}
      />
      <FieldBox label={t("pay.mode")}>
        <Segmented
          label={t("pay.mode")}
          value={value.mode}
          options={[
            ["CASH", t("pay.CASH")],
            ["BANK", t("pay.BANK")],
            ["UPI", t("pay.UPI")],
          ]}
          onChange={(mode) => onChange({ ...value, mode })}
          testId={`${testId}-mode`}
        />
      </FieldBox>
      {value.mode !== "CASH" ? (
        <>
          <BankPicker
            godownId={godownId}
            value={value.bankId}
            onChange={(bankId) =>
              onChange({ ...value, ...(bankId ? { bankId } : { bankId: undefined }) })
            }
            testId={`${testId}-bank`}
          />
          <FieldBox label={t("pay.reference")}>
            <Input
              className="h-12 text-base"
              value={value.reference}
              onChange={(e) => onChange({ ...value, reference: e.target.value })}
              data-testid={`${testId}-ref`}
            />
          </FieldBox>
        </>
      ) : null}
    </div>
  );
}

/**
 * The remaining due after each active payment, in payment-date order (a payment in the other
 * direction, e.g. a refund, adds back). Reversed payments don't count.
 */
export function runningDue(
  payments: readonly Payment[],
  totalPaise: bigint,
  direction: "IN" | "OUT",
): Map<string, bigint> {
  const order = payments
    .filter((p) => p.status === "active")
    .sort((a, b) =>
      a.paymentDate === b.paymentDate
        ? a.createdAt.localeCompare(b.createdAt)
        : a.paymentDate.localeCompare(b.paymentDate),
    );
  const out = new Map<string, bigint>();
  let left = totalPaise;
  for (const p of order) {
    left -= p.direction === direction ? BigInt(p.amountPaise) : -BigInt(p.amountPaise);
    out.set(p._id, left);
  }
  return out;
}

export function PaymentList({
  payments,
  godownId,
  bill,
}: {
  payments: Payment[];
  godownId: string;
  /** The deal's bill: shows the remaining due after each payment; `date` = earliest payment date. */
  bill?: { totalPaise: bigint; direction: "IN" | "OUT"; date?: string };
}) {
  const { t, money, date } = useI18n();
  const [reverse, setReverse] = useState<Payment | null>(null);
  const [edit, setEdit] = useState<Payment | null>(null);
  const [reason, setReason] = useState("");
  if (payments.length === 0)
    return <p className="text-muted-foreground py-3 text-sm">{t("pay.none")}</p>;
  const after = bill ? runningDue(payments, bill.totalPaise, bill.direction) : null;
  return (
    <>
      <ul className="flex flex-col divide-y" data-testid="payment-list">
        {payments.map((p) => {
          const voided = p.status === "void";
          return (
            <li
              key={p._id}
              className={cn("flex items-center gap-3 py-3", voided && "opacity-60")}
              data-testid="payment-row"
              data-status={p.status}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl",
                  p.direction === "IN"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-red-50 text-red-700",
                )}
              >
                {p.direction === "IN" ? (
                  <ArrowDownLeft className="size-5" aria-hidden />
                ) : (
                  <ArrowUpRight className="size-5" aria-hidden />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn("tabular text-[15px] font-semibold", voided && "line-through")}
                  data-testid="payment-amount"
                >
                  {money(BigInt(p.amountPaise))}
                </span>
                <span className="text-muted-foreground text-xs">
                  {date(p.paymentDate, "short")} · {t(`pay.${p.mode}` as TKey)}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                {after?.has(p._id) ? (
                  <span className="tabular text-muted-foreground text-xs" data-testid="payment-after">
                    {t("pay.after", { amount: money(after.get(p._id)!) })}
                  </span>
                ) : null}
                <span className="flex gap-1.5">
                  {p.isInitial ? (
                    <span className="bg-gold-100 text-accent-foreground rounded-full px-2 text-[11px]">
                      {t("pay.initial")}
                    </span>
                  ) : null}
                  {voided ? (
                    <span className="bg-muted rounded-full px-2 text-[11px]">
                      {t("pay.reversed")}
                    </span>
                  ) : null}
                </span>
              </span>
              {voided ? null : (
                <span className="flex shrink-0">
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={t("pay.receipt")}
                  >
                    <Link href={`/print/payment?id=${p._id}`}>
                      <Printer className="size-5" aria-hidden />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={t("pay.edit")}
                    onClick={() => setEdit(p)}
                  >
                    <Pencil className="size-5" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive size-11"
                    aria-label={t("pay.reverse")}
                    onClick={() => setReverse(p)}
                    data-testid="payment-reverse"
                  >
                    <Undo2 className="size-5" aria-hidden />
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={reverse !== null}
        onOpenChange={(o) => !o && setReverse(null)}
        title={t("pay.reverseTitle")}
        body={
          reverse
            ? t(reverse.direction === "OUT" ? "pay.reverseBodyOut" : "pay.reverseBodyIn", {
                date: date(reverse.paymentDate, "short"),
                mode: t(`pay.${reverse.mode}` as TKey),
                amount: money(BigInt(reverse.amountPaise)),
              })
            : ""
        }
        confirmLabel={t("pay.reverse")}
        onConfirm={async () => {
          if (!reverse) return;
          if (!reason.trim()) {
            lazyToast(t("pay.reasonRequired"), "error");
            return;
          }
          try {
            await voidDoc(godownId, reverse._id, reason.trim());
            setReverse(null);
            setReason("");
          } catch (e) {
            lazyToast(t(errorKey(e)), "error");
          }
        }}
      >
        <Input
          className="h-12 text-base"
          placeholder={t("pay.reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="reverse-reason"
        />
      </ConfirmDialog>
      {edit ? (
        <EditPaymentSheet
          payment={edit}
          godownId={godownId}
          onClose={() => setEdit(null)}
          {...(bill?.date ? { minDate: bill.date } : {})}
        />
      ) : null}
    </>
  );
}

function EditPaymentSheet({
  payment,
  godownId,
  onClose,
  minDate,
}: {
  payment: Payment;
  godownId: string;
  onClose: () => void;
  minDate?: string;
}) {
  const { t } = useI18n();
  const [s, setS] = useState<PayState>(payFromDoc(payment));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const r = toPart(s, false, minDate);
    if (r.error || !r.part) return setError(t(r.error ?? "errors.validation.required"));
    const { _id: _drop, ...rest } = payment;
    const { bankAccountId: _b, reference: _r, ...base } = rest as Payment;
    try {
      await saveDoc(godownId, { ...base, ...r.part } as never, {
        id: payment._id,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      onClose();
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={t("pay.edit")}>
      <PaymentFields
        godownId={godownId}
        value={s}
        onChange={setS}
        amountLabel={t("pay.amount")}
        testId="edit-pay"
        {...(minDate ? { minDate } : {})}
      />
      <Input
        className="h-12 text-base"
        placeholder={t("pay.reason")}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button className="h-12 text-base" onClick={() => void save()}>
        {t("pay.save")}
      </Button>
    </BottomSheet>
  );
}

/** "+ বাকি টাকা দিন" / collection against a bill. */
export function AddPaymentSheet({
  open,
  onOpenChange,
  godownId,
  source,
  duePaise,
  direction,
  sourceId,
  totalPaise,
  paidPaise,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  godownId: string;
  source: Doc;
  duePaise: bigint;
  direction: "IN" | "OUT";
  /** Which bill of the source (a trip cost: `trip:cost`); default the source's main bill. */
  sourceId?: string;
  /** Context shown above the form: the deal total and what is already paid / received. */
  totalPaise?: bigint;
  paidPaise?: bigint;
}) {
  const { t, money, date } = useI18n();
  const [s, setS] = useState<PayState>(
    emptyPay(todayIST(), duePaise > 0n ? paiseToInput(duePaise) : ""),
  );
  const [over, setOver] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Any day from the deal's date to today; before, on or after the due date alike.
  const dealDate = sourceId ? undefined : dealDateOf(source);
  const dueDate = sourceId ? undefined : dueDateOf(source);
  const save = async (extraAsAdvance: boolean) => {
    setError(null);
    const r = toPart(s, false, dealDate);
    if (r.error || !r.part) return setError(t(r.error ?? "errors.validation.required"));
    setBusy(true);
    try {
      await payBill(godownId, source, r.part, {
        extraAsAdvance,
        ...(sourceId ? { sourceId } : {}),
      });
      const paid = BigInt(r.part.amountPaise);
      const left = duePaise > paid ? duePaise - paid : 0n;
      lazyToast(t("pay.newDue", { amount: money(left) }), "success");
      setOver(null);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof RepoError && e.code === "OVERPAYMENT") setOver(BigInt(e.detail ?? "0"));
      else setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  if (!open) return null;
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={direction === "OUT" ? t("pay.addTitleOut") : t("pay.addTitleIn")}
      description={t("pay.due", { amount: money(duePaise > 0n ? duePaise : 0n) })}
      testId="add-payment"
    >
      {totalPaise !== undefined ? (
        <dl
          className="bg-muted/50 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl p-3 text-sm"
          data-testid="add-pay-context"
        >
          <dt className="text-muted-foreground">{t("pay.ctxTotal")}</dt>
          <dd className="tabular text-right">{money(totalPaise)}</dd>
          <dt className="text-muted-foreground">
            {t(direction === "OUT" ? "pay.ctxPaidOut" : "pay.ctxPaidIn")}
          </dt>
          <dd className="tabular text-right">{money(paidPaise ?? 0n)}</dd>
          <dt className="font-medium">{t("pay.ctxDue")}</dt>
          <dd className="tabular text-right font-semibold">
            {money(duePaise > 0n ? duePaise : 0n)}
          </dd>
          {dueDate ? (
            <>
              <dt className="text-muted-foreground">{t("pay.ctxDueDate")}</dt>
              <dd className="text-right">{date(dueDate, "short")}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <PaymentFields
        godownId={godownId}
        value={s}
        onChange={setS}
        amountLabel={t("pay.amount")}
        testId="add-pay"
        {...(dealDate ? { minDate: dealDate } : {})}
      />
      {over !== null ? (
        <div
          className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
        >
          {t("pay.over", { extra: money(over) })}
          <Button
            variant="outline"
            className="h-11 bg-white"
            onClick={() => void save(true)}
            data-testid="keep-advance"
          >
            {t("pay.keepAsAdvance")}
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button
        className="h-12 text-base"
        disabled={busy}
        onClick={() => void save(false)}
        data-testid="add-pay-save"
      >
        {t("pay.save")}
      </Button>
    </BottomSheet>
  );
}

"use client";

import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PayModeSchema, SeasonSchema, type PayMode } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { BankPicker } from "./pickers";

export function TextField({
  label,
  value,
  onChange,
  required,
  error,
  testId,
  inputMode,
  placeholder,
  multiline,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: TKey | null;
  testId?: string;
  inputMode?: "text" | "tel" | "numeric" | "email";
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-sm">
        {label}
        {required ? (
          <span aria-hidden className="text-destructive ml-0.5">
            {t("form.requiredMark")}
          </span>
        ) : null}
      </Label>
      {multiline ? (
        <textarea
          id={id}
          data-testid={testId}
          className={cn(
            "border-input min-h-20 rounded-md border px-3 py-2 text-base",
            error ? "border-destructive" : "",
          )}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          data-testid={testId}
          className={cn("h-12 text-base", error ? "border-destructive" : "")}
          value={value}
          inputMode={inputMode}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

/** Business date: defaults to today (IST); future dates are not allowed (`max`). */
export function DateField({
  label,
  value,
  onChange,
  max,
  min,
  testId,
  error,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: string;
  min?: string;
  testId?: string;
  error?: TKey | null;
  optional?: boolean;
}) {
  const { t, date } = useI18n();
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        data-testid={testId}
        className={cn("h-12 text-base", error ? "border-destructive" : "")}
        value={value}
        max={max}
        min={min}
        required={!optional}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {t(error)}
        </p>
      ) : value ? (
        <p className="text-muted-foreground text-xs">{date(value)}</p>
      ) : null}
    </div>
  );
}

/** Segmented choice (large tap targets). */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  wrap,
}: {
  label?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  testId?: string;
  wrap?: boolean;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1"
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
    >
      {label ? <span className="text-sm font-medium">{label}</span> : null}
      <div className={cn("flex gap-1 rounded-md border p-1", wrap ? "flex-wrap" : "")}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-11 flex-1 rounded px-2 text-sm whitespace-nowrap",
              o.value === value
                ? "bg-primary text-primary-foreground font-semibold"
                : "hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface PayModeState {
  mode: PayMode;
  bankAccountId?: string;
  ref: string;
  chequeNo: string;
  chequeDate: string;
}

export const emptyPayMode = (): PayModeState => ({
  mode: "CASH",
  ref: "",
  chequeNo: "",
  chequeDate: "",
});

/** Mode (Cash / Bank transfer / UPI / Cheque / DD / Other) + our bank + reference. */
export function PayModeFields({
  godownId,
  value,
  onChange,
  showCheque,
  testId,
  bankError,
}: {
  godownId: string;
  value: PayModeState;
  onChange: (v: PayModeState) => void;
  showCheque?: boolean;
  testId?: string;
  bankError?: TKey | null;
}) {
  const { t } = useI18n();
  const needsBank = value.mode !== "CASH";
  return (
    <div className="flex flex-col gap-3">
      <Choice
        label={t("payment.mode")}
        value={value.mode}
        wrap
        testId={testId}
        options={PayModeSchema.options.map((m) => ({ value: m, label: t(`payMode.${m}` as TKey) }))}
        onChange={(mode) => onChange({ ...value, mode })}
      />
      {needsBank ? (
        <BankPicker
          godownId={godownId}
          label={t("payment.ourBank")}
          value={value.bankAccountId}
          onChange={(id) => onChange({ ...value, bankAccountId: id })}
          error={bankError}
          allowClear
          testId={testId ? `${testId}-bank` : undefined}
        />
      ) : null}
      {needsBank ? (
        <TextField
          label={t("payment.utrOrRef")}
          value={value.ref}
          onChange={(ref) => onChange({ ...value, ref })}
          maxLength={60}
        />
      ) : null}
      {showCheque && (value.mode === "CHEQUE" || value.mode === "DD") ? (
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label={t("payment.chequeNo")}
            value={value.chequeNo}
            inputMode="numeric"
            maxLength={20}
            onChange={(chequeNo) => onChange({ ...value, chequeNo })}
          />
          <DateField
            label={t("payment.chequeDate")}
            value={value.chequeDate}
            optional
            onChange={(chequeDate) => onChange({ ...value, chequeDate })}
          />
        </div>
      ) : null}
    </div>
  );
}

export function SeasonField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: "AMAN" | "BORO" | "AUS") => void;
}) {
  const { t } = useI18n();
  return (
    <Choice
      label={t("form.season")}
      value={(value ?? "") as "AMAN" | "BORO" | "AUS"}
      options={SeasonSchema.options.map((s) => ({ value: s, label: t(`season.${s}` as TKey) }))}
      onChange={onChange}
    />
  );
}

export function Section({
  title,
  children,
  testId,
}: {
  title?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3" data-testid={testId}>
      {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

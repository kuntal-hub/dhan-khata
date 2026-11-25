"use client";

import { useId, useState, type ReactNode } from "react";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { amountForWeight } from "@/domain/money";
import { cn } from "@/lib/utils";
import {
  parseAmountField,
  parseCountField,
  parsePercentField,
  parseRateField,
  parseWeightField,
  gramsToKgInput,
  type FieldValue,
} from "@/client/ui/parse";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

interface BaseProps {
  label: string;
  value: string;
  onChange: (text: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Extra error (e.g. a business rule) shown under the field. */
  error?: TKey | null;
  hint?: ReactNode;
  testId?: string;
  className?: string;
  placeholder?: string;
  /** Mic inside the field: spoken number, confirmed before filling (§14.1). */
  voice?: boolean;
}

/** Big numeric text field (≥ 48 px, 16 px text, decimal keypad, Bengali digits accepted). */
function NumberField({
  label,
  value,
  onChange,
  disabled,
  error,
  hint,
  testId,
  className,
  placeholder,
  prefix,
  suffix,
  parsed,
  inputMode = "decimal",
  extra,
  voice,
}: BaseProps & {
  prefix?: string;
  suffix?: string;
  parsed: FieldValue;
  inputMode?: "decimal" | "numeric";
  extra?: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const [touched, setTouched] = useState(false);
  const shownError = error ?? (touched || value !== "" ? parsed.error : null);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "border-input focus-within:ring-ring/50 flex h-12 min-w-0 flex-1 items-center rounded-md border px-3 focus-within:ring-[3px]",
            shownError ? "border-destructive" : "",
            disabled ? "bg-muted opacity-70" : "",
          )}
        >
          {prefix ? <span className="text-muted-foreground mr-1 text-base">{prefix}</span> : null}
          <input
            id={id}
            data-testid={testId}
            className="tabular h-full w-full min-w-0 bg-transparent text-base outline-none"
            inputMode={inputMode}
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={shownError ? true : undefined}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          {suffix ? (
            <span className="text-muted-foreground ml-1 shrink-0 text-sm">{suffix}</span>
          ) : null}
          {voice && !disabled ? (
            <VoiceButton
              mode="number"
              onText={onChange}
              className="-mr-2"
              {...(testId ? { testId } : {})}
            />
          ) : null}
        </div>
        {extra}
      </div>
      {shownError ? (
        <p className="text-destructive text-xs" role="alert">
          {t(shownError)}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground tabular text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

export function AmountInput(props: BaseProps & { allowZero?: boolean }) {
  const parsed = parseAmountField(props.value, props.required, props.allowZero === false ? 1n : 0n);
  return <NumberField {...props} prefix="₹" parsed={parsed} />;
}

export function RateInput(props: BaseProps) {
  const { t } = useI18n();
  const parsed = parseRateField(props.value, props.required, props.required ? 1n : 0n);
  return (
    <NumberField
      voice
      {...props}
      prefix="₹"
      suffix={`/${t("units.quintalShort")}`}
      parsed={parsed}
    />
  );
}

export function PercentInput(props: BaseProps) {
  const parsed = parsePercentField(props.value, props.required);
  return <NumberField {...props} suffix="%" parsed={parsed} />;
}

export function CountInput(props: BaseProps) {
  const parsed = parseCountField(props.value, props.required);
  return <NumberField {...props} inputMode="numeric" parsed={parsed} />;
}

/**
 * Weight: kg ("1245.5") or quintal + kg ("12 কু. 45.5"). Shows the parsed weight under the
 * field, and a "bags × average weight" helper.
 */
export function WeightInput(props: BaseProps & { bags?: number; min?: bigint }) {
  const { t, weightOf } = useI18n();
  const parsed = parseWeightField(props.value, props.required, props.min ?? 0n);
  const [helper, setHelper] = useState(false);
  const [avg, setAvg] = useState("");
  const [bags, setBags] = useState(props.bags ? String(props.bags) : "");
  const avgParsed = parseWeightField(avg, true, 1n);
  const bagsParsed = parseCountField(bags, true);
  const product =
    avgParsed.value !== undefined && bagsParsed.value !== undefined
      ? avgParsed.value * bagsParsed.value
      : undefined;
  return (
    <div className="flex flex-col gap-2">
      <NumberField
        {...props}
        suffix={t("units.kg")}
        parsed={parsed}
        hint={
          props.hint ??
          (parsed.value !== undefined ? `= ${weightOf(parsed.value)}` : t("form.weightHint"))
        }
        extra={
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-12 shrink-0"
            aria-label={t("form.bagsTimesAvg")}
            onClick={() => setHelper((h) => !h)}
            disabled={props.disabled}
          >
            <Calculator className="size-5" aria-hidden />
          </Button>
        }
      />
      {helper ? (
        <div className="bg-muted/50 flex flex-col gap-2 rounded-md p-2">
          <p className="text-muted-foreground text-xs">{t("form.bagsTimesAvg")}</p>
          <div className="grid grid-cols-2 gap-2">
            <CountInput label={t("units.bag")} value={bags} onChange={setBags} />
            <NumberField
              label={t("form.avgBagKg")}
              value={avg}
              onChange={setAvg}
              parsed={avgParsed}
              suffix={t("units.kg")}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="h-11"
            disabled={product === undefined}
            onClick={() => {
              if (product === undefined) return;
              props.onChange(gramsToKgInput(product));
              setHelper(false);
            }}
          >
            {product !== undefined ? `= ${weightOf(product)}` : t("form.useResult")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Amount of a weight at a rate, for live previews (exact domain formula). */
export function previewAmount(
  netG: bigint | undefined,
  rate: bigint | undefined,
): bigint | undefined {
  if (netG === undefined || rate === undefined || netG <= 0n) return undefined;
  return amountForWeight(netG, rate);
}

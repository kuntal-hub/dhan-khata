"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Choice, Section, TextField } from "@/components/forms/fields";
import { VarietyPicker } from "@/components/forms/pickers";
import { Computed } from "@/components/money/display";
import {
  AmountInput,
  CountInput,
  PercentInput,
  RateInput,
  WeightInput,
} from "@/components/money/inputs";
import type { DeductionDefaults } from "@/domain/schemas";
import { paren } from "@/client/ui/text";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { evalLine, newLine, type ChargeState, type LineState } from "./lineState";
import { v7 as uuidv7 } from "uuid";

/** Multi-line trade editor: variety, bags, gross, collapsible "বাদ", computed net, rate, amount. */
export function LinesEditor({
  godownId,
  lines,
  onChange,
  defaults,
  showErrors,
  rateWarning,
}: {
  godownId: string;
  lines: LineState[];
  onChange: (lines: LineState[]) => void;
  defaults?: DeductionDefaults;
  showErrors: boolean;
  /** Line keys whose rate is outside the sanity band (warning only). */
  rateWarning?: Set<string>;
}) {
  const { t, weightOf, rate, money } = useI18n();
  const set = (key: string, patch: Partial<LineState>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-3">
      {lines.map((l, i) => {
        const ev = evalLine(l);
        const err = (k: keyof typeof ev.errors): TKey | null =>
          showErrors ? (ev.errors[k] ?? null) : null;
        return (
          <Section
            key={l.key}
            title={lines.length > 1 ? t("trade.lineN", { n: i + 1 }) : undefined}
            testId={`line-${i}`}
          >
            <VarietyPicker
              godownId={godownId}
              label={t("trade.variety")}
              value={l.varietyId}
              onChange={(id) => set(l.key, { varietyId: id })}
              required
              error={err("variety")}
              testId={`line-${i}-variety`}
            />
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <CountInput
                label={t("units.bag")}
                value={l.bags}
                onChange={(bags) => set(l.key, { bags })}
                testId={`line-${i}-bags`}
              />
              <WeightInput
                label={t("trade.grossWeight")}
                value={l.gross}
                onChange={(gross) => set(l.key, { gross })}
                required
                error={err("gross")}
                testId={`line-${i}-gross`}
                {...(l.bags && /^\d+$/.test(l.bags) ? { bags: Number(l.bags) } : {})}
              />
            </div>
            <button
              type="button"
              className="text-primary flex min-h-11 items-center gap-1 self-start text-sm"
              onClick={() => set(l.key, { showDed: !l.showDed })}
              aria-expanded={l.showDed}
              data-testid={`line-${i}-ded-toggle`}
            >
              {l.showDed ? (
                <ChevronUp className="size-4" aria-hidden />
              ) : (
                <ChevronDown className="size-4" aria-hidden />
              )}
              {t("trade.deductions")}
              {ev.result && ev.result.netG !== ev.grossG ? (
                <span className="text-muted-foreground tabular">
                  {paren(weightOf((ev.grossG ?? 0n) - ev.result.netG))}
                </span>
              ) : null}
            </button>
            {l.showDed ? (
              <div className="bg-muted/40 flex flex-col gap-2 rounded-md p-2">
                <WeightInput
                  label={t("trade.bagTare")}
                  value={l.tarePerBag}
                  onChange={(tarePerBag) => set(l.key, { tarePerBag })}
                />
                <Choice
                  label={t("trade.dhalta")}
                  value={l.dhaltaMode}
                  onChange={(dhaltaMode) => set(l.key, { dhaltaMode })}
                  options={[
                    { value: "PER_QUINTAL", label: t("trade.dhaltaPerQtl") },
                    { value: "PER_BAG", label: t("trade.dhaltaPerBag") },
                    { value: "FIXED", label: t("trade.dhaltaFixed") },
                  ]}
                />
                <WeightInput
                  label={t("trade.dhaltaValue")}
                  value={l.dhaltaValue}
                  onChange={(dhaltaValue) => set(l.key, { dhaltaValue })}
                />
                <PercentInput
                  label={t("trade.moistureCut")}
                  value={l.moisture}
                  onChange={(moisture) => set(l.key, { moisture })}
                />
                <WeightInput
                  label={t("trade.otherDeduction")}
                  value={l.otherDed}
                  onChange={(otherDed) => set(l.key, { otherDed })}
                />
                {err("deductions") ? (
                  <p className="text-destructive text-xs">{t(err("deductions")!)}</p>
                ) : null}
              </div>
            ) : null}
            <RateInput
              label={t("trade.rate")}
              value={l.rate}
              onChange={(r) => set(l.key, { rate: r })}
              required
              error={err("rate")}
              testId={`line-${i}-rate`}
            />
            {rateWarning?.has(l.key) ? (
              <p className="text-xs text-amber-700">{t("trade.rateWarning")}</p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Computed
                label={t("trade.netWeight")}
                value={ev.result ? weightOf(ev.result.netG) : "—"}
                testId={`line-${i}-net`}
                formula={
                  ev.result && ev.grossG !== undefined
                    ? `${weightOf(ev.grossG)} − ${weightOf(ev.grossG - ev.result.netG)} = ${weightOf(ev.result.netG)}`
                    : undefined
                }
              />
              <Computed
                label={t("trade.lineAmount")}
                value={ev.result ? money(ev.result.amountPaise) : "—"}
                testId={`line-${i}-amount`}
                formula={
                  ev.result && ev.rate !== undefined
                    ? `${weightOf(ev.result.netG)} × ${rate(ev.rate)} = ${money(ev.result.amountPaise)}`
                    : undefined
                }
              />
            </div>
            {showErrors && err("net") ? (
              <p className="text-destructive text-xs">{t(err("net")!)}</p>
            ) : null}
            {lines.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive h-11 self-end"
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
              >
                <Trash2 className="size-4" aria-hidden />
                {t("trade.removeLine")}
              </Button>
            ) : null}
          </Section>
        );
      })}
      <Button
        type="button"
        variant="outline"
        className="h-12"
        onClick={() => onChange([...lines, newLine(defaults)])}
        data-testid="add-line"
      >
        <Plus className="size-4" aria-hidden />
        {t("trade.addLine")}
      </Button>
    </div>
  );
}

/** Add/deduct charges on a bill (labour, bags, commission…). */
export function ChargesEditor({
  charges,
  onChange,
}: {
  charges: ChargeState[];
  onChange: (c: ChargeState[]) => void;
}) {
  const { t } = useI18n();
  const set = (key: string, patch: Partial<ChargeState>) =>
    onChange(charges.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-col gap-2">
      {charges.map((c) => (
        <div key={c.key} className="flex flex-col gap-2 rounded-md border p-2">
          <TextField
            label={t("trade.chargeLabel")}
            value={c.label}
            onChange={(label) => set(c.key, { label })}
            maxLength={60}
          />
          <Choice
            value={c.kind}
            onChange={(kind) => set(c.key, { kind })}
            options={[
              { value: "add", label: t("trade.chargeAdd") },
              { value: "deduct", label: t("trade.chargeDeduct") },
            ]}
          />
          <AmountInput
            label={t("common.amount")}
            value={c.amount}
            onChange={(amount) => set(c.key, { amount })}
            required
          />
          <Button
            type="button"
            variant="ghost"
            className="text-destructive h-10 self-end"
            onClick={() => onChange(charges.filter((x) => x.key !== c.key))}
          >
            <Trash2 className="size-4" aria-hidden />
            {t("common.delete")}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        className="h-11 self-start"
        onClick={() =>
          onChange([...charges, { key: uuidv7(), label: "", kind: "deduct", amount: "" }])
        }
      >
        <Plus className="size-4" aria-hidden />
        {t("trade.addCharge")}
      </Button>
    </div>
  );
}

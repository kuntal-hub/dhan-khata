/**
 * Form state for trade lines (purchase/sale) and bill charges, plus conversion to voucher draft
 * lines and live previews through the shared domain formulas (never re-implemented here).
 */
import { v7 as uuidv7 } from "uuid";
import { computeBill, computeLine, type LineResult } from "@/domain/calc/trade";
import { DomainError } from "@/domain/errors";
import type { Charge, DeductionDefaults, DhaltaMode, TradeLine } from "@/domain/schemas";
import {
  bpsToInput,
  gramsToKgInput,
  paiseToInput,
  parseAmountField,
  parseCountField,
  parsePercentField,
  parseRateField,
  parseWeightField,
} from "@/client/ui/parse";
import type { TKey } from "@/i18n/translate";

export interface LineState {
  key: string;
  varietyId?: string;
  bags: string;
  gross: string;
  tarePerBag: string;
  dhaltaMode: DhaltaMode;
  dhaltaValue: string;
  moisture: string;
  otherDed: string;
  rate: string;
  showDed: boolean;
}

export interface ChargeState {
  key: string;
  label: string;
  kind: "add" | "deduct";
  amount: string;
}

export function newLine(
  defaults?: DeductionDefaults,
  varietyId?: string,
  rate?: string,
): LineState {
  return {
    key: uuidv7(),
    ...(varietyId ? { varietyId } : {}),
    bags: "",
    gross: "",
    tarePerBag: gramsToKgInput(
      defaults?.tarePerBagG && defaults.tarePerBagG !== "0" ? defaults.tarePerBagG : undefined,
    ),
    dhaltaMode: defaults?.dhaltaMode ?? "PER_QUINTAL",
    dhaltaValue: gramsToKgInput(
      defaults?.dhaltaValueG && defaults.dhaltaValueG !== "0" ? defaults.dhaltaValueG : undefined,
    ),
    moisture: bpsToInput(defaults?.moistureBps || undefined),
    otherDed: "",
    rate: rate ? paiseToInput(rate) : "",
    showDed: false,
  };
}

export function lineFromVoucher(l: TradeLine): LineState {
  return {
    key: uuidv7(),
    varietyId: l.varietyId,
    bags: l.bags !== undefined ? String(l.bags) : "",
    gross: gramsToKgInput(l.grossG),
    tarePerBag: gramsToKgInput(l.tarePerBagG),
    dhaltaMode: l.dhaltaMode ?? "PER_QUINTAL",
    dhaltaValue: gramsToKgInput(l.dhaltaValueG),
    moisture: bpsToInput(l.moistureBps),
    otherDed: gramsToKgInput(l.otherDedG),
    rate: paiseToInput(l.ratePaisePerQtl),
    showDed: false,
  };
}

export interface LineEval {
  draft: TradeLine | null;
  result: LineResult | null;
  errors: Partial<Record<"variety" | "gross" | "rate" | "net" | "bags" | "deductions", TKey>>;
  grossG?: bigint;
  rate?: bigint;
}

/** Parse + compute one line. `draft` is null while anything is missing/invalid. */
export function evalLine(s: LineState): LineEval {
  const errors: LineEval["errors"] = {};
  const gross = parseWeightField(s.gross, true, 1n);
  const rate = parseRateField(s.rate, true, 1n);
  const bags = parseCountField(s.bags, false);
  const tare = parseWeightField(s.tarePerBag, false);
  const dv = parseWeightField(s.dhaltaValue, false);
  const moist = parsePercentField(s.moisture, false);
  const other = parseWeightField(s.otherDed, false);
  if (!s.varietyId) errors.variety = "errors.validation.required";
  if (gross.error) errors.gross = gross.error;
  if (rate.error) errors.rate = rate.error;
  if (bags.error) errors.bags = bags.error;
  const dedError = tare.error ?? dv.error ?? moist.error ?? other.error;
  if (dedError) errors.deductions = dedError;
  if (gross.value === undefined || rate.value === undefined || Object.keys(errors).length > 0) {
    return {
      draft: null,
      result: null,
      errors,
      ...(gross.value !== undefined ? { grossG: gross.value } : {}),
      ...(rate.value !== undefined ? { rate: rate.value } : {}),
    };
  }
  const bagsN = bags.value !== undefined ? Number(bags.value) : undefined;
  let result: LineResult;
  try {
    result = computeLine({
      ...(bagsN !== undefined ? { bags: bagsN } : {}),
      grossG: gross.value,
      ...(tare.value !== undefined ? { tarePerBagG: tare.value } : {}),
      dhaltaMode: s.dhaltaMode,
      ...(dv.value !== undefined ? { dhaltaValueG: dv.value } : {}),
      ...(moist.value !== undefined ? { moistureBps: moist.value } : {}),
      ...(other.value !== undefined ? { otherDedG: other.value } : {}),
      ratePaisePerQtl: rate.value,
    });
  } catch (e) {
    errors.net = e instanceof DomainError ? (`errors.domain.${e.code}` as TKey) : "errors.generic";
    return { draft: null, result: null, errors, grossG: gross.value, rate: rate.value };
  }
  const draft: TradeLine = {
    varietyId: s.varietyId!,
    ...(bagsN !== undefined ? { bags: bagsN } : {}),
    grossG: gross.value.toString(),
    ...(tare.value !== undefined && tare.value > 0n ? { tarePerBagG: tare.value.toString() } : {}),
    dhaltaMode: s.dhaltaMode,
    ...(dv.value !== undefined && dv.value > 0n ? { dhaltaValueG: dv.value.toString() } : {}),
    ...(moist.value !== undefined && moist.value > 0n ? { moistureBps: Number(moist.value) } : {}),
    ...(other.value !== undefined && other.value > 0n ? { otherDedG: other.value.toString() } : {}),
    netG: result.netG.toString(),
    ratePaisePerQtl: rate.value.toString(),
    amountPaise: result.amountPaise.toString(),
  };
  return { draft, result, errors, grossG: gross.value, rate: rate.value };
}

export function chargeFromVoucher(c: Charge): ChargeState {
  return { key: uuidv7(), label: c.label, kind: c.kind, amount: paiseToInput(c.amountPaise) };
}

export function evalCharges(cs: ChargeState[]): { charges: Charge[] | null; error: TKey | null } {
  const out: Charge[] = [];
  for (const c of cs) {
    const a = parseAmountField(c.amount, true);
    if (a.error || a.value === undefined)
      return { charges: null, error: a.error ?? "errors.validation.required" };
    if (!c.label.trim()) return { charges: null, error: "errors.validation.required" };
    out.push({ label: c.label.trim(), kind: c.kind, amountPaise: a.value.toString() });
  }
  return { charges: out, error: null };
}

export interface BillPreview {
  subTotal: bigint;
  chargesTotal: bigint;
  roundOff: bigint;
  total: bigint;
}

export function previewBill(
  lines: LineEval[],
  charges: Charge[] | null,
  roundToRupee: boolean,
): BillPreview | null {
  if (lines.some((l) => !l.result) || !charges) return null;
  try {
    return computeBill(
      lines.map((l) => l.result!.amountPaise),
      charges.map((c) => ({ kind: c.kind, amount: BigInt(c.amountPaise) })),
      roundToRupee,
    );
  } catch {
    return null;
  }
}

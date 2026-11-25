"use client";

/**
 * WeightInput (requirement_v2 §12.2, §6.2): বস্তা ধরে (bag by bag, unlimited, fast Enter → next
 * bag, edit/delete with undo, chip view, live total / count / average in kg · qtl · mon) or
 * মোট ওজন (total with a kg / quintal / mon selector, optional bag count). Optional deductions
 * block only when the business switched them on. Every value is exact grams.
 */
import { useRef, useState } from "react";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parsePercent } from "@/domain/money";
import { formatWeightNumber, gramsToInput, parseWeightIn, type WeightUnit } from "@/domain/units";
import type { WeightBlock } from "@/domain/schemas";
import { computeWeight, type WeightResult } from "@/domain/v2/weightBlock";
import { DomainError } from "@/domain/errors";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { FieldBox, Segmented } from "./Fields";

export interface WeightState {
  mode: "BAGS" | "MANUAL";
  bags: Array<{ id: string; text: string }>;
  manual: string;
  unit: WeightUnit;
  bagCount: string;
  tare: string;
  dhalta: string;
  moisture: string;
  other: string;
}

let bagSeq = 0;
const bagId = () => `b${Date.now().toString(36)}${(bagSeq++).toString(36)}`;

export function emptyWeight(mode: "BAGS" | "MANUAL" = "BAGS"): WeightState {
  return {
    mode,
    bags: [{ id: bagId(), text: "" }],
    manual: "",
    unit: "QTL",
    bagCount: "",
    tare: "",
    dhalta: "",
    moisture: "",
    other: "",
  };
}

/** Restore the input state from a stored block (edit). */
export function weightFromBlock(w: WeightBlock): WeightState {
  const g = (s?: string) => (s && s !== "0" ? gramsToInput(BigInt(s), "KG") : "");
  return {
    mode: w.mode,
    bags:
      w.mode === "BAGS" && w.bags?.length
        ? w.bags.map((b) => ({ id: b.id, text: gramsToInput(BigInt(b.weightG), "KG") }))
        : [{ id: bagId(), text: "" }],
    manual: w.mode === "MANUAL" ? gramsToInput(BigInt(w.totalG), "QTL") : "",
    unit: "QTL",
    bagCount: w.bagCount ? String(w.bagCount) : "",
    tare: g(w.deductions?.tareG),
    dhalta: g(w.deductions?.dhaltaG),
    moisture: w.deductions?.moistureBps ? (w.deductions.moistureBps / 100).toString() : "", // float-ok: percent display of an integer bps
    other: g(w.deductions?.otherG),
  };
}

export interface WeightParse {
  block?: WeightBlock;
  result?: WeightResult;
  error?: TKey;
}

export function parseWeightState(
  s: WeightState,
  monKg: number,
  deductionsEnabled: boolean,
): WeightParse {
  const kg = (txt: string): bigint | TKey => {
    if (!txt.trim()) return 0n;
    const r = parseWeightIn(txt, "KG");
    return r.ok ? r.value : (r.error as TKey);
  };
  let block: WeightBlock;
  if (s.mode === "BAGS") {
    const bags: NonNullable<WeightBlock["bags"]> = [];
    for (const b of s.bags) {
      if (!b.text.trim()) continue;
      const v = kg(b.text);
      if (typeof v === "string") return { error: v };
      if (v <= 0n) return { error: "errors.validation.positive" };
      bags.push({ id: b.id, seq: bags.length + 1, weightG: v.toString() });
    }
    if (bags.length === 0) return { error: "errors.validation.required" };
    block = { mode: "BAGS", bags, totalG: "1", netG: "1" };
  } else {
    if (!s.manual.trim()) return { error: "errors.validation.required" };
    const r = parseWeightIn(s.manual, s.unit, monKg);
    if (!r.ok) return { error: r.error as TKey };
    if (r.value <= 0n) return { error: "errors.validation.positive" };
    block = {
      mode: "MANUAL",
      totalG: r.value.toString(),
      netG: r.value.toString(),
      ...(s.bagCount.trim() && /^\d+$/.test(s.bagCount.trim())
        ? { bagCount: Number(s.bagCount.trim()) }
        : {}),
    }; // float-ok: bag count is an integer
  }
  if (deductionsEnabled) {
    const ded: NonNullable<WeightBlock["deductions"]> = {};
    for (const [k, txt] of [
      ["tareG", s.tare],
      ["dhaltaG", s.dhalta],
      ["otherG", s.other],
    ] as const) {
      const v = kg(txt);
      if (typeof v === "string") return { error: v };
      if (v > 0n) ded[k] = v.toString();
    }
    if (s.moisture.trim()) {
      const p = parsePercent(s.moisture);
      if (!p.ok) return { error: p.error as TKey };
      if (p.value > 0n) ded.moistureBps = Number(p.value); // float-ok: basis points are an integer
    }
    if (Object.keys(ded).length) block.deductions = ded;
  }
  try {
    const result = computeWeight(block, deductionsEnabled);
    return {
      block: { ...block, totalG: result.totalG.toString(), netG: result.netG.toString() },
      result,
    };
  } catch (e) {
    return {
      error:
        e instanceof DomainError && e.code === "NET_NOT_POSITIVE"
          ? "errors.domain.NET_NOT_POSITIVE"
          : "errors.generic",
    };
  }
}

export function WeightBlockInput({
  value,
  onChange,
  monKg,
  deductionsEnabled,
  testId = "weight",
}: {
  value: WeightState;
  onChange: (s: WeightState) => void;
  monKg: number;
  deductionsEnabled: boolean;
  testId?: string;
}) {
  const { t, digits, count } = useI18n();
  const refs = useRef(new Map<string, HTMLInputElement>());
  const [removed, setRemoved] = useState<{
    index: number;
    bag: { id: string; text: string };
  } | null>(null);
  const parsed = parseWeightState(value, monKg, deductionsEnabled);
  const r = parsed.result;
  const o = { digits, monKg };
  const fmt = (g: bigint, u: WeightUnit) => formatWeightNumber(g, u, o);

  const setBag = (id: string, text: string) =>
    onChange({ ...value, bags: value.bags.map((b) => (b.id === id ? { ...b, text } : b)) });
  const addBag = (focus = true) => {
    const nb = { id: bagId(), text: "" };
    onChange({ ...value, bags: [...value.bags, nb] });
    if (focus) requestAnimationFrame(() => refs.current.get(nb.id)?.focus());
  };
  const removeBag = (i: number) => {
    const bag = value.bags[i]!;
    const bags = value.bags.filter((_, k) => k !== i);
    onChange({ ...value, bags: bags.length ? bags : [{ id: bagId(), text: "" }] });
    setRemoved({ index: i, bag });
  };
  const undo = () => {
    if (!removed) return;
    const bags = [...value.bags];
    bags.splice(removed.index, 0, removed.bag);
    onChange({ ...value, bags });
    setRemoved(null);
  };
  const filled = value.bags.filter((b) => b.text.trim());

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <Segmented
        label={t("pur.quantity")}
        value={value.mode}
        options={[
          ["BAGS", t("wt.byBags")],
          ["MANUAL", t("wt.manual")],
        ]}
        onChange={(mode) => onChange({ ...value, mode })}
        testId={`${testId}-mode`}
      />
      {value.mode === "BAGS" ? (
        <>
          {filled.length > 1 ? (
            <div className="flex flex-wrap gap-1.5" aria-hidden>
              {filled.map((b, i) => (
                <span
                  key={b.id}
                  className="bg-gold-100 text-accent-foreground tabular rounded-full px-2.5 py-1 text-xs"
                >
                  {t("wt.bagChip", { n: count(i + 1), w: b.text, unit: t("ui.unitKg") })}
                </span>
              ))}
            </div>
          ) : null}
          <ol className="flex flex-col gap-2">
            {value.bags.map((b, i) => (
              <li
                key={b.id}
                className="animate-in fade-in slide-in-from-top-1 flex items-center gap-2 duration-150"
              >
                <span className="text-muted-foreground tabular w-16 shrink-0 text-sm">
                  {t("wt.bagN", { n: count(i + 1) })}
                </span>
                <div className="border-input focus-within:ring-ring/50 flex h-12 min-w-0 flex-1 items-center rounded-md border px-3 focus-within:ring-[3px]">
                  <input
                    ref={(el) => {
                      if (el) refs.current.set(b.id, el);
                      else refs.current.delete(b.id);
                    }}
                    className="tabular h-full w-full min-w-0 bg-transparent text-base outline-none"
                    inputMode="decimal"
                    enterKeyHint="next"
                    autoComplete="off"
                    aria-label={t("wt.bagN", { n: i + 1 })}
                    value={b.text}
                    data-testid={`${testId}-bag-${i}`}
                    onChange={(e) => setBag(b.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (i === value.bags.length - 1) addBag();
                        else refs.current.get(value.bags[i + 1]!.id)?.focus();
                      }
                    }}
                  />
                  <span className="text-muted-foreground ml-1 text-sm">{t("wt.bagKg")}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label={t("wt.removeBag")}
                  onClick={() => removeBag(i)}
                >
                  <Trash2 className="size-5" aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          {removed ? (
            <div
              className="bg-muted flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm"
              role="status"
            >
              <span>{t("wt.bagRemoved", { n: count(removed.index + 1) })}</span>
              <Button type="button" variant="ghost" className="h-10" onClick={undo}>
                <Undo2 className="size-4" aria-hidden />
                {t("wt.undo")}
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="border-primary/40 text-primary h-12 border-dashed text-base"
            onClick={() => addBag()}
            data-testid={`${testId}-add-bag`}
          >
            <Plus className="size-5" aria-hidden />
            {t("wt.addBag")}
          </Button>
          <p className="text-muted-foreground text-xs">{t("wt.enterHint")}</p>
        </>
      ) : (
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <FieldBox label={t("wt.total")}>
            <div className="border-input focus-within:ring-ring/50 flex h-12 min-w-0 items-center rounded-md border pr-1 focus-within:ring-[3px]">
              <input
                className="tabular h-full min-w-0 flex-1 bg-transparent px-3 text-base outline-none"
                inputMode="decimal"
                value={value.manual}
                onChange={(e) => onChange({ ...value, manual: e.target.value })}
                data-testid={`${testId}-manual`}
                aria-label={t("wt.total")}
              />
              <VoiceButton
                mode="number"
                onText={(manual) => onChange({ ...value, manual })}
                testId={`${testId}-manual`}
              />
            </div>
          </FieldBox>
          <div className="w-44">
            <Segmented
              label={t("wt.unit")}
              value={value.unit}
              options={[
                ["KG", t("ui.unitKg")],
                ["QTL", t("ui.unitQtlShort")],
                ["MON", t("ui.unitMon")],
              ]}
              onChange={(unit) => onChange({ ...value, unit })}
              testId={`${testId}-unit`}
            />
          </div>
          <div className="col-span-2">
            <FieldBox label={t("wt.bagCount")}>
              <input
                className="border-input tabular h-12 rounded-md border px-3 text-base outline-none"
                inputMode="numeric"
                value={value.bagCount}
                onChange={(e) => onChange({ ...value, bagCount: e.target.value })}
              />
            </FieldBox>
          </div>
        </div>
      )}
      {deductionsEnabled ? (
        <details className="bg-muted/50 rounded-xl border p-3">
          <summary className="min-h-11 cursor-pointer content-center text-[15px] font-medium">
            {t("wt.deductions")}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {(
              [
                ["tare", t("wt.tare")],
                ["dhalta", t("wt.dhalta")],
                ["moisture", t("wt.moisture")],
                ["other", t("wt.other")],
              ] as const
            ).map(([k, l]) => (
              <FieldBox key={k} label={l}>
                <input
                  className="border-input bg-card tabular h-12 rounded-md border px-3 text-base outline-none"
                  inputMode="decimal"
                  value={value[k]}
                  onChange={(e) => onChange({ ...value, [k]: e.target.value })}
                />
              </FieldBox>
            ))}
          </div>
        </details>
      ) : null}
      <div
        className="bg-forest-100/60 grid grid-cols-3 gap-2 rounded-xl p-3 text-center"
        data-testid={`${testId}-summary`}
      >
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">
            {deductionsEnabled && r && r.netG !== r.totalG ? t("wt.net") : t("wt.total")}
          </span>
          <span
            className="tabular text-base font-semibold"
            data-testid={`${testId}-total-qtl`}
            data-grams={r?.netG.toString() ?? ""}
          >
            {r ? `${fmt(r.netG, "QTL")} ${t("ui.unitQtlShort")}` : "—"}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">{t("wt.bags")}</span>
          <span className="tabular text-base font-semibold">
            {r && r.bagCount ? count(r.bagCount) : "—"}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">{t("wt.avg")}</span>
          <span className="tabular text-base font-semibold">
            {r?.avgBagG !== null && r?.avgBagG !== undefined
              ? `${fmt(r.avgBagG, "KG")} ${t("ui.unitKg")}`
              : "—"}
          </span>
        </div>
        {r ? (
          <p className="text-muted-foreground tabular col-span-3 text-xs">
            {fmt(r.netG, "KG")} {t("ui.unitKg")} · {fmt(r.netG, "QTL")} {t("ui.unitQtlShort")} ·{" "}
            {fmt(r.netG, "MON")} {t("ui.unitMon")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

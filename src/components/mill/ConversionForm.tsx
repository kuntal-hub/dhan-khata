"use client";

/**
 * Milling conversion (requirement_v2 §12.8D), MILLING dispatches only: the dispatch, date, paddy
 * actually milled, the rice / by-product returns that came out of it (picked from that dispatch's
 * returns), and the loss. The app never assumes a ratio: it shows
 * `consumed − outputs = loss` and the user confirms the loss (DECISIONS D11). The yield % is for
 * information. Saving takes the consumed paddy out of mill stock (§9.2).
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { DateField, FieldBox } from "@/components/entry/Fields";
import { varietyName } from "@/components/entry/Variety";
import {
  emptyWeight,
  parseWeightState,
  WeightBlockInput,
  type WeightState,
} from "@/components/entry/WeightBlockInput";
import { FormShell } from "@/components/forms/FormShell";
import { Button } from "@/components/ui/button";
import { VoiceText } from "@/components/voice/VoiceText";
import { errorKey } from "@/client/errors";
import { useBusiness } from "@/client/hooks";
import { conversionBps, convertibleReturns, dispatchRows } from "@/client/queries/mill";
import { newId, saveDoc, type DraftOf } from "@/client/repo";
import { todayIST } from "@/domain/dates";
import type { DocOf, Godown } from "@/domain/schemas";
import { formatWeightNumber, gramsToInput } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

type Conv = DocOf<"CONVERSION">;

interface State {
  dispatchId?: string;
  date: string;
  consumed: WeightState;
  outputs: string[];
  lossOk: boolean;
  notes: string;
}

function initial(existing?: Conv, dispatchId?: string): State {
  if (existing) {
    return {
      dispatchId: existing.dispatchId,
      date: existing.conversionDate,
      consumed: {
        ...emptyWeight("MANUAL"),
        manual: gramsToInput(BigInt(existing.paddyConsumedG), "KG"),
        unit: "KG",
      },
      outputs: existing.outputs.map((o) => o.returnId),
      lossOk: true,
      notes: existing.notes ?? "",
    };
  }
  return {
    ...(dispatchId ? { dispatchId } : {}),
    date: todayIST(),
    consumed: emptyWeight("MANUAL"),
    outputs: [],
    lossOk: false,
    notes: "",
  };
}

export function ConversionForm({
  godown,
  existing,
  dispatchId,
}: {
  godown: Godown;
  existing?: Conv;
  dispatchId?: string;
}) {
  const { t, digits, date, count } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const monKg = business?.monKg ?? 40;
  const o = { digits, monKg };
  const [s, setS] = useState<State>(() => initial(existing, dispatchId));
  const [id] = useState(() => existing?._id ?? newId());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState(false);
  const [overOk, setOverOk] = useState(false);
  const [over, setOver] = useState<{ have: bigint; need: bigint } | null>(null);
  const set = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch, ...("lossOk" in patch ? {} : { lossOk: false }) }));
    setDirty(true);
    setOver(null);
    setOverOk(false);
  };

  const dispatches = useLiveQuery(
    () =>
      dispatchRows(godown._id, { type: "MILLING" }).then((rows) =>
        rows.filter(
          (r) =>
            r.doc._id === s.dispatchId || (r.doc.status === "active" && r.balance.remainingG > 0n),
        ),
      ),
    [godown._id, s.dispatchId],
  );
  const chosen = dispatches?.find((r) => r.doc._id === s.dispatchId);
  const returns = useLiveQuery(
    () => (s.dispatchId ? convertibleReturns(s.dispatchId, existing?._id) : Promise.resolve([])),
    [s.dispatchId, existing?._id],
  );
  const w = parseWeightState(s.consumed, monKg, false);
  const consumed = w.result?.netG;
  const picked = (returns ?? []).filter((r) => s.outputs.includes(r._id));
  const outputsG = picked.reduce((a, r) => a + BigInt(r.weight.netG), 0n);
  const loss = consumed !== undefined ? consumed - outputsG : undefined;
  const left =
    chosen !== undefined
      ? chosen.balance.remainingG +
        (existing && existing.status === "active" ? BigInt(existing.paddyConsumedG) : 0n)
      : undefined;
  const qtl = (g: bigint) => formatWeightNumber(g, "QTL", o);

  const save = async (acceptOver: boolean) => {
    setShowErrors(true);
    setError(null);
    if (!chosen || consumed === undefined || consumed <= 0n || loss === undefined) {
      return setError(t("acct.required"));
    }
    if (!s.lossOk) return setError(t("mill.confirmLossRequired"));
    if (!acceptOver && left !== undefined && consumed > left) {
      setOver({ have: left, need: consumed });
      return;
    }
    setSaving(true);
    try {
      const draft: DraftOf<"CONVERSION"> = {
        type: "CONVERSION",
        ...(existing ? {} : { _id: id }),
        dispatchId: chosen.doc._id,
        millPartyId: chosen.doc.millPartyId,
        varietyId: chosen.doc.varietyId,
        conversionDate: s.date,
        paddyConsumedG: consumed.toString(),
        outputs: picked.map((r) => ({
          returnId: r._id,
          product: r.product as "RICE" | "OTHER",
          ...(r.product === "OTHER" && r.otherProductName ? { name: r.otherProductName } : {}),
          ...(r.varietyId ? { varietyId: r.varietyId } : {}),
          qtyG: r.weight.netG,
          ...(r.totalValuePaise !== undefined ? { valuePaise: r.totalValuePaise } : {}),
        })),
        lossG: "0",
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      };
      await saveDoc(godown._id, draft, existing ? { id: existing._id } : {});
      setDirty(false);
      if (existing) router.replace(`/mill/conversion/view?id=${existing._id}`);
      else setSaved(true);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div
        className="bg-background fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 p-6 text-center"
        data-testid="conversion-saved"
      >
        <CheckCircle2
          className="animate-in zoom-in-50 size-16 text-emerald-600 duration-300"
          aria-hidden
        />
        <p className="text-xl font-semibold">{t("mill.convSaved")}</p>
        <Button
          className="h-12 w-full max-w-sm text-base"
          onClick={() => router.replace(`/mill/conversion/view?id=${id}`)}
          data-testid="conversion-open-detail"
        >
          {t("mill.openDetail")}
        </Button>
      </div>
    );
  }

  return (
    <FormShell
      title={t(existing ? "mill.convEdit" : "mill.convNew", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save(overOk)}
      saveLabel={t("mill.save")}
      testId="conversion-form"
      backHref="/mill?tab=conversion"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t("mill.loss")}</span>
          <span className="tabular text-lg font-semibold" data-testid="conversion-loss">
            {loss !== undefined ? `${qtl(loss)} ${t("ui.unitQtlShort")}` : "—"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <FieldBox
          label={t("mill.convDispatch")}
          hint={t("mill.convOnlyMilling")}
          error={showErrors && !s.dispatchId ? t("acct.required") : null}
        >
          {dispatches && dispatches.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("mill.noOpenDispatch")}</p>
          ) : (
            <div
              className="flex flex-col gap-2"
              role="radiogroup"
              data-testid="conversion-dispatch"
            >
              {(dispatches ?? []).map((r) => (
                <button
                  key={r.doc._id}
                  type="button"
                  role="radio"
                  aria-checked={s.dispatchId === r.doc._id}
                  disabled={!!existing && r.doc._id !== existing.dispatchId}
                  onClick={() => set({ dispatchId: r.doc._id, outputs: [] })}
                  className={cn("choice min-h-12 px-3 text-left text-sm")}
                >
                  {t("mill.dispatchPick", {
                    mill: r.mill?.name ?? "",
                    date: date(r.doc.dispatchDate, "short"),
                    variety: varietyName(r.variety, t),
                    qty: qtl(r.balance.remainingG),
                  })}
                  <span className="text-muted-foreground block text-xs">{r.doc.number}</span>
                </button>
              ))}
            </div>
          )}
        </FieldBox>
        <DateField
          label={t("mill.convDate")}
          value={s.date}
          onChange={(d) => set({ date: d })}
          testId="conversion-date"
        />
        <FieldBox label={t("mill.paddyConsumed")} error={showErrors && w.error ? t(w.error) : null}>
          <WeightBlockInput
            value={s.consumed}
            onChange={(consumed) => set({ consumed })}
            monKg={monKg}
            deductionsEnabled={false}
            testId="conversion-consumed"
          />
        </FieldBox>
        <FieldBox label={t("mill.outputs")}>
          {s.dispatchId && returns && returns.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("mill.noOutputs")}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="conversion-outputs">
              {(returns ?? []).map((r) => {
                const on = s.outputs.includes(r._id);
                return (
                  <li key={r._id}>
                    <label
                      className={cn(
                        "press flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm",
                        on ? "border-primary bg-forest-100/60" : "bg-card",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={on}
                        onChange={() =>
                          set({
                            outputs: on
                              ? s.outputs.filter((x) => x !== r._id)
                              : [...s.outputs, r._id],
                          })
                        }
                      />
                      <span className="flex-1">
                        {r.product === "OTHER" ? r.otherProductName : t("mill.RICE")} ·{" "}
                        {qtl(BigInt(r.weight.netG))} {t("ui.unitQtlShort")}
                        <span className="text-muted-foreground block text-xs">
                          {date(r.returnDate, "short")} · {r.number}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </FieldBox>
        {consumed !== undefined && loss !== undefined ? (
          <section
            className="bg-card shadow-card flex flex-col gap-2 rounded-2xl border p-4"
            data-testid="conversion-formula"
          >
            <p className="tabular text-[15px] font-medium">
              {t("mill.formula", {
                consumed: qtl(consumed),
                outputs: qtl(outputsG),
                loss: qtl(loss),
              })}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("mill.convPct", {
                pct: count(Number(conversionBps(consumed, outputsG) / 100n)), // float-ok: whole percent for display
              })}
            </p>
            <p className="text-muted-foreground text-xs">{t("mill.noRatio")}</p>
            <label className="flex min-h-11 items-center gap-3 text-[15px]">
              <input
                type="checkbox"
                className="size-5"
                checked={s.lossOk}
                onChange={(e) => {
                  setS((x) => ({ ...x, lossOk: e.target.checked }));
                  setDirty(true);
                }}
                data-testid="conversion-loss-ok"
              />
              {t("mill.confirmLoss", { loss: qtl(loss) })}
            </label>
          </section>
        ) : null}
        <FieldBox label={t("mill.notes")}>
          <VoiceText value={s.notes} onChange={(notes) => set({ notes })} />
        </FieldBox>
        {over ? (
          <div
            className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            role="alert"
          >
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("mill.convWarn", { have: qtl(over.have), need: qtl(over.need) })}
            </span>
            <Button
              variant="outline"
              className="h-11 bg-white"
              onClick={() => {
                setOverOk(true);
                void save(true);
              }}
            >
              {t("mill.saveAnyway")}
            </Button>
          </div>
        ) : null}
        {error ? (
          <p
            className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </FormShell>
  );
}

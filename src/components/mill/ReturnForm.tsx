"use client";

/**
 * Mill return (requirement_v2.1 §12.8C): the original dispatch (required; shows mill, date,
 * variety, paddy still at the mill), return date, product ধান / চাল / অন্যান্য (+ name), rice
 * variety, bag-wise or total weight, notes. A paddy return is a CREDIT to the mill: "credit value"
 * = quantity × the dispatch's rate (editable), shown as "মিলের পাওনা ₹X কমবে". A return never
 * carries money (no payment fields). Rice / other change stock only.
 * Paddy goes back to the Gola and out of mill stock; rice / other only to their own stock. More
 * paddy than is left at the mill for that dispatch, or a possible duplicate (same dispatch, date,
 * product, quantity within 10 minutes), needs a confirmation. The id is fixed when the form opens,
 * so a double tap can't save twice.
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { DateField, FieldBox, Segmented } from "@/components/entry/Fields";
import { varietyName, VarietyPicker } from "@/components/entry/Variety";
import {
  emptyWeight,
  parseWeightState,
  weightFromBlock,
  WeightBlockInput,
  type WeightState,
} from "@/components/entry/WeightBlockInput";
import { FormShell } from "@/components/forms/FormShell";
import { AmountInput } from "@/components/money/inputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceText } from "@/components/voice/VoiceText";
import { errorKey } from "@/client/errors";
import { useBusiness } from "@/client/hooks";
import { dispatchRows } from "@/client/queries/mill";
import { findDuplicateReturn, newId, saveMillReturn, type DraftOf } from "@/client/repo";
import { paiseToInput, parseAmountField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import { amountForWeight } from "@/domain/money";
import type { DocOf, Godown } from "@/domain/schemas";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

type Ret = DocOf<"MILL_RETURN">;
type Product = Ret["product"];

interface State {
  dispatchId?: string;
  date: string;
  product: Product;
  otherName: string;
  riceVarietyId?: string;
  weight: WeightState;
  /** Paddy: a typed credit value (empty = quantity × the dispatch rate). */
  credit: string;
  notes: string;
}

function initial(existing?: Ret, dispatchId?: string): State {
  if (existing) {
    // A credit typed by hand (no rate stored) stays as typed.
    const typed =
      existing.product === "PADDY" && !existing.ratePaisePerQtl && existing.totalValuePaise;
    return {
      dispatchId: existing.dispatchId,
      date: existing.returnDate,
      product: existing.product,
      otherName: existing.otherProductName ?? "",
      ...(existing.product === "RICE" && existing.varietyId
        ? { riceVarietyId: existing.varietyId }
        : {}),
      weight: weightFromBlock(existing.weight),
      credit: typed ? paiseToInput(existing.totalValuePaise!) : "",
      notes: existing.notes ?? "",
    };
  }
  return {
    ...(dispatchId ? { dispatchId } : {}),
    date: todayIST(),
    product: "PADDY",
    otherName: "",
    weight: emptyWeight("BAGS"),
    credit: "",
    notes: "",
  };
}

type Warn = { kind: "over"; have: bigint; need: bigint } | { kind: "dup"; number: string };

export function ReturnForm({
  godown,
  existing,
  dispatchId,
}: {
  godown: Godown;
  existing?: Ret;
  dispatchId?: string;
}) {
  const { t, money, digits, date } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const monKg = business?.monKg ?? 40;
  const [s, setS] = useState<State>(() => initial(existing, dispatchId));
  const [id] = useState(() => existing?._id ?? newId());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [warn, setWarn] = useState<Warn | null>(null);
  const [accepted, setAccepted] = useState<Set<Warn["kind"]>>(new Set());
  const set = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
    setWarn(null);
    setAccepted(new Set());
  };
  const o = { digits, monKg };

  const dispatches = useLiveQuery(
    () =>
      dispatchRows(godown._id).then((rows) =>
        rows.filter(
          (r) =>
            r.doc._id === s.dispatchId ||
            (r.doc.status === "active" && r.balance.remainingG > 0n && !r.settlement),
        ),
      ),
    [godown._id, s.dispatchId],
  );
  const chosen = dispatches?.find((r) => r.doc._id === s.dispatchId);
  const w = parseWeightState(s.weight, monKg, false);
  // Credit (paddy only): typed, or quantity × the dispatch rate.
  const typedCredit = s.credit.trim() ? parseAmountField(s.credit, false, 0n) : undefined;
  const autoCredit =
    chosen && w.result
      ? amountForWeight(w.result.netG, BigInt(chosen.doc.ratePaisePerQtl))
      : undefined;
  const credit = s.product !== "PADDY" ? undefined : (typedCredit?.value ?? autoCredit);
  // Paddy still at the mill for this dispatch (this return excluded when editing).
  const left =
    chosen !== undefined
      ? chosen.balance.remainingG +
        (existing && existing.product === "PADDY" && existing.status === "active"
          ? BigInt(existing.weight.netG)
          : 0n)
      : undefined;

  const save = async (accept: Set<Warn["kind"]>) => {
    setShowErrors(true);
    setError(null);
    if (!chosen || !w.block || !w.result || typedCredit?.error) return setError(t("acct.required"));
    if (s.product === "OTHER" && !s.otherName.trim()) return setError(t("acct.required"));
    if (
      !accept.has("over") &&
      s.product === "PADDY" &&
      left !== undefined &&
      w.result.netG > left
    ) {
      setWarn({ kind: "over", have: left, need: w.result.netG });
      return;
    }
    if (!accept.has("dup")) {
      const dup = await findDuplicateReturn(
        godown._id,
        {
          dispatchId: chosen.doc._id,
          returnDate: s.date,
          product: s.product,
          netG: w.result.netG.toString(),
        },
        existing?._id ?? id,
      );
      if (dup) {
        setWarn({ kind: "dup", number: dup.number });
        return;
      }
    }
    setSaving(true);
    try {
      const draft: DraftOf<"MILL_RETURN"> = {
        type: "MILL_RETURN",
        ...(existing ? {} : { _id: id }),
        dispatchId: chosen.doc._id,
        millPartyId: chosen.doc.millPartyId,
        returnDate: s.date,
        product: s.product,
        ...(s.product === "PADDY" ? { varietyId: chosen.doc.varietyId } : {}),
        ...(s.product === "RICE" && s.riceVarietyId ? { varietyId: s.riceVarietyId } : {}),
        ...(s.product === "OTHER" ? { otherProductName: s.otherName.trim() } : {}),
        weight: w.block,
        ...(s.product === "PADDY"
          ? typedCredit?.value !== undefined
            ? { totalValuePaise: typedCredit.value.toString() }
            : { ratePaisePerQtl: chosen.doc.ratePaisePerQtl }
          : // Rice / other: stock only; an old record keeps its informational value unchanged.
            {
              ...(existing?.ratePaisePerQtl ? { ratePaisePerQtl: existing.ratePaisePerQtl } : {}),
              ...(existing?.totalValuePaise ? { totalValuePaise: existing.totalValuePaise } : {}),
            }),
        dedupeKey: "",
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      };
      await saveMillReturn(godown._id, draft, existing ? { id: existing._id } : {});
      setDirty(false);
      if (existing) router.replace(`/mill/return/view?id=${existing._id}`);
      else setSaved(id);
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
        data-testid="return-saved"
      >
        <CheckCircle2
          className="animate-in zoom-in-50 size-16 text-emerald-600 duration-300"
          aria-hidden
        />
        <p className="text-xl font-semibold">{t("mill.returnSaved")}</p>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Button
            className="h-12 text-base"
            onClick={() => router.replace(`/mill/return/view?id=${saved}`)}
            data-testid="return-open-detail"
          >
            {t("mill.openDetail")}
          </Button>
          {chosen ? (
            <Button
              variant="outline"
              className="h-12 text-base"
              onClick={() => router.replace(`/mill/dispatch/view?id=${chosen.doc._id}`)}
            >
              {t("mill.dispatchTitle", { number: chosen.doc.number })}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <FormShell
      title={t(existing ? "mill.returnEdit" : "mill.returnNew", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save(accepted)}
      saveLabel={t("mill.save")}
      testId="return-form"
      backHref="/mill?tab=return"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t("mill.quantity")}</span>
          <span className="tabular text-lg font-semibold" data-testid="return-qty">
            {w.result
              ? `${formatWeightNumber(w.result.netG, "QTL", o)} ${t("ui.unitQtlShort")}`
              : "—"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <FieldBox
          label={t("mill.dispatch")}
          error={showErrors && !s.dispatchId ? t("acct.required") : null}
        >
          {dispatches && dispatches.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("mill.noOpenDispatch")}</p>
          ) : (
            <div className="flex flex-col gap-2" role="radiogroup" data-testid="return-dispatch">
              {(dispatches ?? []).map((r) => (
                <button
                  key={r.doc._id}
                  type="button"
                  role="radio"
                  aria-checked={s.dispatchId === r.doc._id}
                  disabled={!!existing && r.doc._id !== existing.dispatchId}
                  onClick={() => set({ dispatchId: r.doc._id })}
                  className={cn("choice min-h-12 px-3 text-left text-sm")}
                >
                  {t("mill.dispatchPick", {
                    mill: r.mill?.name ?? "",
                    date: date(r.doc.dispatchDate, "short"),
                    variety: varietyName(r.variety, t),
                    qty: formatWeightNumber(r.balance.remainingG, "QTL", o),
                  })}
                  <span className="text-muted-foreground block text-xs">
                    {r.doc.number} · {money(BigInt(r.doc.ratePaisePerQtl))}/{t("ui.unitQtlShort")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </FieldBox>
        <DateField
          label={t("mill.returnDate")}
          value={s.date}
          onChange={(d) => set({ date: d })}
          testId="return-date"
        />
        <FieldBox label={t("mill.product")} hint={t("mill.riceOnly")}>
          <Segmented
            label={t("mill.product")}
            value={s.product}
            options={[
              ["PADDY", t("mill.PADDY")],
              ["RICE", t("mill.RICE")],
              ["OTHER", t("mill.OTHER")],
            ]}
            onChange={(product) => set({ product })}
            testId="return-product"
          />
        </FieldBox>
        {s.product === "OTHER" ? (
          <FieldBox
            label={t("mill.otherName")}
            error={showErrors && !s.otherName.trim() ? t("acct.required") : null}
          >
            <Input
              className="h-12 text-base"
              value={s.otherName}
              onChange={(e) => set({ otherName: e.target.value })}
              data-testid="return-other-name"
            />
          </FieldBox>
        ) : null}
        {s.product === "RICE" ? (
          <VarietyPicker
            godownId={godown._id}
            value={s.riceVarietyId}
            onChange={(riceVarietyId) => set({ riceVarietyId })}
            product="RICE"
            label={t("mill.riceVariety")}
            testId="return-rice-variety"
          />
        ) : null}
        {chosen && s.product === "PADDY" ? (
          <p className="text-muted-foreground -mt-3 text-xs">
            {varietyName(chosen.variety, t)} ·{" "}
            {t("mill.atMillShort", { qty: formatWeightNumber(left ?? 0n, "QTL", o) })}
          </p>
        ) : null}
        <FieldBox label={t("mill.quantity")} error={showErrors && w.error ? t(w.error) : null}>
          <WeightBlockInput
            value={s.weight}
            onChange={(weight) => set({ weight })}
            monKg={monKg}
            deductionsEnabled={false}
            testId="return-weight"
          />
        </FieldBox>
        {s.product === "PADDY" ? (
          <section className="bg-card shadow-card flex flex-col gap-2 rounded-2xl border p-4">
            <AmountInput
              label={t("mill.creditValue")}
              value={
                s.credit !== ""
                  ? s.credit
                  : autoCredit !== undefined
                    ? paiseToInput(autoCredit)
                    : ""
              }
              onChange={(v) => set({ credit: v })}
              allowZero
              testId="return-credit"
              {...(chosen
                ? {
                    hint: t("mill.creditHint", { rate: money(BigInt(chosen.doc.ratePaisePerQtl)) }),
                  }
                : {})}
            />
            {credit !== undefined ? (
              <p
                className="tabular text-sm font-medium text-emerald-800"
                data-testid="return-credit-effect"
                data-paise={credit.toString()}
              >
                {t("mill.creditEffect", { amount: money(credit) })}
              </p>
            ) : null}
          </section>
        ) : (
          <p className="text-muted-foreground text-sm">{t("mill.riceNoMoney")}</p>
        )}
        <p className="text-muted-foreground text-xs">{t("mill.noMoneyOnReturn")}</p>
        <FieldBox label={t("mill.notes")}>
          <VoiceText value={s.notes} onChange={(notes) => set({ notes })} />
        </FieldBox>
        {warn ? (
          <div
            className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            role="alert"
            data-testid={`return-warn-${warn.kind}`}
          >
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {warn.kind === "over"
                ? t("mill.returnWarn", {
                    have: formatWeightNumber(warn.have, "QTL", o),
                    need: formatWeightNumber(warn.need, "QTL", o),
                  })
                : t("mill.dupWarn", { number: warn.number })}
            </span>
            <Button
              variant="outline"
              className="h-11 bg-white"
              onClick={() => {
                const next = new Set(accepted).add(warn.kind);
                setAccepted(next);
                setWarn(null);
                void save(next);
              }}
              data-testid="return-save-anyway"
            >
              {warn.kind === "over" ? t("mill.saveAnyway") : t("mill.saveAgain")}
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

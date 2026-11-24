"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormShell } from "@/components/forms/FormShell";
import { DateField, TextField } from "@/components/forms/fields";
import { VarietyPicker } from "@/components/forms/pickers";
import { Qty } from "@/components/money/display";
import { WeightInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { saveSimple, type VoucherDraft } from "@/client/repo";
import { gramsToKgInput, parseWeightField } from "@/client/ui/parse";
import { STOCK_ADJUST_REASONS, type Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { today, useAfterSave, useGodownTitle, useSaveError } from "@/components/trade/common";
import { useVoucher } from "@/components/trade/hooks";

type Reason = (typeof STOCK_ADJUST_REASONS)[number];

interface LineState {
  varietyId?: string;
  counted: string;
  reason: Reason;
  note: string;
}

const emptyLine = (): LineState => ({ counted: "", reason: "DRYING", note: "" });

/** STORE quantity of each variety at the end of `date`, excluding one voucher (when editing). */
async function bookQty(
  godownId: string,
  date: string,
  excludeId?: string,
): Promise<Map<string, bigint>> {
  const moves = await db()
    .stockMoves.where("[godownId+date]")
    .between([godownId, ""], [godownId, date], true, true)
    .filter((m) => m.location === "STORE" && m.voucherId !== excludeId)
    .toArray();
  const out = new Map<string, bigint>();
  for (const m of moves) out.set(m.varietyId, (out.get(m.varietyId) ?? 0n) + BigInt(m.qtyG));
  return out;
}

/** Physical stock count → STOCK_ADJUST with a reason per variety (spec §9.11). */
export function StockAdjustForm({ editId }: { editId?: string }) {
  const { godownId, readOnly } = useWriteGodown();
  const existing = useVoucher(editId);
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || existing === undefined) return <Loading />;
  if (editId && (!existing || existing.type !== "STOCK_ADJUST"))
    return <ReadOnlyNotice reason="notFound" />;
  return <Inner key={editId ?? "new"} godownId={godownId} existing={existing} />;
}

function Inner({ godownId, existing }: { godownId: string; existing: Voucher | null }) {
  const { t } = useI18n();
  const godownName = useGodownTitle();
  const [date, setDate] = useState(existing?.date ?? today());
  const [lines, setLines] = useState<LineState[] | null>(existing ? null : [emptyLine()]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [reason, setReason] = useState("");
  const afterSave = useAfterSave();
  const onError = useSaveError();
  const books = useLiveQuery(
    () => bookQty(godownId, date, existing?._id),
    [godownId, date, existing?._id],
  );
  if (!books) return <Loading />;
  // Editing: counted = books (without this voucher) + this voucher's adjustment.
  const current: LineState[] =
    lines ??
    (existing && existing.type === "STOCK_ADJUST"
      ? existing.lines.map((l) => ({
          varietyId: l.varietyId,
          counted: gramsToKgInput((books.get(l.varietyId) ?? 0n) + BigInt(l.qtyG)),
          reason: l.reason,
          note: l.note ?? "",
        }))
      : [emptyLine()]);
  const set = (next: LineState[]) => {
    setLines(next);
    setDirty(true);
  };
  const parsed = current.map((l) => {
    const c = parseWeightField(l.counted, true);
    const book = l.varietyId ? (books.get(l.varietyId) ?? 0n) : 0n;
    return { c, book, diff: c.value !== undefined ? c.value - book : undefined };
  });
  const changed = current
    .map((l, i) => ({ l, p: parsed[i]! }))
    .filter((x) => x.l.varietyId && x.p.diff !== undefined && x.p.diff !== 0n);
  const synced = existing?.serverSeq !== undefined;

  const save = async () => {
    setShowErrors(true);
    if (current.some((l, i) => !l.varietyId || parsed[i]!.c.value === undefined)) return;
    if (changed.length === 0) return;
    if (synced && !reason.trim()) return;
    setSaving(true);
    try {
      const d = {
        type: "STOCK_ADJUST",
        date,
        lines: changed.map(({ l, p }) => ({
          varietyId: l.varietyId!,
          qtyG: p.diff!.toString(),
          reason: l.reason,
          ...(l.note.trim() ? { note: l.note.trim() } : {}),
        })),
      } as VoucherDraft;
      const res = await saveSimple(godownId, d, {
        ...(existing ? { id: existing._id } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setDirty(false);
      afterSave(res.primary._id, "/voucher/view", { receipt: false });
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell
      title={t("stockPage.adjustTitle", { godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="stock-adjust-form"
    >
      <DateField
        label={t("common.date")}
        value={date}
        max={today()}
        onChange={(d) => {
          setDate(d);
          setDirty(true);
        }}
      />
      {current.map((l, i) => {
        const p = parsed[i]!;
        return (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-md border p-2"
            data-testid={`adjust-line-${i}`}
          >
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <VarietyPicker
                  godownId={godownId}
                  label={t("stockPage.variety")}
                  value={l.varietyId}
                  onChange={(varietyId) =>
                    set(current.map((x, j) => (j === i ? { ...x, varietyId } : x)))
                  }
                  required
                  error={showErrors && !l.varietyId ? "errors.validation.required" : null}
                  testId={`adjust-${i}-variety`}
                />
              </div>
              {current.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-12"
                  aria-label={t("godowns.removeRow")}
                  onClick={() => set(current.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>
            {l.varietyId ? (
              <div className="flex justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{t("stockPage.inBooks")}</span>
                <Qty grams={p.book} testId={`adjust-${i}-book`} className="font-medium" />
              </div>
            ) : null}
            <WeightInput
              label={t("stockPage.counted")}
              value={l.counted}
              onChange={(counted) => set(current.map((x, j) => (j === i ? { ...x, counted } : x)))}
              required
              error={showErrors ? p.c.error : null}
              testId={`adjust-${i}-counted`}
            />
            {p.diff !== undefined && l.varietyId ? (
              <p
                className={`text-sm font-semibold ${p.diff < 0n ? "text-red-700 dark:text-red-400" : p.diff > 0n ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
                data-testid={`adjust-${i}-diff`}
                data-grams={p.diff.toString()}
              >
                {t("stockPage.diff")}
                {": "}
                <Qty grams={p.diff} />
              </p>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="text-sm">{t("stockPage.reason")}</span>
              <select
                className="border-input h-12 rounded-md border px-2 text-base"
                value={l.reason}
                onChange={(e) =>
                  set(
                    current.map((x, j) =>
                      j === i ? { ...x, reason: e.target.value as Reason } : x,
                    ),
                  )
                }
                data-testid={`adjust-${i}-reason`}
              >
                {STOCK_ADJUST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`stock.adjustReason.${r}` as TKey)}
                  </option>
                ))}
              </select>
            </div>
            <TextField
              label={t("common.notes")}
              value={l.note}
              onChange={(note) => set(current.map((x, j) => (j === i ? { ...x, note } : x)))}
              maxLength={200}
            />
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => set([...current, emptyLine()])}
      >
        {t("stockPage.addLine")}
      </Button>
      {showErrors && changed.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("stockPage.noDiff")}</p>
      ) : null}
      {synced ? (
        <TextField
          label={t("voucher.editReason")}
          value={reason}
          onChange={setReason}
          required
          error={showErrors && !reason.trim() ? "errors.validation.required" : null}
          testId="edit-reason"
        />
      ) : null}
    </FormShell>
  );
}

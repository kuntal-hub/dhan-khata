"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { v7 as uuidv7 } from "uuid";
import { Button } from "@/components/ui/button";
import { FormShell } from "@/components/forms/FormShell";
import { Choice, DateField, Section, TextField } from "@/components/forms/fields";
import { Computed } from "@/components/money/display";
import { AmountInput, PercentInput, RateInput, WeightInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { saveMillSettlement, type VoucherDraft } from "@/client/repo";
import {
  bpsToInput,
  gramsToKgInput,
  paiseToInput,
  parseAmountField,
  parsePercentField,
  parseRateField,
  parseWeightField,
} from "@/client/ui/parse";
import { recomputeSettlement } from "@/domain/calc/settlement";
import { totalNetG } from "@/domain/calc/trade";
import { divRoundHalfUp } from "@/domain/rounding";
import type { MillSettlementVoucher, Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { useVoucher } from "./hooks";
import { today, useAfterSave, useGodownTitle, useSaveError } from "./common";

interface Ded {
  key: string;
  label: string;
  unit: "G" | "BPS" | "PAISE";
  value: string;
}

interface State {
  date: string;
  gross: string;
  deductions: Ded[];
  rate: string;
  notes: string;
  reason: string;
}

/** "মিলের ওজন দিন" for a sale → MILL_SETTLEMENT (spec §9.3). */
export function SettlementForm({ saleId }: { saleId?: string }) {
  const { godownId, readOnly } = useWriteGodown();
  const sale = useVoucher(saleId);
  const current = useLiveQuery(
    async () =>
      saleId && godownId
        ? ((await db()
            .vouchers.where("[godownId+type+date]")
            .between([godownId, "MILL_SETTLEMENT", ""], [godownId, "MILL_SETTLEMENT", "￿"])
            .filter(
              (v) => v.status === "active" && v.type === "MILL_SETTLEMENT" && v.saleId === saleId,
            )
            .first()) ?? null)
        : null,
    [saleId, godownId],
  );
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || sale === undefined || current === undefined) return <Loading />;
  if (!sale || sale.type !== "SALE" || sale.status !== "active")
    return <ReadOnlyNotice reason="notFound" />;
  return <Inner godownId={godownId} sale={sale} current={current} />;
}

function initial(sale: Voucher & { type: "SALE" }, cur: Voucher | null): State {
  if (cur && cur.type === "MILL_SETTLEMENT") {
    return {
      date: cur.date,
      gross: gramsToKgInput(cur.millReceivedGrossG),
      deductions: cur.millDeductions.map((d) => ({
        key: uuidv7(),
        label: d.label,
        unit: d.g ? "G" : d.bps !== undefined ? "BPS" : "PAISE",
        value: d.g
          ? gramsToKgInput(d.g)
          : d.bps !== undefined
            ? bpsToInput(d.bps)
            : paiseToInput(d.paise),
      })),
      rate: paiseToInput(cur.finalRatePaisePerQtl),
      notes: cur.notes ?? "",
      reason: "",
    };
  }
  const net = totalNetG(sale.lines);
  const avg = net > 0n ? divRoundHalfUp(BigInt(sale.totalPaise) * 100_000n, net) : 0n;
  const singleRate = sale.lines.length === 1 ? sale.lines[0]!.ratePaisePerQtl : avg.toString();
  return {
    date: today(),
    gross: gramsToKgInput(net),
    deductions: [],
    rate: paiseToInput(singleRate),
    notes: "",
    reason: "",
  };
}

function Inner({
  godownId,
  sale,
  current,
}: {
  godownId: string;
  sale: Voucher & { type: "SALE" };
  current: Voucher | null;
}) {
  const { t, money, weightOf } = useI18n();
  const godownName = useGodownTitle();
  const [s, setS] = useState<State>(() => initial(sale, current));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const afterSave = useAfterSave();
  const onError = useSaveError();
  const update = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const gross = parseWeightField(s.gross, true, 1n);
  const rate = parseRateField(s.rate, true, 1n);
  const dispatched = totalNetG(sale.lines);
  const deds = s.deductions.map((d) => {
    const p =
      d.unit === "G"
        ? parseWeightField(d.value, true)
        : d.unit === "BPS"
          ? parsePercentField(d.value, true)
          : parseAmountField(d.value, true);
    return { d, p };
  });
  const dedError = deds.some((x) => x.p.error || !x.d.label.trim());

  let preview: MillSettlementVoucher | null = null;
  if (gross.value && rate.value && !dedError) {
    try {
      preview = recomputeSettlement({
        millReceivedGrossG: gross.value.toString(),
        millDeductions: deds.map(({ d, p }) => ({
          label: d.label.trim(),
          ...(d.unit === "G"
            ? { g: p.value!.toString() }
            : d.unit === "BPS"
              ? { bps: Number(p.value) }
              : { paise: p.value!.toString() }),
        })),
        finalRatePaisePerQtl: rate.value.toString(),
        dispatchedNetG: dispatched.toString(),
        saleTotalPaise: sale.totalPaise,
        millNetG: "1",
        finalAmountPaise: "0",
        differencePaise: "0",
        shortageG: "0",
      } as MillSettlementVoucher);
    } catch {
      preview = null;
    }
  }
  const synced = current?.serverSeq !== undefined;

  const save = async () => {
    setShowErrors(true);
    if (!preview || (synced && !s.reason.trim())) return;
    setSaving(true);
    try {
      const d = {
        type: "MILL_SETTLEMENT",
        date: s.date,
        saleId: sale._id,
        partyId: sale.partyId,
        dispatchedNetG: dispatched.toString(),
        saleTotalPaise: sale.totalPaise,
        millReceivedGrossG: preview.millReceivedGrossG,
        millDeductions: preview.millDeductions,
        millNetG: "1",
        finalRatePaisePerQtl: preview.finalRatePaisePerQtl,
        finalAmountPaise: "0",
        differencePaise: "0",
        shortageG: "0",
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      } as VoucherDraft;
      await saveMillSettlement(
        godownId,
        sale._id,
        d,
        s.reason.trim() ? { reason: s.reason.trim() } : {},
      );
      setDirty(false);
      afterSave(sale._id, "/sale/view", { receipt: false });
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell
      title={t("sale.settleTitle", { godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="settle-form"
      totals={
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">{t("sale.difference")}</span>
          <span className="tabular text-lg font-semibold" data-testid="settle-diff">
            {preview ? money(BigInt(preview.differencePaise)) : "—"}
          </span>
        </div>
      }
    >
      <Section title={sale.number}>
        <div className="grid grid-cols-2 gap-2">
          <Computed label={t("sale.dispatchedNet")} value={weightOf(dispatched)} />
          <Computed label={t("sale.billTotal")} value={money(BigInt(sale.totalPaise))} />
        </div>
      </Section>
      <DateField
        label={t("common.date")}
        value={s.date}
        max={today()}
        onChange={(date) => update({ date })}
      />
      <WeightInput
        label={t("sale.millGross")}
        value={s.gross}
        onChange={(g) => update({ gross: g })}
        required
        testId="settle-gross"
      />
      <Section title={t("sale.millDeductions")}>
        {s.deductions.map((d, i) => (
          <div key={d.key} className="flex flex-col gap-2 rounded-md border p-2">
            <TextField
              label={t("trade.chargeLabel")}
              value={d.label}
              onChange={(label) =>
                update({
                  deductions: s.deductions.map((x) => (x.key === d.key ? { ...x, label } : x)),
                })
              }
              testId={`settle-ded-${i}-label`}
            />
            <Choice
              value={d.unit}
              onChange={(unit) =>
                update({
                  deductions: s.deductions.map((x) =>
                    x.key === d.key ? { ...x, unit, value: "" } : x,
                  ),
                })
              }
              options={[
                { value: "G", label: t("units.kg") },
                { value: "BPS", label: t("sale.percent") },
                { value: "PAISE", label: t("common.amount") },
              ]}
            />
            {d.unit === "G" ? (
              <WeightInput
                label={t("trade.deductions")}
                value={d.value}
                onChange={(value) =>
                  update({
                    deductions: s.deductions.map((x) => (x.key === d.key ? { ...x, value } : x)),
                  })
                }
              />
            ) : d.unit === "BPS" ? (
              <PercentInput
                label={t("trade.deductions")}
                value={d.value}
                onChange={(value) =>
                  update({
                    deductions: s.deductions.map((x) => (x.key === d.key ? { ...x, value } : x)),
                  })
                }
              />
            ) : (
              <AmountInput
                label={t("trade.deductions")}
                value={d.value}
                onChange={(value) =>
                  update({
                    deductions: s.deductions.map((x) => (x.key === d.key ? { ...x, value } : x)),
                  })
                }
              />
            )}
            <Button
              type="button"
              variant="ghost"
              className="text-destructive h-10 self-end"
              onClick={() => update({ deductions: s.deductions.filter((x) => x.key !== d.key) })}
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
            update({
              deductions: [...s.deductions, { key: uuidv7(), label: "", unit: "BPS", value: "" }],
            })
          }
        >
          <Plus className="size-4" aria-hidden />
          {t("sale.addMillDeduction")}
        </Button>
        {showErrors && dedError ? (
          <p className="text-destructive text-xs">{t("errors.validation.required")}</p>
        ) : null}
      </Section>
      <RateInput
        label={t("sale.finalRate")}
        value={s.rate}
        onChange={(r) => update({ rate: r })}
        required
        testId="settle-rate"
      />
      {preview ? (
        <Section title={t("sale.summary")}>
          <div className="grid grid-cols-2 gap-2">
            <Computed
              label={t("sale.millNet")}
              value={weightOf(BigInt(preview.millNetG))}
              testId="settle-mill-net"
            />
            <Computed
              label={t("sale.finalAmount")}
              value={money(BigInt(preview.finalAmountPaise))}
            />
            <Computed label={t("sale.difference")} value={money(BigInt(preview.differencePaise))} />
            <Computed
              label={t("sale.shortage")}
              value={weightOf(BigInt(preview.shortageG))}
              testId="settle-shortage"
            />
          </div>
        </Section>
      ) : null}
      <TextField
        label={t("common.notes")}
        value={s.notes}
        onChange={(notes) => update({ notes })}
        multiline
        maxLength={1000}
      />
      {synced ? (
        <TextField
          label={t("voucher.editReason")}
          value={s.reason}
          onChange={(reason) => update({ reason })}
          required
          testId="edit-reason"
        />
      ) : null}
    </FormShell>
  );
}

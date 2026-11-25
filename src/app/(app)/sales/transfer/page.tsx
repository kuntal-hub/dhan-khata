"use client";

/**
 * Inter-Gola transfer (requirement_v2 §12.3, owner only): paddy leaves this Gola as a sale and
 * arrives in the other Gola as a purchase, both at the stated rate, in one write (one op group).
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { DateField, FieldBox } from "@/components/entry/Fields";
import { VarietyPicker } from "@/components/entry/Variety";
import {
  emptyWeight,
  parseWeightState,
  WeightBlockInput,
  type WeightState,
} from "@/components/entry/WeightBlockInput";
import { FormShell } from "@/components/forms/FormShell";
import { RateInput } from "@/components/money/inputs";
import { Fresh, ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { lazyToast } from "@/components/system/IdleToaster";
import { Input } from "@/components/ui/input";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useBusiness, useGodownRole } from "@/client/hooks";
import { saveInterGolaTransfer } from "@/client/repo";
import { parseRateField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import { divRoundHalfUp } from "@/domain/rounding";
import type { Godown } from "@/domain/schemas";
import { formatWeightNumber } from "@/domain/units";
import { computeBill } from "@/domain/v2/weightBlock";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

function TransferForm({ godown, others }: { godown: Godown; others: Godown[] }) {
  const { t, money, digits } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const monKg = business?.monKg ?? 40;
  const [to, setTo] = useState<string | undefined>(
    others.length === 1 ? others[0]!._id : undefined,
  );
  const [date, setDate] = useState(todayIST());
  const [varietyId, setVarietyId] = useState<string>();
  const [weight, setWeight] = useState<WeightState>(emptyWeight("MANUAL"));
  const [rate, setRate] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const w = parseWeightState(weight, monKg, false);
  const r = parseRateField(rate, true, 1n);
  const bill =
    w.result && r.value !== undefined ? computeBill(w.result.netG, r.value, false) : undefined;
  const o = { digits, monKg };
  const stock = useLiveQuery(async () => {
    if (!varietyId) return undefined;
    const moves = await db()
      .stockMoves.where("[godownId+product+location]")
      .equals([godown._id, "PADDY", "WAREHOUSE"])
      .filter((m) => m.varietyId === varietyId)
      .toArray();
    let q = 0n;
    let v = 0n;
    for (const m of moves) {
      q += BigInt(m.qtyG);
      v += BigInt(m.valuePaise);
    }
    return { qtyG: q, avgPerQtl: q > 0n ? divRoundHalfUp(v * 100_000n, q) : 0n };
  }, [godown._id, varietyId]);
  const toName = others.find((g) => g._id === to)?.name ?? "";

  const save = async () => {
    setError(null);
    if (!to || !varietyId || !w.block || r.value === undefined) return setError(t("acct.required"));
    setSaving(true);
    try {
      const [sale] = await saveInterGolaTransfer({
        fromGodownId: godown._id,
        toGodownId: to,
        date,
        varietyId,
        weight: w.block,
        ratePaisePerQtl: r.value.toString(),
        ...(vehicle.trim() ? { vehicleNumber: vehicle.trim().toUpperCase() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setDirty(false);
      lazyToast(t("sl.transferSaved"), "success");
      router.replace(`/sales/view?id=${sale._id}`);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };

  const change =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setDirty(true);
    };
  return (
    <FormShell
      title={t("sl.transferTitle", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      saveLabel={t("sl.transferSave")}
      testId="transfer-form"
      backHref="/sales"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t("sl.total")}</span>
          <span className="tabular text-lg font-semibold" data-testid="transfer-total">
            {bill ? money(bill.totalPaise) : "—"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <FieldBox label={t("sl.toGola")}>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("sl.toGola")}>
            {others.map((g) => (
              <button
                key={g._id}
                type="button"
                role="radio"
                aria-checked={to === g._id}
                onClick={() => change(setTo)(g._id)}
                data-testid={`transfer-to-${g.code}`}
                className={cn(
                  "press min-h-12 rounded-xl border px-3 text-sm",
                  to === g._id ? "border-primary bg-primary text-primary-foreground" : "bg-card",
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
        </FieldBox>
        {to ? (
          <p className="bg-gold-100 text-accent-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
            <ArrowRightLeft className="size-4 shrink-0" aria-hidden />
            {t("sl.transferInfo", { gola: toName })}
          </p>
        ) : null}
        <DateField
          label={t("sl.date")}
          value={date}
          onChange={change(setDate)}
          testId="transfer-date"
        />
        <VarietyPicker
          godownId={godown._id}
          value={varietyId}
          onChange={change(setVarietyId)}
          testId="transfer-variety"
        />
        {stock ? (
          <p className="text-muted-foreground -mt-3 text-xs">
            {t("sl.stockNow", { qty: formatWeightNumber(stock.qtyG, "QTL", o) })}
          </p>
        ) : null}
        <FieldBox label={t("sl.quantity")} error={w.error && dirty ? t(w.error) : null}>
          <WeightBlockInput
            value={weight}
            onChange={change(setWeight)}
            monKg={monKg}
            deductionsEnabled={false}
            testId="transfer-weight"
          />
        </FieldBox>
        <RateInput
          label={t("sl.transferRate")}
          value={rate}
          onChange={change(setRate)}
          required
          testId="transfer-rate"
          hint={
            stock && stock.avgPerQtl > 0n
              ? t("sl.transferAvg", { rate: money(stock.avgPerQtl) })
              : undefined
          }
        />
        <FieldBox label={t("sl.vehicle")}>
          <Input
            className="h-12 text-base uppercase"
            value={vehicle}
            onChange={(e) => change(setVehicle)(e.target.value)}
          />
        </FieldBox>
        <FieldBox label={t("sl.notes")}>
          <Input
            className="h-12 text-base"
            value={notes}
            onChange={(e) => change(setNotes)(e.target.value)}
          />
        </FieldBox>
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

export default function TransferPage() {
  const { t } = useI18n();
  const { godown, readOnly } = useWriteGodown();
  const { godowns } = useActiveGodown();
  const role = useGodownRole();
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  const others = (godowns ?? []).filter((g) => g.status === "active" && g._id !== godown._id);
  if (role !== "owner" || others.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-center" role="status">
        {role !== "owner" ? t("sl.ownerOnly") : t("sl.noOtherGola")}
      </p>
    );
  }
  return (
    <Fresh>
      <TransferForm godown={godown} others={others} />
    </Fresh>
  );
}

"use client";

/**
 * Load khata entry (requirement_v2 §12.5): loading date, party loaded from, destination mill,
 * variety, bag-wise or total weight, rate → total, vehicle number, driver, second party, notes.
 * A load is a register entry (no money, no stock). Editing a linked load shows the linked record's
 * quantity next to the new one and offers "update the linked record too" (still one deduction).
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { CheckCircle2, Info } from "lucide-react";
import { DateField, FieldBox, PartyPicker } from "@/components/entry/Fields";
import { VarietyPicker } from "@/components/entry/Variety";
import {
  emptyWeight,
  parseWeightState,
  weightFromBlock,
  WeightBlockInput,
  type WeightState,
} from "@/components/entry/WeightBlockInput";
import { FormShell } from "@/components/forms/FormShell";
import { RateInput } from "@/components/money/inputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/client/errors";
import { useBusiness } from "@/client/hooks";
import { activeLinkOf, newId, saveLoad, type DraftOf } from "@/client/repo";
import { paiseToInput, parseRateField } from "@/client/ui/parse";
import { todayIST } from "@/domain/dates";
import { amountForWeight } from "@/domain/money";
import type { DocOf, Godown } from "@/domain/schemas";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";

type Load = DocOf<"LOAD">;

interface State {
  date: string;
  fromId?: string;
  millId?: string;
  varietyId?: string;
  weight: WeightState;
  rate: string;
  vehicle: string;
  driver: string;
  secondId?: string;
  notes: string;
}

function initial(existing?: Load): State {
  if (existing) {
    return {
      date: existing.transactionDate,
      ...(existing.fromPartyId ? { fromId: existing.fromPartyId } : {}),
      ...(existing.destinationMillId ? { millId: existing.destinationMillId } : {}),
      varietyId: existing.varietyId,
      weight: weightFromBlock(existing.weight),
      rate: paiseToInput(existing.ratePaisePerQtl),
      vehicle: existing.vehicleNumber,
      driver: existing.driverName ?? "",
      ...(existing.secondPartyId ? { secondId: existing.secondPartyId } : {}),
      notes: existing.notes ?? "",
    };
  }
  return {
    date: todayIST(),
    weight: emptyWeight("BAGS"),
    rate: "",
    vehicle: "",
    driver: "",
    notes: "",
  };
}

export const normalizeVehicle = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function LoadForm({ godown, existing }: { godown: Godown; existing?: Load }) {
  const { t, money, digits } = useI18n();
  const router = useRouter();
  const business = useBusiness();
  const monKg = business?.monKg ?? 40;
  const deductions = business?.settings.deductionsEnabled ?? false;
  const o = { digits, monKg };
  const [s, setS] = useState<State>(() => initial(existing));
  const [id] = useState(() => existing?._id ?? newId());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState(false);
  const [updateLinked, setUpdateLinked] = useState(true);
  const set = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const linked = useLiveQuery(
    () => (existing ? activeLinkOf(existing) : Promise.resolve(undefined)),
    [existing?._id, existing?.rev],
  );

  const w = parseWeightState(s.weight, monKg, deductions);
  const rate = parseRateField(s.rate, false, 0n);
  const total = w.result ? amountForWeight(w.result.netG, rate.value ?? 0n) : undefined;
  const linkedG =
    linked && (linked.type === "SALE" || linked.type === "MILL_DISPATCH")
      ? BigInt(linked.weight.netG)
      : undefined;

  const save = async () => {
    setShowErrors(true);
    setError(null);
    const vehicle = normalizeVehicle(s.vehicle);
    if (!s.varietyId || !w.block || rate.error || !vehicle) return setError(t("acct.required"));
    setSaving(true);
    try {
      const draft: DraftOf<"LOAD"> = {
        type: "LOAD",
        ...(existing ? {} : { _id: id }),
        transactionDate: s.date,
        ...(s.fromId ? { fromPartyId: s.fromId } : {}),
        ...(s.millId ? { destinationMillId: s.millId } : {}),
        varietyId: s.varietyId,
        weight: w.block,
        ratePaisePerQtl: (rate.value ?? 0n).toString(),
        totalPaise: "0",
        vehicleNumber: vehicle,
        ...(s.driver.trim() ? { driverName: s.driver.trim() } : {}),
        ...(s.secondId ? { secondPartyId: s.secondId } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
      };
      await saveLoad(godown._id, draft, {
        ...(existing ? { id: existing._id } : {}),
        ...(existing && linked ? { updateLinked } : {}),
      });
      setDirty(false);
      if (existing) router.replace(`/loads/view?id=${existing._id}`);
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
        data-testid="load-saved"
      >
        <CheckCircle2
          className="animate-in zoom-in-50 size-16 text-emerald-600 duration-300"
          aria-hidden
        />
        <p className="text-xl font-semibold">{t("ld.saved")}</p>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Button
            className="h-12 text-base"
            onClick={() => router.replace(`/loads/view?id=${id}`)}
            data-testid="load-open-detail"
          >
            {t("ld.openDetail")}
          </Button>
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => router.push(`/print/load?id=${id}`)}
          >
            {t("ld.printSlip")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FormShell
      title={t(existing ? "ld.editTitle" : "ld.newTitle", { gola: godown.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      saveLabel={t("ld.save")}
      testId="load-form"
      backHref="/loads"
      totals={
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-xs">{t("ld.total")}</span>
          <span className="tabular text-lg font-semibold" data-testid="load-total">
            {total !== undefined ? money(total) : "—"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        <p className="bg-gold-100 text-accent-foreground flex items-start gap-2 rounded-xl px-3 py-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("ld.registerOnly")}
        </p>
        <DateField
          label={t("ld.date")}
          value={s.date}
          onChange={(d) => set({ date: d })}
          testId="load-date"
        />
        <PartyPicker
          godownId={godown._id}
          roles={["FARMER", "SUPPLIER", "GOLA"]}
          createRole="FARMER"
          value={s.fromId}
          onChange={(fromId) => set({ fromId })}
          label={t("ld.from")}
          testId="load-from"
        />
        <PartyPicker
          godownId={godown._id}
          roles={["MILL"]}
          createRole="MILL"
          value={s.millId}
          onChange={(millId) => set({ millId })}
          label={t("ld.mill")}
          testId="load-mill"
        />
        <VarietyPicker
          godownId={godown._id}
          value={s.varietyId}
          onChange={(varietyId) => set({ varietyId })}
          testId="load-variety"
          error={showErrors && !s.varietyId ? t("acct.required") : null}
        />
        <FieldBox label={t("ld.quantity")} error={showErrors && w.error ? t(w.error) : null}>
          <WeightBlockInput
            value={s.weight}
            onChange={(weight) => set({ weight })}
            monKg={monKg}
            deductionsEnabled={deductions}
            testId="load-weight"
          />
        </FieldBox>
        {linked && linkedG !== undefined ? (
          <div
            className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            data-testid="load-linked-qty"
          >
            <span>
              {t("ld.linkedQty", {
                record: linked.number,
                qty: formatWeightNumber(linkedG, "QTL", o),
              })}
            </span>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5"
                checked={updateLinked}
                onChange={(e) => setUpdateLinked(e.target.checked)}
                data-testid="load-update-linked"
              />
              {t("ld.updateLinked")}
            </label>
          </div>
        ) : null}
        <RateInput
          label={t("ld.rate")}
          value={s.rate}
          onChange={(r) => set({ rate: r })}
          testId="load-rate"
        />
        <div className="grid grid-cols-2 gap-3">
          <FieldBox
            label={t("ld.vehicle")}
            error={showErrors && !normalizeVehicle(s.vehicle) ? t("acct.required") : null}
          >
            <Input
              className="h-12 text-base uppercase"
              value={s.vehicle}
              onChange={(e) => set({ vehicle: e.target.value })}
              data-testid="load-vehicle"
            />
          </FieldBox>
          <FieldBox label={t("ld.driver")}>
            <Input
              className="h-12 text-base"
              value={s.driver}
              onChange={(e) => set({ driver: e.target.value })}
            />
          </FieldBox>
        </div>
        <PartyPicker
          godownId={godown._id}
          roles={["SECOND_PARTY"]}
          createRole="SECOND_PARTY"
          value={s.secondId}
          onChange={(secondId) => set({ secondId })}
          label={t("ld.secondParty")}
          testId="load-second"
        />
        <FieldBox label={t("ld.notes")}>
          <Input
            className="h-12 text-base"
            value={s.notes}
            onChange={(e) => set({ notes: e.target.value })}
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

"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { FormShell, RestoreDraftBanner } from "@/components/forms/FormShell";
import {
  Choice,
  DateField,
  PayModeFields,
  SeasonField,
  Section,
  TextField,
  emptyPayMode,
  type PayModeState,
} from "@/components/forms/fields";
import { PartyPicker } from "@/components/forms/pickers";
import { Computed } from "@/components/money/display";
import { AmountInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useMayViewVoucher, useWriteGodown } from "@/components/system/page";
import { avgPurchaseRate30d, rateOutOfBand } from "@/client/queries/vouchers";
import { getLastUsed, savePurchase, type VoucherDraft } from "@/client/repo";
import { paiseToInput, parseAmountField } from "@/client/ui/parse";
import { useFormDraft } from "@/client/ui/hooks";
import { seasonOf } from "@/domain/dates";
import type { DeductionDefaults, GodownSettings, Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { useGodownSettings, usePriorBalance, useVoucher } from "./hooks";
import { ChargesEditor, LinesEditor } from "./LinesEditor";
import {
  chargeFromVoucher,
  evalCharges,
  evalLine,
  lineFromVoucher,
  newLine,
  previewBill,
  type ChargeState,
  type LineState,
} from "./lineState";
import { today, useAfterSave, useGodownTitle, useSaveError } from "./common";

interface State {
  partyId?: string;
  date: string;
  season?: "AMAN" | "BORO" | "AUS";
  storeAt: "STORE" | "TRANSIT";
  lines: LineState[];
  charges: ChargeState[];
  paidNow: string;
  pay: PayModeState;
  dueDate: string;
  notes: string;
  reason: string;
}

function initialState(settings: GodownSettings, existing: Voucher | null): State {
  if (existing && existing.type === "PURCHASE") {
    return {
      partyId: existing.partyId,
      date: existing.date,
      ...(existing.season ? { season: existing.season } : {}),
      storeAt: existing.storeAt,
      lines: existing.lines.map(lineFromVoucher),
      charges: existing.charges.map(chargeFromVoucher),
      paidNow: paiseToInput(existing.paidNow?.amountPaise),
      pay: {
        mode: existing.paidNow?.mode ?? "CASH",
        ...(existing.paidNow?.bankAccountId
          ? { bankAccountId: existing.paidNow.bankAccountId }
          : {}),
        ref: existing.paidNow?.ref ?? "",
        chequeNo: "",
        chequeDate: "",
      },
      dueDate: existing.dueDate ?? "",
      notes: existing.notes ?? "",
      reason: "",
    };
  }
  return {
    date: today(),
    storeAt: "STORE",
    lines: [newLine(settings.defaults.deductions)],
    charges: [],
    paidNow: "",
    pay: emptyPayMode(),
    dueDate: "",
    notes: "",
    reason: "",
  };
}

/** New / edit purchase (spec §9.2). */
export function PurchaseForm({ editId }: { editId?: string }) {
  const { godownId, readOnly } = useWriteGodown();
  const settings = useGodownSettings(godownId);
  const existing = useVoucher(editId);
  const mayView = useMayViewVoucher();
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || !settings || existing === undefined) return <Loading />;
  if (editId && (!existing || existing.type !== "PURCHASE"))
    return <ReadOnlyNotice reason="notFound" />;
  // The `entry` role opens only its own entries.
  if (!mayView) return <Loading />;
  if (existing && !mayView(existing)) return <ReadOnlyNotice reason="entryRole" />;
  return (
    <PurchaseFormInner
      key={editId ?? "new"}
      godownId={godownId}
      settings={settings}
      existing={existing}
      initial={initialState(settings, existing)}
    />
  );
}

function PurchaseFormInner({
  godownId,
  settings,
  existing,
  initial,
}: {
  godownId: string;
  settings: GodownSettings;
  existing: Voucher | null;
  initial: State;
}) {
  const { t, money } = useI18n();
  const godownName = useGodownTitle();
  const [s, setS] = useState<State>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const afterSave = useAfterSave();
  const onError = useSaveError();
  const formKey = existing ? `purchase:edit:${existing._id}` : `purchase:new:${godownId}`;
  const draft = useFormDraft(formKey, s, dirty);
  const update = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const prior = usePriorBalance(godownId, s.partyId, existing?.groupId);
  const roundToRupee =
    existing && existing.type === "PURCHASE"
      ? existing.roundToRupee
      : settings.rounding.roundToRupee;

  const evals = s.lines.map(evalLine);
  const ch = evalCharges(s.charges);
  const bill = previewBill(evals, ch.charges, roundToRupee);
  const paid = parseAmountField(s.paidNow, false);
  const paidNow = paid.value ?? 0n;
  const advanceGiven = prior ? (prior.balancePaise > 0n ? prior.balancePaise : 0n) : 0n;
  const priorDue = prior ? (prior.balancePaise < 0n ? -prior.balancePaise : 0n) : 0n;
  const dueAfter = bill ? bill.total - paidNow - advanceGiven : null;
  const overpaid = bill ? paidNow > bill.total + priorDue : false;
  const synced = existing?.serverSeq !== undefined;

  // Rate sanity band: ±25 % of the variety's 30-day average purchase rate (warning only).
  const varietyKey = evals.map((e, i) => `${s.lines[i]!.varietyId ?? ""}`).join(",");
  const averages = useLiveQuery(async () => {
    const m = new Map<string, bigint | null>();
    for (const v of new Set(s.lines.map((l) => l.varietyId).filter((x): x is string => !!x))) {
      m.set(v, await avgPurchaseRate30d(godownId, v, today(), existing?._id));
    }
    return m;
  }, [varietyKey, godownId]);
  const rateWarning = (() => {
    const out = new Set<string>();
    evals.forEach((e, i) => {
      const l = s.lines[i]!;
      if (
        e.rate !== undefined &&
        l.varietyId &&
        rateOutOfBand(e.rate, averages?.get(l.varietyId) ?? null)
      )
        out.add(l.key);
    });
    return out;
  })();

  const onParty = async (partyId: string | undefined) => {
    update({ partyId });
    if (!partyId || existing) return;
    const pristine = s.lines.length === 1 && !s.lines[0]!.gross && !s.lines[0]!.rate;
    if (!pristine) return;
    const last = await getLastUsed(godownId, partyId);
    if (!last) return;
    const ded: DeductionDefaults = { ...settings.defaults.deductions, ...last.deductions };
    setS((x) => ({ ...x, lines: [newLine(ded, last.varietyId, last.ratePaisePerQtl)] }));
  };

  const save = async () => {
    setShowErrors(true);
    if (!s.partyId || evals.some((e) => !e.draft) || !ch.charges || paid.error) return;
    if (synced && !s.reason.trim()) return;
    setSaving(true);
    try {
      const draftV = {
        type: "PURCHASE",
        date: s.date,
        ...(s.season ? { season: s.season } : {}),
        partyId: s.partyId,
        storeAt: s.storeAt,
        lines: evals.map((e) => e.draft!),
        charges: ch.charges,
        roundToRupee,
        roundOffPaise: "0",
        totalPaise: "0",
        ...(paidNow > 0n
          ? {
              paidNow: {
                amountPaise: paidNow.toString(),
                mode: s.pay.mode,
                ...(s.pay.mode !== "CASH" && s.pay.bankAccountId
                  ? { bankAccountId: s.pay.bankAccountId }
                  : {}),
                ...(s.pay.ref.trim() ? { ref: s.pay.ref.trim() } : {}),
              },
            }
          : {}),
        ...(s.dueDate ? { dueDate: s.dueDate } : {}),
        ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
        ...(existing && existing.type === "PURCHASE" && existing.loadId
          ? { loadId: existing.loadId }
          : {}),
      } as VoucherDraft;
      const res = await savePurchase(godownId, draftV, {
        ...(existing ? { id: existing._id } : {}),
        ...(s.reason.trim() ? { reason: s.reason.trim() } : {}),
      });
      setDirty(false);
      await draft.clear();
      afterSave(res.primary._id, "/purchase/view");
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell
      title={t(existing ? "purchase.editTitle" : "purchase.newTitle", { godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="purchase-form"
      restoreBanner={
        draft.restore && !dirty ? (
          <RestoreDraftBanner
            onRestore={() => {
              setS(draft.restore as State);
              setDirty(true);
              draft.dismiss();
            }}
            onDismiss={() => void draft.clear()}
          />
        ) : null
      }
      totals={
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">{t("common.total")}</span>
          <span className="tabular text-lg font-semibold" data-testid="purchase-total">
            {bill ? money(bill.total) : "—"}
          </span>
        </div>
      }
    >
      <PartyPicker
        godownId={godownId}
        label={t("purchase.farmer")}
        value={s.partyId}
        onChange={(id) => void onParty(id)}
        newRoles={["farmer"]}
        required
        error={showErrors && !s.partyId ? "errors.validation.required" : null}
        testId="purchase-party"
      />
      {prior ? (
        <p className="text-muted-foreground text-sm" data-testid="purchase-prior">
          {t("purchase.priorBalance", { due: money(priorDue), advance: money(advanceGiven) })}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <DateField
          label={t("common.date")}
          value={s.date}
          max={today()}
          onChange={(date) =>
            update({ date, season: seasonOf(date, settings.seasonMap) ?? s.season })
          }
        />
        <SeasonField
          value={s.season ?? seasonOf(s.date, settings.seasonMap)}
          onChange={(season) => update({ season })}
        />
      </div>
      <Choice
        label={t("purchase.whereTo")}
        value={s.storeAt}
        onChange={(storeAt) => update({ storeAt })}
        options={[
          { value: "STORE", label: t("purchase.storeInGodown") },
          { value: "TRANSIT", label: t("purchase.directLoad") },
        ]}
      />
      <LinesEditor
        godownId={godownId}
        lines={s.lines}
        onChange={(lines) => update({ lines })}
        defaults={settings.defaults.deductions}
        showErrors={showErrors}
        rateWarning={rateWarning}
      />
      <Section title={t("trade.charges")}>
        <ChargesEditor charges={s.charges} onChange={(charges) => update({ charges })} />
      </Section>
      {bill ? (
        <Section>
          <div className="grid grid-cols-2 gap-2">
            <Computed label={t("trade.subTotal")} value={money(bill.subTotal)} />
            <Computed label={t("trade.roundOff")} value={money(bill.roundOff)} />
          </div>
          <Computed
            label={t("common.total")}
            value={money(bill.total)}
            large
            testId="purchase-total-body"
          />
        </Section>
      ) : null}
      <Section title={t("purchase.paidNow")}>
        <AmountInput
          label={t("common.amount")}
          value={s.paidNow}
          onChange={(paidNow) => update({ paidNow })}
          testId="purchase-paid"
        />
        {paidNow > 0n ? (
          <PayModeFields
            godownId={godownId}
            value={s.pay}
            onChange={(pay) => update({ pay })}
            testId="purchase-pay"
          />
        ) : null}
        {overpaid ? (
          <p className="text-sm text-amber-700" role="status">
            {t("purchase.overpaidWarning")}
          </p>
        ) : null}
        {dueAfter !== null ? (
          <Computed
            label={t("purchase.balanceDue")}
            value={money(dueAfter > 0n ? dueAfter : 0n)}
            testId="purchase-due"
            formula={
              bill ? `${money(bill.total)} − ${money(paidNow)} − ${money(advanceGiven)}` : undefined
            }
          />
        ) : null}
        <DateField
          label={t("purchase.dueDate")}
          value={s.dueDate}
          min={s.date}
          optional
          onChange={(dueDate) => update({ dueDate })}
        />
      </Section>
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
          error={showErrors && !s.reason.trim() ? "errors.validation.required" : null}
          testId="edit-reason"
        />
      ) : null}
    </FormShell>
  );
}

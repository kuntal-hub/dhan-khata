"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormShell } from "@/components/forms/FormShell";
import { BottomSheet } from "@/components/forms/BottomSheet";
import { Choice, Section, TextField } from "@/components/forms/fields";
import { PercentInput, RateInput, WeightInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { useAccessibleGodowns } from "@/client/hooks";
import { partyMatches } from "@/client/queries/parties";
import { upsertMaster, type MasterInput } from "@/client/repo";
import {
  bpsToInput,
  gramsToKgInput,
  paiseToInput,
  parsePercentField,
  parseRateField,
  parseWeightField,
} from "@/client/ui/parse";
import { useSaveError, useGodownTitle } from "@/components/trade/common";
import { normalizeDigits } from "@/domain/digits";
import { normalizePhone } from "@/domain/phone";
import { PartyRoleSchema, type DhaltaMode, type Party, type PartyRole } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

const ROLES = PartyRoleSchema.options.filter((r) => r !== "godown");

interface State {
  name: string;
  nameAlt: string;
  roles: PartyRole[];
  phone: string;
  altPhone: string;
  village: string;
  postOffice: string;
  block: string;
  district: string;
  millName: string;
  gstin: string;
  pan: string;
  holder: string;
  bank: string;
  last4: string;
  ifsc: string;
  upi: string;
  rate: string;
  tare: string;
  dhaltaMode: DhaltaMode;
  dhalta: string;
  moisture: string;
  notes: string;
}

function fromParty(p: Party | null): State {
  return {
    name: p?.name ?? "",
    nameAlt: p?.nameAlt ?? "",
    roles: p?.roles ?? ["farmer"],
    phone: p?.phone ?? "",
    altPhone: p?.altPhone ?? "",
    village: p?.village ?? "",
    postOffice: p?.postOffice ?? "",
    block: p?.block ?? "",
    district: p?.district ?? "",
    millName: p?.millName ?? "",
    gstin: p?.gstin ?? "",
    pan: p?.pan ?? "",
    holder: p?.bankDetails?.holder ?? "",
    bank: p?.bankDetails?.bank ?? "",
    last4: p?.bankDetails?.accountLast4 ?? "",
    ifsc: p?.bankDetails?.ifsc ?? "",
    upi: p?.bankDetails?.upiId ?? "",
    rate: paiseToInput(p?.defaultRatePaisePerQtl),
    tare: gramsToKgInput(p?.defaultDeductions?.tarePerBagG),
    dhaltaMode: p?.defaultDeductions?.dhaltaMode ?? "PER_QUINTAL",
    dhalta: gramsToKgInput(p?.defaultDeductions?.dhaltaValueG),
    moisture: bpsToInput(p?.defaultDeductions?.moistureBps),
    notes: p?.notes ?? "",
  };
}

/** Create / edit a party (all §8.1 fields; +91 phone validation; nameAlt subtitle). */
export function PartyForm({ editId }: { editId?: string }) {
  const { godownId, readOnly } = useWriteGodown();
  const existing = useLiveQuery(
    async () => (editId ? ((await db().parties.get(editId)) ?? null) : null),
    [editId],
  );
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (!godownId || existing === undefined) return <Loading />;
  return <Inner key={editId ?? "new"} godownId={godownId} existing={existing} />;
}

function Inner({ godownId, existing }: { godownId: string; existing: Party | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const godownName = useGodownTitle();
  const onError = useSaveError();
  const [s, setS] = useState<State>(() => fromParty(existing));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const update = (patch: Partial<State>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const phoneErr = (v: string): TKey | null =>
    v.trim() && !normalizePhone(v) ? "errors.validation.phone" : null;
  const rate = parseRateField(s.rate, false);
  const tare = parseWeightField(s.tare, false);
  const dhalta = parseWeightField(s.dhalta, false);
  const moisture = parsePercentField(s.moisture, false);
  const last4 = normalizeDigits(s.last4).trim();
  const last4Err: TKey | null = last4 && !/^\d{4}$/.test(last4) ? "errors.validation.last4" : null;

  const save = async () => {
    setShowErrors(true);
    if (
      !s.name.trim() ||
      s.roles.length === 0 ||
      phoneErr(s.phone) ||
      phoneErr(s.altPhone) ||
      last4Err
    )
      return;
    if (rate.error || tare.error || dhalta.error || moisture.error) return;
    setSaving(true);
    try {
      const opt = (v: string) => (v.trim() ? v.trim() : undefined);
      const bankDetails = {
        ...(opt(s.holder) ? { holder: opt(s.holder) } : {}),
        ...(opt(s.bank) ? { bank: opt(s.bank) } : {}),
        ...(last4 ? { accountLast4: last4 } : {}),
        ...(opt(s.ifsc) ? { ifsc: opt(s.ifsc)!.toUpperCase() } : {}),
        ...(opt(s.upi) ? { upiId: opt(s.upi) } : {}),
      };
      const ded = {
        ...(tare.value ? { tarePerBagG: tare.value.toString() } : {}),
        ...(dhalta.value
          ? { dhaltaMode: s.dhaltaMode, dhaltaValueG: dhalta.value.toString() }
          : {}),
        ...(moisture.value ? { moistureBps: Number(moisture.value) } : {}),
      };
      const input = {
        ...(existing ? { _id: existing._id } : {}),
        name: s.name.trim(),
        ...(opt(s.nameAlt) ? { nameAlt: opt(s.nameAlt) } : {}),
        roles: s.roles,
        ...(opt(s.phone) ? { phone: normalizePhone(s.phone)! } : {}),
        ...(opt(s.altPhone) ? { altPhone: normalizePhone(s.altPhone)! } : {}),
        ...(opt(s.village) ? { village: opt(s.village) } : {}),
        ...(opt(s.postOffice) ? { postOffice: opt(s.postOffice) } : {}),
        ...(opt(s.block) ? { block: opt(s.block) } : {}),
        ...(opt(s.district) ? { district: opt(s.district) } : {}),
        ...(opt(s.millName) ? { millName: opt(s.millName) } : {}),
        ...(opt(s.gstin) ? { gstin: opt(s.gstin)!.toUpperCase() } : {}),
        ...(opt(s.pan) ? { pan: opt(s.pan)!.toUpperCase() } : {}),
        ...(Object.keys(bankDetails).length ? { bankDetails } : {}),
        ...(rate.value ? { defaultRatePaisePerQtl: rate.value.toString() } : {}),
        ...(Object.keys(ded).length ? { defaultDeductions: ded } : {}),
        ...(opt(s.notes) ? { notes: opt(s.notes) } : {}),
        ...(existing?.linkedGodownId ? { linkedGodownId: existing.linkedGodownId } : {}),
      } as MasterInput<"party">;
      const p = await upsertMaster(godownId, "party", input);
      setDirty(false);
      toast.success(t("common.saved"));
      router.replace(`/party/view?id=${p._id}`);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  const toggleRole = (r: PartyRole) =>
    update({ roles: s.roles.includes(r) ? s.roles.filter((x) => x !== r) : [...s.roles, r] });

  return (
    <FormShell
      title={t(existing ? "party.editTitle" : "party.newTitle", { godown: godownName })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="party-form"
    >
      {!existing ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 self-start"
          onClick={() => setCopyOpen(true)}
        >
          <Copy className="size-4" aria-hidden />
          {t("party.copyFromGodown")}
        </Button>
      ) : null}
      <TextField
        label={t("party.name")}
        value={s.name}
        onChange={(name) => update({ name })}
        required
        error={showErrors && !s.name.trim() ? "errors.validation.required" : null}
        testId="party-name"
        maxLength={120}
      />
      <TextField
        label={t("party.nameAlt")}
        value={s.nameAlt}
        onChange={(nameAlt) => update({ nameAlt })}
        maxLength={120}
      />
      <div className="flex flex-col gap-1" role="group" aria-label={t("party.roles")}>
        <span className="text-sm font-medium">{t("party.roles")}</span>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={s.roles.includes(r)}
              data-testid={`role-${r}`}
              onClick={() => toggleRole(r)}
              className={`min-h-11 rounded-full border px-3 text-sm ${s.roles.includes(r) ? "bg-primary text-primary-foreground" : ""}`}
            >
              {t(`partyRole.${r}` as TKey)}
            </button>
          ))}
        </div>
        {showErrors && s.roles.length === 0 ? (
          <p className="text-destructive text-xs">{t("errors.validation.required")}</p>
        ) : null}
      </div>
      <TextField
        label={t("party.phone")}
        value={s.phone}
        onChange={(phone) => update({ phone })}
        inputMode="tel"
        error={phoneErr(s.phone)}
        testId="party-phone"
      />
      <TextField
        label={t("party.altPhone")}
        value={s.altPhone}
        onChange={(altPhone) => update({ altPhone })}
        inputMode="tel"
        error={phoneErr(s.altPhone)}
      />
      <TextField
        label={t("party.village")}
        value={s.village}
        onChange={(village) => update({ village })}
        testId="party-village"
        maxLength={80}
      />
      <Section title={t("party.address")}>
        <TextField
          label={t("party.postOffice")}
          value={s.postOffice}
          onChange={(postOffice) => update({ postOffice })}
          maxLength={80}
        />
        <TextField
          label={t("party.block")}
          value={s.block}
          onChange={(block) => update({ block })}
          maxLength={80}
        />
        <TextField
          label={t("party.district")}
          value={s.district}
          onChange={(district) => update({ district })}
          maxLength={80}
        />
      </Section>
      {s.roles.includes("mill") ? (
        <TextField
          label={t("party.millName")}
          value={s.millName}
          onChange={(millName) => update({ millName })}
          maxLength={120}
        />
      ) : null}
      <Section title={t("party.taxIds")}>
        <TextField
          label={t("party.gstin")}
          value={s.gstin}
          onChange={(gstin) => update({ gstin })}
          maxLength={15}
        />
        <TextField
          label={t("party.pan")}
          value={s.pan}
          onChange={(pan) => update({ pan })}
          maxLength={10}
        />
      </Section>
      <Section title={t("party.bankDetails")}>
        <TextField
          label={t("party.holder")}
          value={s.holder}
          onChange={(holder) => update({ holder })}
          maxLength={120}
        />
        <TextField
          label={t("masters.bankBank")}
          value={s.bank}
          onChange={(bank) => update({ bank })}
          maxLength={120}
        />
        <TextField
          label={t("masters.bankLast4")}
          value={s.last4}
          onChange={(l4) => update({ last4: l4 })}
          inputMode="numeric"
          maxLength={4}
          error={last4Err}
        />
        <TextField
          label={t("party.ifsc")}
          value={s.ifsc}
          onChange={(ifsc) => update({ ifsc })}
          maxLength={11}
        />
        <TextField
          label={t("party.upi")}
          value={s.upi}
          onChange={(upi) => update({ upi })}
          maxLength={80}
        />
      </Section>
      <Section title={t("party.defaults")}>
        <RateInput label={t("trade.rate")} value={s.rate} onChange={(r) => update({ rate: r })} />
        <WeightInput
          label={t("trade.bagTare")}
          value={s.tare}
          onChange={(tare2) => update({ tare: tare2 })}
        />
        <Choice
          label={t("trade.dhalta")}
          value={s.dhaltaMode}
          onChange={(dhaltaMode) => update({ dhaltaMode })}
          options={[
            { value: "PER_QUINTAL", label: t("trade.dhaltaPerQtl") },
            { value: "PER_BAG", label: t("trade.dhaltaPerBag") },
            { value: "FIXED", label: t("trade.dhaltaFixed") },
          ]}
        />
        <WeightInput
          label={t("trade.dhaltaValue")}
          value={s.dhalta}
          onChange={(dh) => update({ dhalta: dh })}
        />
        <PercentInput
          label={t("trade.moistureCut")}
          value={s.moisture}
          onChange={(m) => update({ moisture: m })}
        />
      </Section>
      <TextField
        label={t("common.notes")}
        value={s.notes}
        onChange={(notes) => update({ notes })}
        multiline
        maxLength={1000}
      />
      <CopyFromGodown
        open={copyOpen}
        onOpenChange={setCopyOpen}
        currentGodownId={godownId}
        onPick={(p) => {
          update({
            name: p.name,
            nameAlt: p.nameAlt ?? "",
            phone: p.phone ?? "",
            altPhone: p.altPhone ?? "",
            village: p.village ?? "",
            postOffice: p.postOffice ?? "",
            block: p.block ?? "",
            district: p.district ?? "",
          });
          setCopyOpen(false);
        }}
      />
    </FormShell>
  );
}

/** "অন্য গোডাউন থেকে কপি": copies name, phone and address only — never balances (§1.4 rule 6). */
function CopyFromGodown({
  open,
  onOpenChange,
  currentGodownId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentGodownId: string;
  onPick: (p: Party) => void;
}) {
  const { t } = useI18n();
  const godowns = (useAccessibleGodowns() ?? []).filter((g) => g._id !== currentGodownId);
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [q, setQ] = useState("");
  const source = from ?? godowns[0]?._id;
  const parties = useLiveQuery(
    async () =>
      source
        ? await db()
            .parties.where("godownId")
            .equals(source)
            .filter((p) => p.status === "active")
            .toArray()
        : [],
    [source],
  );
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("party.copyFromGodown")}
      description={t("party.copyHint")}
    >
      {godowns.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("party.copyNoOther")}</p>
      ) : (
        <>
          <Choice
            value={source ?? ""}
            onChange={(v) => setFrom(v)}
            options={godowns.map((g) => ({ value: g._id, label: g.name }))}
            wrap
          />
          <input
            className="border-input h-12 rounded-md border px-3 text-base"
            placeholder={t("common.search")}
            aria-label={t("common.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="flex flex-col">
            {(parties ?? [])
              .filter((p) => partyMatches(p, q))
              .slice(0, 100)
              .map((p) => (
                <li key={p._id}>
                  <button
                    type="button"
                    className="hover:bg-muted flex min-h-12 w-full flex-col items-start rounded-md px-3 py-2 text-left"
                    onClick={() => onPick(p)}
                  >
                    <span>{p.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {[p.village, p.phone].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </BottomSheet>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState, type ReactNode } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Choice, DateField, TextField } from "@/components/forms/fields";
import { PartyPicker, VarietyPicker } from "@/components/forms/pickers";
import { Money } from "@/components/money/display";
import { AmountInput, WeightInput } from "@/components/money/inputs";
import { useNames } from "@/components/vouchers/names";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { createGodownOnline } from "@/client/godown/manage";
import { useActiveGodown } from "@/client/hooks";
import { saveSimple, upsertMaster, type VoucherDraft } from "@/client/repo";
import { bankLabel, varietyLabel } from "@/client/ui/labels";
import { parseAmountField, parseWeightField } from "@/client/ui/parse";
import { dot } from "@/client/ui/text";
import { normalizeDigits } from "@/domain/digits";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

const STEPS: TKey[] = [
  "godowns.stepProfile",
  "godowns.stepVarieties",
  "godowns.stepBanks",
  "godowns.stepCash",
  "godowns.stepStock",
  "godowns.stepParties",
  "godowns.stepReview",
];

interface StockRow {
  varietyId?: string;
  qty: string;
  value: string;
}
interface PartyRow {
  partyId?: string;
  amount: string;
  side: "THEY_OWE" | "WE_OWE";
}

type OpeningItem = VoucherDraft extends infer V
  ? V extends { type: "OPENING"; items: infer I }
    ? I extends Array<infer X>
      ? X
      : never
    : never
  : never;

/**
 * Add-godown wizard (spec §10 godown setup, reused for every new godown; owner, online for the
 * first step): profile + short code → varieties → bank accounts with opening balances → opening
 * cash → opening stock → opening party balances → one OPENING voucher. A non-zero difference is
 * recorded as capital (মূলধন) after confirmation, so OPENING_BAL nets to zero.
 */
export function GodownWizard({ resumeId }: { resumeId?: string }) {
  const { t, money, count } = useI18n();
  const router = useRouter();
  const { select } = useActiveGodown();
  const [step, setStep] = useState(resumeId ? 1 : 0);
  const [godownId, setGodownId] = useState<string | undefined>(resumeId);
  const [busy, setBusy] = useState(false);
  // Step 0
  const [profile, setProfile] = useState({
    name: "",
    code: "",
    firmName: "",
    address: "",
    phone: "",
  });
  // Step 1–5
  const [newVariety, setNewVariety] = useState("");
  const [bank, setBank] = useState({ name: "", bank: "", last4: "", opening: "" });
  const [cash, setCash] = useState("");
  const [stock, setStock] = useState<StockRow[]>([{ qty: "", value: "" }]);
  const [parties, setParties] = useState<PartyRow[]>([{ amount: "", side: "THEY_OWE" }]);
  const [goLive, setGoLive] = useState(todayIST());
  const [capitalOk, setCapitalOk] = useState(false);
  const names = useNames(godownId ?? null);
  const masters = useLiveQuery(async () => {
    if (!godownId) return null;
    const d = db();
    const [g, varieties, banks] = await Promise.all([
      d.godowns.get(godownId),
      d.varieties
        .where("godownId")
        .equals(godownId)
        .filter((v) => v.status === "active")
        .toArray(),
      d.bankAccounts
        .where("godownId")
        .equals(godownId)
        .filter((b) => b.status === "active")
        .toArray(),
    ]);
    return { g, varieties, banks };
  }, [godownId]);

  const code = profile.code.trim().toUpperCase();
  const codeOk = /^[A-Z][A-Z0-9]{1,5}$/.test(code);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  // ── Opening items from the steps ──
  const items: OpeningItem[] = [];
  const cashVal = parseAmountField(cash).value ?? 0n;
  if (cashVal > 0n) items.push({ kind: "CASH", amountPaise: cashVal.toString() });
  for (const b of masters?.banks ?? []) {
    if (BigInt(b.openingBalancePaise) !== 0n) {
      items.push({ kind: "BANK", refId: b._id, amountPaise: b.openingBalancePaise });
    }
  }
  const stockErr = stock.some((r) => {
    const q = parseWeightField(r.qty);
    const v = parseAmountField(r.value);
    return !!q.error || !!v.error || !!r.varietyId !== (q.value !== undefined);
  });
  for (const r of stock) {
    const q = parseWeightField(r.qty).value;
    const v = parseAmountField(r.value).value ?? 0n;
    if (r.varietyId && q !== undefined && q > 0n) {
      items.push({
        kind: "STOCK",
        varietyId: r.varietyId,
        qtyG: q.toString(),
        amountPaise: v.toString(),
      });
    }
  }
  const partyErr = parties.some((r) => {
    const a = parseAmountField(r.amount);
    return !!a.error || !!r.partyId !== (a.value !== undefined && a.value > 0n);
  });
  for (const r of parties) {
    const a = parseAmountField(r.amount).value;
    if (r.partyId && a !== undefined && a > 0n) {
      items.push({
        kind: "PARTY",
        refId: r.partyId,
        amountPaise: (r.side === "THEY_OWE" ? a : -a).toString(),
      });
    }
  }
  let net = 0n;
  for (const it of items) net += BigInt(it.amountPaise);

  const finish = () =>
    run(async () => {
      if (!godownId) return;
      if (items.length > 0) {
        const all =
          net !== 0n
            ? [...items, { kind: "CAPITAL" as const, amountPaise: (-net).toString() }]
            : items;
        await saveSimple(godownId, { type: "OPENING", date: goLive, items: all } as VoucherDraft);
      }
      select(godownId);
      toast.success(t("godowns.created"));
      router.replace("/");
    });

  const nav = (next: () => void, disabled?: boolean, label?: string) => (
    <div className="flex gap-2 pt-2">
      {step > 1 ? (
        <Button variant="outline" className="h-12 flex-1" onClick={() => setStep(step - 1)}>
          {t("common.back")}
        </Button>
      ) : null}
      <Button
        className="h-12 flex-1"
        disabled={disabled || busy}
        onClick={next}
        data-testid="wizard-next"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {label ?? t("common.next")}
      </Button>
    </div>
  );

  let body: ReactNode = null;
  if (step === 0) {
    body = (
      <>
        <TextField
          label={t("godowns.name")}
          value={profile.name}
          onChange={(name) => setProfile({ ...profile, name })}
          required
          maxLength={80}
          testId="wizard-name"
        />
        <TextField
          label={t("godowns.code")}
          value={profile.code}
          onChange={(c) => setProfile({ ...profile, code: c.toUpperCase() })}
          required
          maxLength={6}
          error={profile.code && !codeOk ? "errors.validation.godownCode" : null}
          testId="wizard-code"
        />
        <p className="text-muted-foreground -mt-2 text-xs">{t("godowns.codeHint")}</p>
        <TextField
          label={t("godowns.firmName")}
          value={profile.firmName}
          onChange={(firmName) => setProfile({ ...profile, firmName })}
          maxLength={120}
        />
        <TextField
          label={t("godowns.address")}
          value={profile.address}
          onChange={(address) => setProfile({ ...profile, address })}
          maxLength={300}
        />
        <TextField
          label={t("godowns.phone")}
          value={profile.phone}
          onChange={(phone) => setProfile({ ...profile, phone })}
          inputMode="tel"
          maxLength={20}
        />
        <p className="text-muted-foreground text-xs">{t("godowns.onlineOnly")}</p>
        {nav(
          () =>
            run(async () => {
              const g = await createGodownOnline({
                name: profile.name.trim(),
                code,
                ...(profile.firmName.trim() ? { firmName: profile.firmName.trim() } : {}),
                ...(profile.address.trim() ? { address: profile.address.trim() } : {}),
                ...(profile.phone.trim() ? { phone: profile.phone.trim() } : {}),
              });
              setGodownId(g._id);
              setStep(1);
            }),
          !profile.name.trim() || !codeOk,
          busy ? t("godowns.creating") : t("godowns.create"),
        )}
      </>
    );
  } else if (!godownId || !masters || !masters.g || !names) {
    body = <Loader2 className="text-primary mx-auto size-6 animate-spin" aria-hidden />;
  } else if (step === 1) {
    body = (
      <>
        <p className="text-muted-foreground text-sm">{t("godowns.varietiesHint")}</p>
        <ul className="flex flex-wrap gap-2" data-testid="wizard-varieties">
          {masters.varieties.map((v) => (
            <li key={v._id} className="rounded-full border px-3 py-1 text-sm">
              {varietyLabel(v, t)}
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label={t("trade.variety")}
              value={newVariety}
              onChange={setNewVariety}
              maxLength={80}
            />
          </div>
          <Button
            variant="outline"
            className="h-12"
            disabled={!newVariety.trim() || busy}
            aria-label={t("godowns.addRow")}
            onClick={() =>
              run(async () => {
                await upsertMaster(godownId, "variety", { name: newVariety.trim() });
                setNewVariety("");
              })
            }
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
        {nav(() => setStep(2))}
      </>
    );
  } else if (step === 2) {
    const l4 = normalizeDigits(bank.last4).trim();
    const opening = parseAmountField(bank.opening);
    body = (
      <>
        <ul className="flex flex-col" data-testid="wizard-banks">
          {masters.banks.map((b) => (
            <li
              key={b._id}
              className="flex min-h-11 items-center justify-between gap-2 border-b text-sm"
            >
              <span>{bankLabel(b)}</span>
              <Money paise={BigInt(b.openingBalancePaise)} />
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <TextField
            label={t("masters.bankName")}
            value={bank.name}
            onChange={(name) => setBank({ ...bank, name })}
            maxLength={80}
            testId="wizard-bank-name"
          />
          <TextField
            label={t("masters.bankBank")}
            value={bank.bank}
            onChange={(b) => setBank({ ...bank, bank: b })}
            maxLength={80}
            testId="wizard-bank-bank"
          />
          <TextField
            label={t("masters.bankLast4")}
            value={bank.last4}
            onChange={(last4) => setBank({ ...bank, last4 })}
            inputMode="numeric"
            maxLength={4}
            error={l4 && !/^\d{4}$/.test(l4) ? "errors.validation.last4" : null}
            testId="wizard-bank-last4"
          />
          <AmountInput
            label={t("godowns.bankOpening")}
            value={bank.opening}
            onChange={(o) => setBank({ ...bank, opening: o })}
            testId="wizard-bank-opening"
          />
          <Button
            variant="outline"
            className="h-11"
            disabled={
              !bank.name.trim() ||
              !bank.bank.trim() ||
              !/^\d{4}$/.test(l4) ||
              !!opening.error ||
              busy
            }
            onClick={() =>
              run(async () => {
                await upsertMaster(godownId, "bankAccount", {
                  name: bank.name.trim(),
                  bank: bank.bank.trim(),
                  last4: l4,
                  isUpiLinked: false,
                  openingBalancePaise: (opening.value ?? 0n).toString(),
                });
                setBank({ name: "", bank: "", last4: "", opening: "" });
              })
            }
            data-testid="wizard-bank-add"
          >
            <Plus className="size-4" aria-hidden />
            {t("godowns.addRow")}
          </Button>
        </div>
        {nav(() => setStep(3))}
      </>
    );
  } else if (step === 3) {
    const c = parseAmountField(cash);
    body = (
      <>
        <AmountInput
          label={t("godowns.openingCash")}
          value={cash}
          onChange={setCash}
          testId="wizard-cash"
        />
        {nav(() => setStep(4), !!c.error)}
      </>
    );
  } else if (step === 4) {
    body = (
      <>
        {stock.map((r, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-md border p-2"
            data-testid={`wizard-stock-${i}`}
          >
            <VarietyPicker
              godownId={godownId}
              label={t("trade.variety")}
              value={r.varietyId}
              onChange={(varietyId) =>
                setStock(stock.map((x, j) => (j === i ? { ...x, varietyId } : x)))
              }
              allowClear
              testId={`wizard-stock-${i}-variety`}
            />
            <div className="grid grid-cols-2 gap-2">
              <WeightInput
                label={t("godowns.stockQty")}
                value={r.qty}
                onChange={(qty) => setStock(stock.map((x, j) => (j === i ? { ...x, qty } : x)))}
                testId={`wizard-stock-${i}-qty`}
              />
              <AmountInput
                label={t("godowns.stockValue")}
                value={r.value}
                onChange={(value) => setStock(stock.map((x, j) => (j === i ? { ...x, value } : x)))}
                testId={`wizard-stock-${i}-value`}
              />
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          className="h-11"
          onClick={() => setStock([...stock, { qty: "", value: "" }])}
        >
          {t("godowns.addRow")}
        </Button>
        {nav(() => setStep(5), stockErr)}
      </>
    );
  } else if (step === 5) {
    body = (
      <>
        {parties.map((r, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-md border p-2"
            data-testid={`wizard-party-${i}`}
          >
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <PartyPicker
                  godownId={godownId}
                  label={t("sale.party")}
                  value={r.partyId}
                  onChange={(partyId) =>
                    setParties(parties.map((x, j) => (j === i ? { ...x, partyId } : x)))
                  }
                  allowClear
                  testId={`wizard-party-${i}-party`}
                />
              </div>
              {parties.length > 1 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-12"
                  aria-label={t("godowns.removeRow")}
                  onClick={() => setParties(parties.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>
            <AmountInput
              label={t("godowns.partyAmount")}
              value={r.amount}
              onChange={(amount) =>
                setParties(parties.map((x, j) => (j === i ? { ...x, amount } : x)))
              }
              testId={`wizard-party-${i}-amount`}
            />
            <Choice
              value={r.side}
              onChange={(side) => setParties(parties.map((x, j) => (j === i ? { ...x, side } : x)))}
              options={[
                { value: "THEY_OWE", label: t("godowns.theyOwe") },
                { value: "WE_OWE", label: t("godowns.weOwe") },
              ]}
            />
          </div>
        ))}
        <Button
          variant="outline"
          className="h-11"
          onClick={() => setParties([...parties, { amount: "", side: "THEY_OWE" }])}
        >
          {t("godowns.addRow")}
        </Button>
        {nav(() => setStep(6), partyErr)}
      </>
    );
  } else {
    body = (
      <>
        <DateField
          label={t("godowns.goLiveDate")}
          value={goLive}
          max={todayIST()}
          onChange={(d) => d && setGoLive(d)}
          testId="wizard-golive"
        />
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("godowns.nothingToPost")}</p>
        ) : (
          <ul className="flex flex-col text-sm" data-testid="wizard-review">
            {items.map((it, i) => (
              <li key={i} className="flex min-h-11 items-center justify-between gap-2 border-b">
                <span className="min-w-0 truncate">
                  {it.kind === "CASH"
                    ? t("account.CASH")
                    : it.kind === "BANK"
                      ? names.bank(it.refId)
                      : it.kind === "STOCK"
                        ? names.variety(it.varietyId)
                        : names.party(it.refId)}
                </span>
                <Money paise={BigInt(it.amountPaise)} />
              </li>
            ))}
          </ul>
        )}
        {net !== 0n ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <span data-testid="wizard-capital" data-paise={(-net).toString()}>
              {t("godowns.capitalDiff", { amount: money(-net) })}
            </span>
            <Money paise={-net} className="font-semibold" />
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={capitalOk}
                onChange={(e) => setCapitalOk(e.target.checked)}
                data-testid="wizard-capital-ok"
              />
              {t("godowns.confirmCapital")}
            </label>
          </div>
        ) : null}
        {nav(() => void finish(), net !== 0n && !capitalOk, t("godowns.finish"))}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="godown-wizard">
      <h1 className="text-xl font-semibold">{dot(t("godowns.wizardTitle"), masters?.g?.name)}</h1>
      <p className="text-muted-foreground text-sm" data-testid="wizard-step" data-step={step}>
        {dot(
          t("godowns.step", { n: count(step + 1), total: count(STEPS.length) }),
          t(STEPS[step]!),
        )}
      </p>
      {body}
      {step >= 1 && step <= 5 ? (
        <Button variant="ghost" className="h-11 self-center" onClick={() => setStep(6)}>
          {t("godowns.skip")}
        </Button>
      ) : null}
    </div>
  );
}

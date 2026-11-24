"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormShell } from "@/components/forms/FormShell";
import { Choice, DateField } from "@/components/forms/fields";
import { PartyPicker } from "@/components/forms/pickers";
import { Money } from "@/components/money/display";
import { AmountInput } from "@/components/money/inputs";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { errorKey } from "@/client/errors";
import { useGodownRole } from "@/client/hooks";
import { saveSimple, type VoucherDraft } from "@/client/repo";
import { parseAmountField } from "@/client/ui/parse";
import { dot } from "@/client/ui/text";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

interface Row {
  partyId?: string;
  amount: string;
  side: "THEY_OWE" | "WE_OWE";
}

const emptyRow = (): Row => ({ amount: "", side: "THEY_OWE" });

/**
 * Bulk opening party balances (spec §10): one OPENING voucher of PARTY items. If OPENING_BAL
 * would not net to zero, the difference is recorded as capital (মূলধন) after a confirmation.
 */
export default function OpeningPage() {
  const { t, money } = useI18n();
  const router = useRouter();
  const { godownId, godown, readOnly } = useWriteGodown();
  const role = useGodownRole();
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [date, setDate] = useState(todayIST());
  const [capitalOk, setCapitalOk] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (role !== "owner") return <ReadOnlyNotice reason="viewer" />;
  if (!godownId) return <Loading />;
  const set = (i: number, patch: Partial<Row>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const items = rows
    .map((r) => ({ r, a: parseAmountField(r.amount) }))
    .filter((x) => x.r.partyId && x.a.value !== undefined && x.a.value > 0n)
    .map((x) => ({
      kind: "PARTY" as const,
      refId: x.r.partyId!,
      amountPaise: (x.r.side === "THEY_OWE" ? x.a.value! : -x.a.value!).toString(),
    }));
  const invalid = rows.some((r) => !!parseAmountField(r.amount).error);
  let net = 0n;
  for (const it of items) net += BigInt(it.amountPaise);
  const save = async () => {
    if (items.length === 0 || invalid || (net !== 0n && !capitalOk)) return;
    setSaving(true);
    try {
      const all =
        net !== 0n
          ? [...items, { kind: "CAPITAL" as const, amountPaise: (-net).toString() }]
          : items;
      const res = await saveSimple(godownId, { type: "OPENING", date, items: all } as VoucherDraft);
      setDirty(false);
      toast.success(t("openingBulk.posted"));
      router.replace(`/voucher/view?id=${res.primary._id}`);
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormShell
      title={t("openingBulk.title", { godown: godown?.name ?? "" })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      testId="opening-form"
      totals={<Money paise={net} className="text-lg font-semibold" />}
    >
      <p className="text-muted-foreground text-sm">{t("openingBulk.hint")}</p>
      <DateField label={t("openingBulk.date")} value={date} max={todayIST()} onChange={setDate} />
      {rows.map((r, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-md border p-2"
          data-testid={`opening-row-${i}`}
        >
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <PartyPicker
                godownId={godownId}
                label={t("reports.col.party")}
                value={r.partyId}
                onChange={(partyId) => set(i, { partyId })}
                allowClear
                testId={`opening-${i}-party`}
              />
            </div>
            {rows.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-12"
                aria-label={t("godowns.removeRow")}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            ) : null}
          </div>
          <AmountInput
            label={t("godowns.partyAmount")}
            value={r.amount}
            onChange={(amount) => set(i, { amount })}
            testId={`opening-${i}-amount`}
          />
          <Choice
            value={r.side}
            onChange={(side) => set(i, { side })}
            options={[
              { value: "THEY_OWE", label: t("godowns.theyOwe") },
              { value: "WE_OWE", label: t("godowns.weOwe") },
            ]}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => setRows([...rows, emptyRow()])}
      >
        {t("godowns.addRow")}
      </Button>
      {net !== 0n ? (
        <label className="flex min-h-11 items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <input
            type="checkbox"
            className="mt-1 size-5"
            checked={capitalOk}
            onChange={(e) => setCapitalOk(e.target.checked)}
            data-testid="opening-capital-ok"
          />
          <span>
            {dot(t("godowns.capitalDiff", { amount: money(-net) }), t("godowns.confirmCapital"))}
          </span>
        </label>
      ) : null}
    </FormShell>
  );
}

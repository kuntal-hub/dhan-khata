"use client";

import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { toast } from "sonner";
import { FormShell } from "@/components/forms/FormShell";
import {
  DateField,
  PayModeFields,
  emptyPayMode,
  type PayModeState,
} from "@/components/forms/fields";
import { VarietyPicker } from "@/components/forms/pickers";
import { Loading } from "@/components/lists/common";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { Row, viewPathOf } from "@/components/vouchers/VoucherView";
import { db } from "@/client/db/dexie";
import { acceptTransfer } from "@/client/repo";
import { today, useGodownTitle, useSaveError } from "@/components/trade/common";
import { useI18n } from "@/i18n/I18nProvider";

/** Accept a pending inter-godown receipt into the ACTIVE (receiving) godown's books. */
export function AcceptTransfer({ id }: { id?: string }) {
  const { t, money, weightOf, rate, date: fmtDate } = useI18n();
  const router = useRouter();
  const godownName = useGodownTitle();
  const { godownId, readOnly } = useWriteGodown();
  const onError = useSaveError();
  const tr = useLiveQuery(async () => (id ? ((await db().transfers.get(id)) ?? null) : null), [id]);
  const [varietyId, setVarietyId] = useState<string | undefined>();
  const [pay, setPay] = useState<PayModeState>(emptyPayMode());
  const [date, setDate] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  if (readOnly) return <ReadOnlyNotice reason={readOnly} />;
  if (tr === undefined || !godownId) return <Loading />;
  if (!tr || tr.godownId !== godownId || tr.status !== "pending")
    return <ReadOnlyNotice reason="notFound" />;

  const save = async () => {
    setShowErrors(true);
    if (tr.kind === "PADDY" && !varietyId) return;
    setSaving(true);
    try {
      const v = await acceptTransfer(godownId, tr._id, {
        ...(varietyId ? { varietyId } : {}),
        ...(tr.kind === "MONEY" ? { mode: pay.mode } : {}),
        ...(tr.kind === "MONEY" && pay.bankAccountId ? { bankAccountId: pay.bankAccountId } : {}),
        ...(date ? { date } : {}),
      });
      toast.success(t("transfer.accepted"));
      router.replace(viewPathOf(v));
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell
      title={t("transfer.acceptTitle", { godown: godownName })}
      dirty={false}
      saving={saving}
      onSubmit={() => void save()}
      saveLabel={t("transfer.accept")}
      testId="accept-form"
      totals={
        <span className="tabular text-lg font-semibold">{money(BigInt(tr.amountPaise))}</span>
      }
    >
      <div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
        <Row label={t("transfer.from", { godown: tr.fromGodownName })} value={tr.sendNumber} />
        <Row label={t("common.date")} value={fmtDate(tr.date)} />
        {tr.qtyG ? <Row label={t("stockPage.qty")} value={weightOf(BigInt(tr.qtyG))} /> : null}
        {tr.ratePaisePerQtl ? (
          <Row label={t("transfer.rate")} value={rate(BigInt(tr.ratePaisePerQtl))} />
        ) : null}
        <Row label={t("transfer.value")} value={money(BigInt(tr.amountPaise))} />
        {tr.notes ? <Row label={t("common.notes")} value={tr.notes} /> : null}
      </div>
      <DateField
        label={t("common.date")}
        value={date ?? tr.date}
        max={today()}
        onChange={setDate}
      />
      {tr.kind === "PADDY" ? (
        <VarietyPicker
          godownId={godownId}
          label={t("stockPage.variety")}
          value={varietyId}
          onChange={setVarietyId}
          required
          error={showErrors && !varietyId ? "errors.validation.required" : null}
          testId="accept-variety"
        />
      ) : (
        <PayModeFields godownId={godownId} value={pay} onChange={setPay} />
      )}
    </FormShell>
  );
}

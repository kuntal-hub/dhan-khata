"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Choice } from "@/components/forms/fields";
import { AmountInput } from "@/components/money/inputs";
import { Balance } from "@/components/money/display";
import { EmptyState, Loading } from "@/components/lists/common";
import { PageHeader, ReadOnlyNotice } from "@/components/system/page";
import { Row } from "@/components/vouchers/VoucherView";
import { db } from "@/client/db/dexie";
import { useActiveGodown } from "@/client/hooks";
import { dueList, partyAging } from "@/client/queries/parties";
import { partyTitle } from "@/client/ui/labels";
import { parseAmountField } from "@/client/ui/parse";
import { AGING_BUCKETS, type AgingBucket } from "@/domain/aging";
import { todayIST } from "@/domain/dates";
import { PartyRoleSchema, type PartyRole } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

type Kind = "ALL" | "RECEIVABLE" | "PAYABLE" | "ADV_GIVEN" | "ADV_TAKEN";

/** বাকি / অগ্রিম (spec §9.6): non-zero balances with filters, sort and aging. */
export default function DuePage() {
  const { t, lang, money, date } = useI18n();
  const { godownId } = useActiveGodown();
  const [kind, setKind] = useState<Kind>("ALL");
  const [role, setRole] = useState<PartyRole | "">("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [sort, setSort] = useState<"AMOUNT" | "OLDEST">("AMOUNT");
  const today = todayIST();
  const data = useLiveQuery(async () => {
    if (!godownId) return null;
    const rows = await dueList(godownId);
    const overdue = new Set(
      (await db().reminders.where("[godownId+status]").equals([godownId, "open"]).toArray())
        .filter((r) => r.dueDate < today && r.partyId)
        .map((r) => r.partyId!),
    );
    const totals: Record<AgingBucket, bigint> = { D0_30: 0n, D31_60: 0n, D61_90: 0n, D90_PLUS: 0n };
    for (const r of rows) {
      const a = await partyAging(godownId, r.party._id, today);
      for (const b of AGING_BUCKETS) totals[b] += a.receivable[b] + a.payable[b];
    }
    return { rows, overdue, totals };
  }, [godownId, today]);
  if (!godownId) return <ReadOnlyNotice reason="noGodown" />;
  const minV = parseAmountField(min).value;
  const maxV = parseAmountField(max).value;
  const shown = (data?.rows ?? [])
    .filter((r) => {
      if (kind === "RECEIVABLE" && r.balancePaise <= 0n) return false;
      if (kind === "PAYABLE" && r.balancePaise >= 0n) return false;
      if (kind === "ADV_GIVEN" && r.advanceGivenPaise <= 0n) return false;
      if (kind === "ADV_TAKEN" && r.advanceTakenPaise <= 0n) return false;
      if (role && !r.party.roles.includes(role)) return false;
      if (overdueOnly && !data?.overdue.has(r.party._id)) return false;
      const abs = r.balancePaise < 0n ? -r.balancePaise : r.balancePaise;
      if (minV !== undefined && abs < minV) return false;
      if (maxV !== undefined && abs > maxV) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "OLDEST")
        return (a.oldestOpenDate ?? "9999") < (b.oldestOpenDate ?? "9999") ? -1 : 1;
      const aa = a.balancePaise < 0n ? -a.balancePaise : a.balancePaise;
      const bb = b.balancePaise < 0n ? -b.balancePaise : b.balancePaise;
      return aa === bb ? 0 : aa > bb ? -1 : 1;
    });
  let receivable = 0n;
  let payable = 0n;
  for (const r of data?.rows ?? []) {
    if (r.balancePaise > 0n) receivable += r.balancePaise;
    else payable -= r.balancePaise;
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("due.title")} />
      {data ? (
        <Card>
          <CardContent className="grid grid-cols-2 gap-2 pt-6 text-sm">
            <Row
              label={t("due.receivable")}
              value={<span className="font-semibold text-emerald-700">{money(receivable)}</span>}
              testId="due-receivable"
            />
            <Row
              label={t("due.payable")}
              value={<span className="font-semibold text-red-700">{money(payable)}</span>}
              testId="due-payable"
            />
            {AGING_BUCKETS.map((b) => (
              <Row key={b} label={t(`due.aging.${b}` as TKey)} value={money(data.totals[b])} />
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Choice
        value={kind}
        onChange={setKind}
        wrap
        options={[
          { value: "ALL", label: t("common.all") },
          { value: "RECEIVABLE", label: t("due.receivable") },
          { value: "PAYABLE", label: t("due.payable") },
          { value: "ADV_GIVEN", label: t("due.advanceGiven") },
          { value: "ADV_TAKEN", label: t("due.advanceTaken") },
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          className="border-input h-12 rounded-md border px-2 text-base"
          value={role}
          aria-label={t("party.roles")}
          onChange={(e) => setRole(e.target.value as PartyRole | "")}
        >
          <option value="">{t("common.all")}</option>
          {PartyRoleSchema.options.map((r) => (
            <option key={r} value={r}>
              {t(`partyRole.${r}` as TKey)}
            </option>
          ))}
        </select>
        <select
          className="border-input h-12 rounded-md border px-2 text-base"
          value={sort}
          aria-label={t("due.sort")}
          onChange={(e) => setSort(e.target.value as "AMOUNT" | "OLDEST")}
        >
          <option value="AMOUNT">{t("due.sortAmount")}</option>
          <option value="OLDEST">{t("due.sortOldest")}</option>
        </select>
        <AmountInput label={t("due.minAmount")} value={min} onChange={setMin} />
        <AmountInput label={t("due.maxAmount")} value={max} onChange={setMax} />
        <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          {t("due.overdueOnly")}
        </label>
      </div>
      {!data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState text={t("due.empty")} />
      ) : (
        <ul data-testid="due-list">
          {shown.map((r) => {
            const { title, sub } = partyTitle(r.party, lang);
            return (
              <li key={r.party._id}>
                <Link
                  href={`/party/view?id=${r.party._id}`}
                  className="hover:bg-muted flex min-h-16 items-center gap-3 border-b px-1 py-2"
                  data-testid="due-row"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{title}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {[
                        sub,
                        r.party.phone,
                        r.party.roles.map((x) => t(`partyRole.${x}` as TKey)).join(", "),
                        r.oldestOpenDate
                          ? t("due.oldestBill", { date: date(r.oldestOpenDate, "short") })
                          : null,
                        data.overdue.has(r.party._id) ? t("due.overdue") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <Balance paise={r.balancePaise} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

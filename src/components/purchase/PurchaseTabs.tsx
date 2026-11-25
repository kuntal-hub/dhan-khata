"use client";

/**
 * Purchase section tabs (requirement_v2 §12.2): কেনার তালিকা (search, date range, variety, paid
 * status, totals), কৃষকের হিসাব (farmers with payable), ধানের জাত (variety management).
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useDeferredValue, useState } from "react";
import { Search, Sprout, Users, Wheat } from "lucide-react";
import { companyLabel, NewVarietyForm, varietyName } from "@/components/entry/Variety";
import { EmptyState, Panel, Skeleton, TxnCard } from "@/components/kit/Kit";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import {
  farmerSummaries,
  purchaseRows,
  purchaseTotals,
  varietyRows,
  type PurchaseFilter,
} from "@/client/queries/purchases";
import { mergeVarieties, upsertMaster } from "@/client/repo";
import { formatWeightNumber } from "@/domain/units";
import { VARIETY_COMPANIES, type Variety } from "@/domain/schemas";
import type { PayStatus } from "@/domain/v2/payments";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { useWriteGodown } from "@/components/system/page";

export function PurchaseList() {
  const { t, money, date, digits } = useI18n();
  const { godownId } = useActiveGodown();
  const business = useBusiness();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PayStatus | "ALL">("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const dq = useDeferredValue(q);
  const filter: PurchaseFilter = {
    q: dq,
    status,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const rows = useLiveQuery(
    () => (godownId ? purchaseRows(godownId, filter) : []),
    [godownId, dq, status, from, to],
  );
  const totals = rows ? purchaseTotals(rows) : null;
  const o = { digits, monKg: business?.monKg };
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-card shadow-card flex items-center gap-2 rounded-2xl border px-3">
        <Search className="text-muted-foreground size-5" aria-hidden />
        <input
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
          placeholder={t("pur.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("pur.search")}
          data-testid="purchase-search"
        />
      </div>
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {(["ALL", "UNPAID", "PARTIAL", "PAID", "OVERDUE"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={`press min-h-10 shrink-0 rounded-full border px-4 text-sm ${status === s ? "bg-primary text-primary-foreground border-primary" : "bg-card"}`}
          >
            {s === "ALL" ? t("pur.filterAll") : t(`ui.status.${s}` as TKey)}
          </button>
        ))}
        <label className="bg-card flex min-h-10 shrink-0 items-center gap-1 rounded-full border px-3 text-sm">
          {t("pur.filterFrom")}
          <input
            type="date"
            className="bg-transparent"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="bg-card flex min-h-10 shrink-0 items-center gap-1 rounded-full border px-3 text-sm">
          {t("pur.filterTo")}
          <input
            type="date"
            className="bg-transparent"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      {totals && totals.count > 0 ? (
        <div
          className="bg-forest-100/60 text-forest grid grid-cols-3 gap-2 rounded-2xl p-3 text-center text-sm"
          data-testid="purchase-totals"
        >
          <span>{t("pur.count", { count: totals.count })}</span>
          <span className="tabular">
            {formatWeightNumber(totals.qtyG, "QTL", o)} {t("ui.unitQtlShort")}
          </span>
          <span className="tabular font-semibold">{money(totals.amountPaise)}</span>
        </div>
      ) : null}
      {rows === undefined ? (
        <Skeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wheat}
          title={t("pur.empty")}
          hint={t("pur.emptyHint")}
          action={
            <Button asChild className="h-12">
              <Link href="/purchase/new">{t("quick.purchase")}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="purchase-list">
          {rows.map((r, i) => (
            <li key={r.doc._id}>
              <TxnCard
                index={i}
                icon={Wheat}
                tone="gold"
                title={r.party?.name ?? ""}
                subtitle={`${varietyName(r.variety, t)} · ${formatWeightNumber(BigInt(r.doc.weight.netG), "QTL", o)} ${t("ui.unitQtlShort")}`}
                date={`${date(r.doc.transactionDate, "short")} · ${r.doc.number}`}
                amountPaise={BigInt(r.doc.totalPaise)}
                status={r.doc.status === "void" ? "VOID" : r.state.status}
                href={`/purchase/view?id=${r.doc._id}`}
                testId="purchase-row"
                extra={
                  r.doc.status === "active" && r.state.duePaise > 0n ? (
                    <span className="tabular text-xs text-red-700">
                      {t("pay.due", { amount: money(r.state.duePaise) })}
                    </span>
                  ) : null
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FarmerList() {
  const { t, money, digits } = useI18n();
  const { godownId } = useActiveGodown();
  const business = useBusiness();
  const [q, setQ] = useState("");
  const rows = useLiveQuery(() => (godownId ? farmerSummaries(godownId) : []), [godownId]);
  const o = { digits, monKg: business?.monKg };
  const shown = (rows ?? []).filter(
    (r) =>
      !q.trim() ||
      `${r.party.name} ${r.party.phone ?? ""} ${r.party.searchKey}`
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-card shadow-card flex items-center gap-2 rounded-2xl border px-3">
        <Search className="text-muted-foreground size-5" aria-hidden />
        <input
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
          placeholder={t("common.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("common.search")}
        />
      </div>
      {rows === undefined ? (
        <Skeleton rows={4} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Users} title={t("pur.farmersEmpty")} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {shown.map((r, i) => (
            <li key={r.party._id}>
              <TxnCard
                index={i}
                icon={Users}
                title={r.party.name}
                subtitle={`${t("pur.boughtQty")}: ${formatWeightNumber(r.qtyG, "QTL", o)} ${t("ui.unitQtlShort")} · ${money(r.amountPaise)}`}
                {...(r.party.phone ? { date: r.party.phone } : {})}
                amountPaise={r.balancePaise < 0n ? -r.balancePaise : r.balancePaise}
                direction={r.balancePaise < 0n ? "OUT" : r.balancePaise > 0n ? "IN" : undefined}
                href={`/purchase/farmer?id=${r.party._id}`}
                testId="farmer-row"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VarietyManager() {
  const { t } = useI18n();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const [q, setQ] = useState("");
  const [company, setCompany] = useState<string>("ALL");
  const [product, setProduct] = useState<"PADDY" | "RICE">("PADDY");
  const [adding, setAdding] = useState(false);
  const [merge, setMerge] = useState<{ from: Variety; to?: string } | null>(null);
  const data = useLiveQuery(() => (godownId ? varietyRows(godownId) : undefined), [godownId]);
  if (!godownId) return null;
  const all = data?.all ?? [];
  const shown = all
    .filter((r) => r.variety.product === product)
    .filter(
      (r) =>
        company === "ALL" ||
        (company === "NONE" ? !r.variety.company : r.variety.company === company),
    )
    .filter(
      (r) =>
        !q.trim() ||
        `${varietyName(r.variety, t)} ${r.variety.nameAlt ?? ""}`
          .toLowerCase()
          .includes(q.trim().toLowerCase()),
    )
    .sort((a, b) => varietyName(a.variety, t).localeCompare(varietyName(b.variety, t)));
  const recent = new Set(data?.recent ?? []);
  return (
    <div className="flex flex-col gap-3" data-testid="variety-manager">
      <div className="flex gap-2">
        <div className="bg-card shadow-card flex min-w-0 flex-1 items-center gap-2 rounded-2xl border px-3">
          <Search className="text-muted-foreground size-5" aria-hidden />
          <input
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
            placeholder={t("vari.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t("vari.search")}
          />
        </div>
        {readOnly ? null : (
          <Button
            className="h-12 shrink-0"
            onClick={() => setAdding(true)}
            data-testid="variety-add"
          >
            {t("vari.add")}
          </Button>
        )}
      </div>
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {(["PADDY", "RICE"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={product === p}
            onClick={() => setProduct(p)}
            className={`press min-h-10 shrink-0 rounded-full border px-4 text-sm ${product === p ? "bg-primary text-primary-foreground border-primary" : "bg-card"}`}
          >
            {t(`vari.${p}` as TKey)}
          </button>
        ))}
        {(["ALL", "NONE", ...VARIETY_COMPANIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={company === c}
            onClick={() => setCompany(c)}
            className={`press min-h-10 shrink-0 rounded-full border px-4 text-sm ${company === c ? "bg-gold-100 border-gold font-semibold" : "bg-card"}`}
          >
            {c === "ALL"
              ? t("pur.filterAll")
              : c === "NONE"
                ? t("vari.noCompany")
                : t(`vari.${c}` as TKey)}
          </button>
        ))}
      </div>
      {data === undefined ? (
        <Skeleton rows={4} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Sprout} title={t("vari.empty")} />
      ) : (
        <Panel>
          <ul className="flex flex-col divide-y">
            {shown.map((r) => (
              <li
                key={r.variety._id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3"
                data-testid="variety-row"
              >
                <span className="bg-gold-100 text-gold-600 flex size-10 items-center justify-center rounded-xl">
                  <Sprout className="size-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-medium">
                    {varietyName(r.variety, t)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {[
                      companyLabel(r.variety, t),
                      r.variety.verified ? t("vari.verified") : "",
                      recent.has(r.variety._id) ? t("vari.recent") : "",
                      t("vari.used", { count: r.uses }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {readOnly ? null : (
                  <span className="ml-auto flex max-w-full flex-wrap justify-end gap-1">
                    <Button
                      variant="ghost"
                      className="h-11 text-sm"
                      onClick={() => setMerge({ from: r.variety })}
                    >
                      {t("vari.merge")}
                    </Button>
                    {r.uses === 0 ? (
                      <Button
                        variant="ghost"
                        className="text-muted-foreground h-11 text-sm"
                        onClick={async () => {
                          try {
                            const { serverSeq: _s, ...rest } = r.variety as Variety & {
                              serverSeq?: number;
                            };
                            await upsertMaster(godownId, "variety", { ...rest, status: "void" });
                            lazyToast(t("vari.archived"), "success");
                          } catch (e) {
                            lazyToast(t(errorKey(e)), "error");
                          }
                        }}
                      >
                        {t("vari.archive")}
                      </Button>
                    ) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {adding ? (
        <BottomSheet open={adding} onOpenChange={setAdding} title={t("vari.add")}>
          <NewVarietyForm
            godownId={godownId}
            product={product}
            initial=""
            onDone={() => {
              lazyToast(t("vari.saved"), "success");
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </BottomSheet>
      ) : null}
      {merge ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setMerge(null)}
          title={t("vari.merge")}
          body={
            merge.to
              ? t("vari.mergeConfirm", {
                  from: varietyName(merge.from, t),
                  to: varietyName(all.find((x) => x.variety._id === merge.to)?.variety, t),
                })
              : t("vari.mergeInto")
          }
          confirmLabel={t("vari.merge")}
          onConfirm={async () => {
            if (!merge.to) return;
            try {
              await mergeVarieties(godownId, merge.to, merge.from._id);
              lazyToast(t("vari.merged"), "success");
              setMerge(null);
            } catch (e) {
              lazyToast(t(errorKey(e)), "error");
            }
          }}
        >
          <select
            className="border-input h-12 rounded-md border px-3 text-base"
            value={merge.to ?? ""}
            onChange={(e) => setMerge({ ...merge, to: e.target.value || undefined })}
            aria-label={t("vari.mergeInto")}
          >
            <option value="">{t("vari.mergeInto")}</option>
            {all
              .filter(
                (x) => x.variety._id !== merge.from._id && x.variety.product === merge.from.product,
              )
              .map((x) => (
                <option key={x.variety._id} value={x.variety._id}>
                  {varietyName(x.variety, t)} {companyLabel(x.variety, t)}
                </option>
              ))}
          </select>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

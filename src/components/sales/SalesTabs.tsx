"use client";

/**
 * Sales section tabs (requirement_v2 §12.3): বিক্রির তালিকা (search, date range, paid status,
 * totals, Gola transfer action), ক্রেতার হিসাব (buyers with receivable), ডেলিভারি (sales by
 * delivery status with one-tap next step).
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useDeferredValue, useState } from "react";
import { ArrowRightLeft, HandCoins, Search, Truck, Users } from "lucide-react";
import { varietyName } from "@/components/entry/Variety";
import { EmptyState, Skeleton, TxnCard } from "@/components/kit/Kit";
import { lazyToast } from "@/components/system/IdleToaster";
import { useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useBusiness, useGodownRole } from "@/client/hooks";
import {
  customerSummaries,
  saleRows,
  saleTotals,
  type DeliveryStatus,
  type SaleFilter,
  type SaleRow,
} from "@/client/queries/sales";
import { setDeliveryStatus } from "@/client/repo";
import { formatWeightNumber } from "@/domain/units";
import type { PayStatus } from "@/domain/v2/payments";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

const DELIVERY: readonly DeliveryStatus[] = ["PENDING", "LOADED", "IN_TRANSIT", "DELIVERED"];

function Chip({
  on,
  onClick,
  children,
  testId,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "press min-h-10 shrink-0 rounded-full border px-4 text-sm",
        on ? "bg-primary text-primary-foreground border-primary" : "bg-card",
      )}
    >
      {children}
    </button>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testId?: string;
}) {
  return (
    <div className="bg-card shadow-card flex items-center gap-2 rounded-2xl border px-3">
      <Search className="text-muted-foreground size-5" aria-hidden />
      <input
        className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
        data-testid={testId}
      />
    </div>
  );
}

function SaleCard({ r, index }: { r: SaleRow; index: number }) {
  const { t, money, date, digits } = useI18n();
  const business = useBusiness();
  const o = { digits, monKg: business?.monKg };
  const status =
    r.doc.status === "void" ? "VOID" : r.doc.saleStatus === "ORDER" ? "ORDER" : r.state.status;
  return (
    <TxnCard
      index={index}
      icon={r.doc.interGola ? ArrowRightLeft : HandCoins}
      tone="green"
      title={r.party?.name ?? ""}
      subtitle={`${t(`sl.${r.doc.product}` as TKey)} · ${varietyName(r.variety, t)} · ${formatWeightNumber(BigInt(r.doc.weight.netG), "QTL", o)} ${t("ui.unitQtlShort")}`}
      date={`${date(r.doc.transactionDate, "short")} · ${r.doc.number} · ${t(`sl.delivery.${r.doc.deliveryStatus}` as TKey)}`}
      amountPaise={BigInt(r.doc.totalPaise)}
      direction="IN"
      status={status}
      href={`/sales/view?id=${r.doc._id}`}
      testId="sale-row"
      extra={
        r.doc.status === "active" && r.doc.saleStatus === "CONFIRMED" && r.state.duePaise > 0n ? (
          <span className="tabular text-xs text-emerald-800">
            {t("pay.due", { amount: money(r.state.duePaise) })}
          </span>
        ) : null
      }
    />
  );
}

export function SalesList() {
  const { t, money, digits } = useI18n();
  const { godownId, godowns } = useActiveGodown();
  const role = useGodownRole();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PayStatus | "ALL">("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const dq = useDeferredValue(q);
  const filter: SaleFilter = {
    q: dq,
    status,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const rows = useLiveQuery(
    () => (godownId ? saleRows(godownId, filter) : []),
    [godownId, dq, status, from, to],
  );
  const totals = rows ? saleTotals(rows) : null;
  const o = { digits, monKg: business?.monKg };
  const otherGolas = (godowns ?? []).filter((g) => g.status === "active" && g._id !== godownId);
  return (
    <div className="flex flex-col gap-3">
      <SearchBox value={q} onChange={setQ} placeholder={t("sl.search")} testId="sale-search" />
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {(["ALL", "UNPAID", "PARTIAL", "PAID", "OVERDUE"] as const).map((s) => (
          <Chip key={s} on={status === s} onClick={() => setStatus(s)}>
            {s === "ALL" ? t("pur.filterAll") : t(`ui.status.${s}` as TKey)}
          </Chip>
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
      {!readOnly && role === "owner" && otherGolas.length > 0 ? (
        <Button asChild variant="outline" className="h-12 self-start">
          <Link href="/sales/transfer" data-testid="sale-transfer">
            <ArrowRightLeft className="size-5" aria-hidden />
            {t("sl.transfer")}
          </Link>
        </Button>
      ) : null}
      {totals && totals.count + totals.orders > 0 ? (
        <div
          className="bg-forest-100/60 text-forest grid grid-cols-3 gap-2 rounded-2xl p-3 text-center text-sm"
          data-testid="sale-totals"
        >
          <span>
            {t("sl.count", { count: totals.count })}
            {totals.orders ? (
              <span className="block text-xs">{t("sl.orders", { count: totals.orders })}</span>
            ) : null}
          </span>
          <span className="tabular">
            {formatWeightNumber(totals.paddyG + totals.riceG, "QTL", o)} {t("ui.unitQtlShort")}
          </span>
          <span className="tabular font-semibold">{money(totals.amountPaise)}</span>
        </div>
      ) : null}
      {rows === undefined ? (
        <Skeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title={t("sl.empty")}
          hint={t("sl.emptyHint")}
          action={
            readOnly ? undefined : (
              <Button asChild className="h-12">
                <Link href="/sales/new">{t("quick.sale")}</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="sale-list">
          {rows.map((r, i) => (
            <li key={r.doc._id}>
              <SaleCard r={r} index={i} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CustomerList() {
  const { t, money, digits } = useI18n();
  const { godownId } = useActiveGodown();
  const business = useBusiness();
  const [q, setQ] = useState("");
  const rows = useLiveQuery(() => (godownId ? customerSummaries(godownId) : []), [godownId]);
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
      <SearchBox value={q} onChange={setQ} placeholder={t("common.search")} />
      {rows === undefined ? (
        <Skeleton rows={4} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Users} title={t("sl.customersEmpty")} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {shown.map((r, i) => (
            <li key={r.party._id}>
              <TxnCard
                index={i}
                icon={Users}
                title={r.party.name}
                subtitle={`${t("sl.soldQty")}: ${formatWeightNumber(r.paddyG + r.riceG, "QTL", o)} ${t("ui.unitQtlShort")} · ${money(r.amountPaise)}`}
                {...(r.party.phone ? { date: r.party.phone } : {})}
                amountPaise={r.balancePaise < 0n ? -r.balancePaise : r.balancePaise}
                direction={r.balancePaise > 0n ? "IN" : r.balancePaise < 0n ? "OUT" : undefined}
                href={`/sales/customer?id=${r.party._id}`}
                testId="customer-row"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const NEXT: Record<DeliveryStatus, DeliveryStatus | null> = {
  PENDING: "LOADED",
  LOADED: "IN_TRANSIT",
  IN_TRANSIT: "DELIVERED",
  DELIVERED: null,
};

export function DeliveryBoard() {
  const { t } = useI18n();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const [tab, setTab] = useState<DeliveryStatus | "ALL">("PENDING");
  const rows = useLiveQuery(
    () =>
      godownId
        ? saleRows(godownId, { delivery: tab }).then((r) =>
            r.filter((x) => x.doc.status === "active"),
          )
        : [],
    [godownId, tab],
  );
  const counts = useLiveQuery(async () => {
    if (!godownId) return null;
    const all = (await saleRows(godownId)).filter((x) => x.doc.status === "active");
    const m = new Map<DeliveryStatus, number>();
    for (const r of all) m.set(r.doc.deliveryStatus, (m.get(r.doc.deliveryStatus) ?? 0) + 1);
    return m;
  }, [godownId]);
  const advance = async (r: SaleRow) => {
    const next = NEXT[r.doc.deliveryStatus];
    if (!next || !godownId) return;
    try {
      await setDeliveryStatus(godownId, r.doc._id, next);
      lazyToast(t("sl.deliveryUpdated"), "success");
    } catch (e) {
      lazyToast(t(errorKey(e)), "error");
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {DELIVERY.map((d) => (
          <Chip key={d} on={tab === d} onClick={() => setTab(d)} testId={`delivery-tab-${d}`}>
            {t(`sl.delivery.${d}` as TKey)}
            {counts?.get(d) ? ` · ${counts.get(d)}` : ""}
          </Chip>
        ))}
        <Chip on={tab === "ALL"} onClick={() => setTab("ALL")}>
          {t("sl.deliveryAll")}
        </Chip>
      </div>
      {rows === undefined ? (
        <Skeleton rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Truck} title={t("sl.deliveryEmpty")} />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="delivery-list">
          {rows.map((r, i) => {
            const next = NEXT[r.doc.deliveryStatus];
            return (
              <li key={r.doc._id} className="flex flex-col gap-1.5">
                <SaleCard r={r} index={i} />
                {next && !readOnly ? (
                  <Button
                    variant="outline"
                    className="h-11 self-end"
                    onClick={() => void advance(r)}
                    data-testid="delivery-next"
                  >
                    <Truck className="size-4" aria-hidden />
                    {t("sl.moveTo", { status: t(`sl.delivery.${next}` as TKey) })}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

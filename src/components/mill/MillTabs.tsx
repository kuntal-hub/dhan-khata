"use client";

/**
 * Mill & Second Party section tabs (requirement_v2.1 §12.8): সেকেন্ড পার্টি খাতা (parties with
 * balance), মিলে পাঠানো (dispatch-wise: what the mill owes us, paddy still at the mill), মিল থেকে
 * ফেরত (credits), ভাঙানোর হিসাব (stock only), চূড়ান্ত হিসাব (final settlement per dispatch).
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useDeferredValue, useState } from "react";
import { Factory, PackageOpen, RotateCcw, Scale, Users } from "lucide-react";
import { varietyName } from "@/components/entry/Variety";
import { EmptyState, Skeleton, TxnCard } from "@/components/kit/Kit";
import { SearchBox } from "@/components/sales/SalesTabs";
import { useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import {
  conversionRows,
  dispatchRows,
  returnRows,
  secondPartySummaries,
  type DispatchRow,
} from "@/client/queries/mill";
import { formatWeightNumber } from "@/domain/units";
import { displayStatus } from "@/domain/v2/payments";
import { useI18n } from "@/i18n/I18nProvider";

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={"chip"}>
      {children}
    </button>
  );
}

function useQtl() {
  const { digits } = useI18n();
  const business = useBusiness();
  return (g: bigint) => formatWeightNumber(g, "QTL", { digits, monKg: business?.monKg });
}

function NewButton({ href, label, testId }: { href: string; label: string; testId: string }) {
  const { readOnly } = useWriteGodown();
  if (readOnly) return null;
  return (
    <Button asChild className="h-12 self-start">
      <Link href={href} data-testid={testId}>
        {label}
      </Link>
    </Button>
  );
}

/** A dispatch: what the mill owes us for it (incoming, green), and the paddy still at the mill. */
function DispatchCard({ r, index }: { r: DispatchRow; index: number }) {
  const { t, date, money } = useI18n();
  const qtl = useQtl();
  const due = r.money.receivablePaise;
  return (
    <TxnCard
      index={index}
      icon={Factory}
      tone="in"
      title={r.mill?.name ?? ""}
      subtitle={`${varietyName(r.variety, t)} · ${qtl(BigInt(r.doc.weight.netG))} ${t("ui.unitQtlShort")}`}
      date={`${date(r.doc.dispatchDate, "short")} · ${r.doc.number}`}
      amountPaise={r.money.netValuePaise}
      direction="IN"
      {...(r.doc.status === "void"
        ? { status: "VOID" as const }
        : r.money.netValuePaise > 0n
          ? { status: displayStatus(r.state) }
          : {})}
      href={`/mill/dispatch/view?id=${r.doc._id}`}
      testId="dispatch-row"
      extra={
        r.doc.status === "active" ? (
          <span className="flex flex-wrap gap-x-3 text-xs">
            <span className="tabular text-amber-800" data-testid="dispatch-at-mill">
              {t("mill.atMillShort", { qty: qtl(r.balance.remainingG) })}
            </span>
            {due > 0n ? (
              <span className="tabular text-emerald-800" data-testid="dispatch-receivable">
                {t("mill.remaining")}: {money(due)}
              </span>
            ) : due < 0n ? (
              <span className="tabular text-amber-800">
                {t("mill.refundDue")}: {money(-due)}
              </span>
            ) : null}
            {r.settlement ? (
              <span className="text-muted-foreground">{t("mill.finalBadge")}</span>
            ) : null}
          </span>
        ) : null
      }
    />
  );
}

export function DispatchList() {
  const { t } = useI18n();
  const { godownId } = useActiveGodown();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const dq = useDeferredValue(q);
  const rows = useLiveQuery(
    () => (godownId ? dispatchRows(godownId, { q: dq, open }) : []),
    [godownId, dq, open],
  );
  return (
    <div className="flex flex-col gap-3">
      <NewButton href="/mill/dispatch/new" label={t("mill.newDispatch")} testId="dispatch-new" />
      <SearchBox value={q} onChange={setQ} placeholder={t("mill.search")} />
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        <Chip on={!open} onClick={() => setOpen(false)}>
          {t("mill.filterAll")}
        </Chip>
        <Chip on={open} onClick={() => setOpen((x) => !x)}>
          {t("mill.filterOpen")}
        </Chip>
      </div>
      {rows === undefined ? (
        <Skeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Factory}
          title={t("mill.dispatchEmpty")}
          hint={t("mill.dispatchEmptyHint")}
        />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="dispatch-list">
          {rows.map((r, i) => (
            <li key={r.doc._id}>
              <DispatchCard r={r} index={i} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReturnList() {
  const { t, date, money } = useI18n();
  const { godownId } = useActiveGodown();
  const qtl = useQtl();
  const [product, setProduct] = useState<"ALL" | "PADDY" | "RICE" | "OTHER">("ALL");
  const rows = useLiveQuery(
    () => (godownId ? returnRows(godownId, { product }) : []),
    [godownId, product],
  );
  return (
    <div className="flex flex-col gap-3">
      <NewButton href="/mill/return/new" label={t("mill.addReturn")} testId="return-new" />
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {(["ALL", "PADDY", "RICE", "OTHER"] as const).map((k) => (
          <Chip key={k} on={product === k} onClick={() => setProduct(k)}>
            {k === "ALL" ? t("mill.filterAll") : t(`mill.${k}`)}
          </Chip>
        ))}
      </div>
      {rows === undefined ? (
        <Skeleton rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={RotateCcw} title={t("mill.returnEmpty")} />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="return-list">
          {rows.map((r, i) => (
            <li key={r.doc._id}>
              <TxnCard
                index={i}
                icon={RotateCcw}
                tone="green"
                title={r.mill?.name ?? ""}
                subtitle={`${r.doc.product === "OTHER" ? r.doc.otherProductName : t(`mill.${r.doc.product}`)}${r.variety ? ` · ${varietyName(r.variety, t)}` : ""} · ${qtl(BigInt(r.doc.weight.netG))} ${t("ui.unitQtlShort")}`}
                date={`${date(r.doc.returnDate, "short")} · ${r.doc.number}${r.dispatch ? ` · ${r.dispatch.number}` : ""}`}
                {...(r.doc.status === "void" ? { status: "VOID" as const } : {})}
                href={`/mill/return/view?id=${r.doc._id}`}
                testId="return-row"
                extra={
                  r.converted ? (
                    <span className="text-muted-foreground text-xs">
                      {t("mill.convertedBadge")}
                    </span>
                  ) : r.creditPaise > 0n ? (
                    <span className="text-muted-foreground tabular text-xs">
                      {t("mill.creditEffect", { amount: money(r.creditPaise) })}
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

export function ConversionList() {
  const { t, date } = useI18n();
  const { godownId } = useActiveGodown();
  const qtl = useQtl();
  const rows = useLiveQuery(() => (godownId ? conversionRows(godownId) : []), [godownId]);
  return (
    <div className="flex flex-col gap-3">
      <NewButton
        href="/mill/conversion/new"
        label={t("mill.addConversion")}
        testId="conversion-new"
      />
      {rows === undefined ? (
        <Skeleton rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={PackageOpen} title={t("mill.convEmpty")} />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="conversion-list">
          {rows.map((r, i) => (
            <li key={r.doc._id}>
              <TxnCard
                index={i}
                icon={PackageOpen}
                tone="gold"
                title={r.mill?.name ?? ""}
                subtitle={`${varietyName(r.variety, t)} · ${t("mill.consumed")} ${qtl(BigInt(r.doc.paddyConsumedG))} ${t("ui.unitQtlShort")} · ${t("mill.loss")} ${qtl(BigInt(r.doc.lossG))} ${t("ui.unitQtlShort")}`}
                date={`${date(r.doc.conversionDate, "short")} · ${r.doc.number}${r.dispatch ? ` · ${r.dispatch.number}` : ""}`}
                {...(r.doc.status === "void" ? { status: "VOID" as const } : {})}
                href={`/mill/conversion/view?id=${r.doc._id}`}
                testId="conversion-row"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "চূড়ান্ত হিসাব / Final settlement" tab (v2.1): dispatches with paddy at the mill and no final
 * settlement yet (with a button to settle), then the dispatches already settled.
 */
export function SettlementList() {
  const { t } = useI18n();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const rows = useLiveQuery(() => (godownId ? dispatchRows(godownId) : []), [godownId]);
  const waiting = (rows ?? []).filter(
    (r) => r.doc.status === "active" && !r.settlement && r.balance.remainingG > 0n,
  );
  const done = (rows ?? []).filter((r) => r.doc.status === "active" && !!r.settlement);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t("mill.finalInfo")}</p>
      <section className="flex flex-col gap-2.5">
        {rows === undefined ? (
          <Skeleton rows={2} />
        ) : waiting.length === 0 ? (
          <EmptyState icon={Scale} title={t("mill.finalNone")} />
        ) : (
          <ul className="flex flex-col gap-2.5" data-testid="settlement-open">
            {waiting.map((r, i) => (
              <li key={r.doc._id} className="flex flex-col gap-1.5">
                <DispatchCard r={r} index={i} />
                {readOnly ? null : (
                  <Button asChild variant="outline" className="h-11 self-end">
                    <Link href={`/mill/settle?dispatch=${r.doc._id}`} data-testid="settlement-add">
                      {t("mill.finalAdd")}
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2.5">
        <h2 className="text-[15px] font-semibold">{t("mill.finalDoneList")}</h2>
        {done.length > 0 ? (
          <ul className="flex flex-col gap-2.5" data-testid="settlement-done">
            {done.map((r, i) => (
              <li key={r.doc._id}>
                <DispatchCard r={r} index={i} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("mill.none")}</p>
        )}
      </section>
    </div>
  );
}

export function SecondPartyList() {
  const { t, money, date } = useI18n();
  const { godownId } = useActiveGodown();
  const [q, setQ] = useState("");
  const rows = useLiveQuery(() => (godownId ? secondPartySummaries(godownId) : []), [godownId]);
  const shown = (rows ?? []).filter(
    (r) =>
      !q.trim() ||
      `${r.party.name} ${r.party.phone ?? ""} ${r.party.searchKey}`
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );
  const we = (rows ?? []).reduce((s, r) => s + (r.balancePaise < 0n ? -r.balancePaise : 0n), 0n);
  const they = (rows ?? []).reduce((s, r) => s + (r.balancePaise > 0n ? r.balancePaise : 0n), 0n);
  return (
    <div className="flex flex-col gap-3">
      <NewButton href="/mill/entry/new" label={t("mill.spNewBtn")} testId="sp-new" />
      <SearchBox value={q} onChange={setQ} placeholder={t("common.search")} />
      {rows && rows.length > 0 ? (
        <p
          className="bg-forest-100/60 text-forest tabular rounded-2xl p-3 text-center text-sm"
          data-testid="sp-totals"
        >
          {t("mill.spTotals", { we: money(we), they: money(they) })}
        </p>
      ) : null}
      {rows === undefined ? (
        <Skeleton rows={3} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Users} title={t("mill.spEmpty")} hint={t("mill.spEmptyHint")} />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="sp-list">
          {shown.map((r, i) => (
            <li key={r.party._id}>
              <TxnCard
                index={i}
                icon={Users}
                title={r.party.name}
                subtitle={
                  r.balancePaise < 0n
                    ? t("mill.spBalanceWe")
                    : r.balancePaise > 0n
                      ? t("mill.spBalanceThey")
                      : t("mill.spSettled")
                }
                {...(r.lastDate
                  ? { date: t("mill.last", { date: date(r.lastDate, "short") }) }
                  : {})}
                amountPaise={r.balancePaise < 0n ? -r.balancePaise : r.balancePaise}
                direction={r.balancePaise > 0n ? "IN" : r.balancePaise < 0n ? "OUT" : undefined}
                href={`/mill/party?id=${r.party._id}`}
                testId="sp-row"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

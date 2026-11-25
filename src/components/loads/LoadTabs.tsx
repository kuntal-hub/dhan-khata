"use client";

/**
 * Daily Load Khata tabs (requirement_v2 §12.5): তারিখ অনুযায়ী (the register with daily totals,
 * search, "not linked" filter), পার্টি / মিল / গাড়ি (the same loads grouped, with totals).
 * Unlinked loads carry a "যুক্ত নয়" flag so nothing is silently missed.
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useDeferredValue, useState } from "react";
import { ClipboardList, Link2Off } from "lucide-react";
import { varietyName } from "@/components/entry/Variety";
import { EmptyState, Skeleton, TxnCard } from "@/components/kit/Kit";
import { SearchBox } from "@/components/sales/SalesTabs";
import { useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { groupLoads, loadRows, type LoadGroupBy, type LoadRow } from "@/client/queries/loads";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";

function LoadCard({ r, index }: { r: LoadRow; index: number }) {
  const { t, date, digits } = useI18n();
  const business = useBusiness();
  const qtl = formatWeightNumber(BigInt(r.doc.weight.netG), "QTL", {
    digits,
    monKg: business?.monKg,
  });
  const voided = r.doc.status === "void";
  return (
    <TxnCard
      index={index}
      icon={ClipboardList}
      tone="gold"
      title={`${r.doc.vehicleNumber}${r.from ? ` · ${r.from.name}` : ""}`}
      subtitle={`${varietyName(r.variety, t)} · ${qtl} ${t("ui.unitQtlShort")}${r.mill ? ` → ${r.mill.name}` : ""}`}
      date={`${date(r.doc.transactionDate, "short")} · ${r.doc.number}`}
      amountPaise={BigInt(r.doc.totalPaise)}
      {...(voided ? { status: "VOID" as const } : {})}
      href={`/loads/view?id=${r.doc._id}`}
      testId="load-row"
      extra={
        voided ? null : r.linked ? (
          <span className="text-xs text-emerald-800" data-testid="load-linked">
            {t(`ld.linkedTo${r.linked.type === "SALE" ? "SALE" : "MILL_DISPATCH"}`)}
          </span>
        ) : (
          <span
            className="flex items-center gap-1 rounded-full bg-amber-100 px-2 text-[11px] text-amber-900"
            data-testid="load-unlinked"
          >
            <Link2Off className="size-3" aria-hidden />
            {t("ld.notLinked")}
          </span>
        )
      }
    />
  );
}

function useRows(q: string, unlinked: boolean) {
  const { godownId } = useActiveGodown();
  const dq = useDeferredValue(q);
  return useLiveQuery(
    () => (godownId ? loadRows(godownId, { q: dq, unlinked }) : []),
    [godownId, dq, unlinked],
  );
}

function Toolbar({
  q,
  setQ,
  unlinked,
  setUnlinked,
}: {
  q: string;
  setQ: (v: string) => void;
  unlinked: boolean;
  setUnlinked: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const { readOnly } = useWriteGodown();
  return (
    <>
      {readOnly ? null : (
        <Button asChild className="h-12 self-start">
          <Link href="/loads/new" data-testid="load-new">
            {t("ld.new")}
          </Link>
        </Button>
      )}
      <SearchBox value={q} onChange={setQ} placeholder={t("ld.search")} testId="load-search" />
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={unlinked}
          onClick={() => setUnlinked(!unlinked)}
          data-testid="load-filter-unlinked"
          className={"chip"}
        >
          {t("ld.notLinked")}
        </button>
      </div>
    </>
  );
}

export function LoadGroups({ by }: { by: LoadGroupBy }) {
  const { t, money, date, digits } = useI18n();
  const business = useBusiness();
  const { godownId } = useActiveGodown();
  const [q, setQ] = useState("");
  const [unlinked, setUnlinked] = useState(false);
  const rows = useRows(q, unlinked);
  const parties = useLiveQuery(
    async () =>
      new Map(
        godownId
          ? (await db().parties.where("godownId").equals(godownId).toArray()).map(
              (p) => [p._id, p.name] as const,
            )
          : [],
      ),
    [godownId],
  );
  const groups = rows ? groupLoads(rows, by) : undefined;
  const label = (key: string) =>
    by === "date"
      ? date(key)
      : by === "vehicle"
        ? key
        : key
          ? (parties?.get(key) ?? "")
          : t("ld.none");
  return (
    <div className="flex flex-col gap-3">
      <Toolbar q={q} setQ={setQ} unlinked={unlinked} setUnlinked={setUnlinked} />
      {groups === undefined ? (
        <Skeleton rows={4} />
      ) : groups.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t("ld.empty")} hint={t("ld.emptyHint")} />
      ) : (
        <div className="flex flex-col gap-4" data-testid={`load-groups-${by}`}>
          {groups.map((g) => (
            <section key={g.key} className="flex flex-col gap-2" data-testid="load-group">
              <header className="bg-forest-100/60 text-forest flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-3 py-2 text-sm">
                <span className="font-semibold">{label(g.key)}</span>
                <span
                  className="tabular"
                  data-testid="load-group-total"
                  data-g={g.totalG.toString()}
                >
                  {t("ld.groupTotal", {
                    count: g.rows.filter((r) => r.doc.status === "active").length,
                    qty: formatWeightNumber(g.totalG, "QTL", { digits, monKg: business?.monKg }),
                    amount: money(g.totalPaise),
                  })}
                  {g.unlinked ? ` · ${t("ld.unlinkedCount", { count: g.unlinked })}` : ""}
                </span>
              </header>
              <ul className="flex flex-col gap-2.5">
                {g.rows.map((r, i) => (
                  <li key={r.doc._id}>
                    <LoadCard r={r} index={i} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function LoadRegister() {
  return <LoadGroups by="date" />;
}

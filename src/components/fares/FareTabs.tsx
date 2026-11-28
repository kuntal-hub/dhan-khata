"use client";

/**
 * Purchase → "গাড়ি ভাড়া ও মালিকের হিসাব / Vehicle Fare & Owner Ledger" tab (DECISIONS D56): every
 * vehicle owner of the Gola with jobs, fare earned, paid and outstanding (search by name / mobile).
 * A row opens the owner's ledger.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Search, Truck } from "lucide-react";
import { EmptyState, Skeleton, TxnCard } from "@/components/kit/Kit";
import { useActiveGodown } from "@/client/hooks";
import { vehicleOwnerSummaries } from "@/client/queries/fares";
import { useI18n } from "@/i18n/I18nProvider";
import { matchesSearch } from "@/i18n/translit";

export function VehicleOwnerList() {
  const { t, money, count } = useI18n();
  const { godownId } = useActiveGodown();
  const [q, setQ] = useState("");
  const rows = useLiveQuery(() => (godownId ? vehicleOwnerSummaries(godownId) : []), [godownId]);
  const query = q.trim();
  const shown = (rows ?? []).filter(
    (r) =>
      !query || matchesSearch(r.party.searchKey, query) || (r.party.phone ?? "").includes(query),
  );
  const totals = shown.reduce(
    (a, r) => ({
      earned: a.earned + r.earnedPaise,
      paid: a.paid + r.paidPaise,
      due: a.due + r.outstandingPaise,
    }),
    { earned: 0n, paid: 0n, due: 0n },
  );
  return (
    <div className="flex flex-col gap-3" data-testid="fare-owners">
      <p className="text-muted-foreground text-sm">{t("fare.tabHint")}</p>
      <div className="bg-card shadow-card flex items-center gap-2 rounded-2xl border px-3">
        <Search className="text-muted-foreground size-5" aria-hidden />
        <input
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
          placeholder={t("fare.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("fare.search")}
          data-testid="fare-owner-search"
        />
      </div>
      {shown.length > 0 ? (
        <div
          className="bg-forest-100/60 text-forest grid grid-cols-3 gap-2 rounded-2xl p-3 text-center text-sm"
          data-testid="fare-totals"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-xs">{t("fare.earned")}</span>
            <span className="tabular font-semibold">{money(totals.earned)}</span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-xs">{t("fare.paid")}</span>
            <span className="tabular font-semibold">{money(totals.paid)}</span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-xs">{t("fare.outstanding")}</span>
            <span className="tabular font-semibold text-red-800" data-testid="fare-totals-due">
              {money(totals.due)}
            </span>
          </span>
        </div>
      ) : null}
      {rows === undefined ? (
        <Skeleton rows={4} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Truck} title={t("fare.ownersEmpty")} hint={t("fare.ownersEmptyHint")} />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="fare-owner-list">
          {shown.map((r, i) => (
            <li key={r.party._id}>
              <TxnCard
                index={i}
                icon={Truck}
                tone="blue"
                title={r.party.name}
                subtitle={t("fare.ownerLine", {
                  jobs: count(r.jobs),
                  earned: money(r.earnedPaise),
                  paid: money(r.paidPaise),
                })}
                {...(r.party.phone ? { date: r.party.phone } : {})}
                amountPaise={r.outstandingPaise}
                direction={r.outstandingPaise > 0n ? "OUT" : undefined}
                href={`/purchase/vehicle-owner?id=${r.party._id}`}
                testId="fare-owner-row"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

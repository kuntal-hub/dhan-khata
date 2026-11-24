"use client";

import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useDeferredValue, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState, Loading } from "@/components/lists/common";
import { Money } from "@/components/money/display";
import { PageHeader, PageSuspense } from "@/components/system/page";
import { viewPathOf } from "@/components/vouchers/VoucherView";
import { useActiveGodown } from "@/client/hooks";
import { searchAllGodowns } from "@/client/queries/consolidated";
import { EMPTY_RESULTS, searchGodown, type SearchResults } from "@/client/queries/search";
import { amountOf } from "@/client/ui/amount";
import { partyTitle, vehicleLabel } from "@/client/ui/labels";
import { dot } from "@/client/ui/text";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { useAppSelector } from "@/store";

function Results({
  godownId,
  results,
  open,
}: {
  godownId: string;
  results: SearchResults;
  open: (godownId: string, href: string) => void;
}) {
  const { t, lang, date } = useI18n();
  const row =
    "hover:bg-muted flex min-h-12 w-full items-center justify-between gap-2 border-b px-1 text-left text-sm";
  return (
    <div className="flex flex-col gap-3">
      {results.parties.length > 0 ? (
        <section>
          <h3 className="text-muted-foreground text-xs font-semibold uppercase">
            {t("search.parties")}
          </h3>
          {results.parties.map(({ party }) => {
            const { title, sub } = partyTitle(party, lang);
            return (
              <button
                key={party._id}
                type="button"
                className={row}
                onClick={() => open(godownId, `/party/view?id=${party._id}`)}
                data-testid="search-party"
              >
                <span className="min-w-0 truncate">
                  {dot(title, sub, party.village, party.phone)}
                </span>
              </button>
            );
          })}
        </section>
      ) : null}
      {results.vehicles.length > 0 ? (
        <section>
          <h3 className="text-muted-foreground text-xs font-semibold uppercase">
            {t("search.vehicles")}
          </h3>
          {results.vehicles.map(({ vehicle }) => (
            <button
              key={vehicle._id}
              type="button"
              className={row}
              onClick={() => open(godownId, `/vehicle/view?id=${vehicle._id}`)}
              data-testid="search-vehicle"
            >
              <span>{vehicleLabel(vehicle)}</span>
            </button>
          ))}
        </section>
      ) : null}
      {results.vouchers.length > 0 ? (
        <section>
          <h3 className="text-muted-foreground text-xs font-semibold uppercase">
            {t("search.vouchers")}
          </h3>
          {results.vouchers.map(({ voucher, byAmount }) => (
            <button
              key={voucher._id}
              type="button"
              className={row}
              onClick={() => open(godownId, viewPathOf(voucher))}
              data-testid="search-voucher"
            >
              <span className="flex min-w-0 flex-col">
                <span className={`truncate ${voucher.status === "void" ? "line-through" : ""}`}>
                  {dot(voucher.number, t(`voucherType.${voucher.type}` as TKey))}
                </span>
                <span className="text-muted-foreground text-xs">
                  {dot(date(voucher.date, "short"), byAmount ? t("search.byAmount") : null)}
                </span>
              </span>
              <Money paise={amountOf(voucher)} className="shrink-0" />
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Inner() {
  const { t } = useI18n();
  const router = useRouter();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const { godownId, godowns, select } = useActiveGodown();
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const query = useDeferredValue(q);
  const ids = (godowns ?? []).map((g) => g._id);
  const data = useLiveQuery(async () => {
    if (query.trim().length < 2) return null;
    if (all && isOwner) return { all: await searchAllGodowns(ids, query) };
    if (!godownId) return null;
    return { one: await searchGodown(godownId, query) };
  }, [query, all, isOwner, godownId, ids.join(",")]);

  const open = (g: string, href: string) => {
    if (g !== godownId) select(g);
    router.push(href);
  };
  const empty = (r: SearchResults) =>
    r.parties.length + r.vehicles.length + r.vouchers.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("search.title")} />
      <div className="relative">
        <Search className="text-muted-foreground absolute top-3.5 left-3 size-5" aria-hidden />
        <Input
          autoFocus
          className="h-12 pl-10 text-base"
          value={q}
          placeholder={t("search.hint")}
          aria-label={t("search.title")}
          onChange={(e) => setQ(e.target.value)}
          data-testid="search-input"
        />
      </div>
      {isOwner && ids.length > 1 ? (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
            data-testid="search-all"
          />
          {t("search.allGodowns")}
        </label>
      ) : null}
      {q.trim().length < 2 ? (
        <p className="text-muted-foreground text-sm">{t("search.typeMore")}</p>
      ) : data === undefined ? (
        <Loading />
      ) : data === null ? null : "all" in data && data.all ? (
        data.all.length === 0 ? (
          <EmptyState text={t("search.none")} />
        ) : (
          data.all.map((grp) => (
            <section key={grp.godownId} className="flex flex-col gap-1" data-testid="search-group">
              <h2 className="text-base font-semibold">
                {godowns?.find((g) => g._id === grp.godownId)?.name ?? ""}
              </h2>
              <Results godownId={grp.godownId} results={grp.results} open={open} />
            </section>
          ))
        )
      ) : "one" in data && data.one && godownId ? (
        empty(data.one) ? (
          <EmptyState text={t("search.none")} />
        ) : (
          <Results godownId={godownId} results={data.one ?? EMPTY_RESULTS} open={open} />
        )
      ) : null}
    </div>
  );
}

/** Global search (spec §9.15), offline over the device DB. */
export default function SearchPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

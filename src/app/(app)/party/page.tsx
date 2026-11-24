"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Plus, Search, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Balance } from "@/components/money/display";
import { EmptyState, Loading, SyncIcon } from "@/components/lists/common";
import { VirtualList } from "@/components/lists/VirtualList";
import { PageHeader, ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { useActiveGodown } from "@/client/hooks";
import { partyBalances, searchParties } from "@/client/queries/parties";
import { partyTitle } from "@/client/ui/labels";
import { PartyRoleSchema, type PartyRole } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

const ROLES = PartyRoleSchema.options;

/** Party list of the active godown (spec §9.12): role chips, cross-script search, recent first. */
export default function PartyListPage() {
  const { t, lang } = useI18n();
  const { godownId } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<PartyRole | undefined>(undefined);
  const data = useLiveQuery(async () => {
    if (!godownId) return null;
    const [list, balances] = await Promise.all([
      searchParties(godownId, q, role),
      partyBalances(godownId),
    ]);
    return { list, balances };
  }, [godownId, q, role]);
  if (!godownId) return <ReadOnlyNotice reason="noGodown" />;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t("party.title")}
        actions={
          <Button asChild variant="outline" className="h-11">
            <Link href="/due" data-testid="go-due">
              <Wallet className="size-4" aria-hidden />
              {t("due.title")}
            </Link>
          </Button>
        }
      />
      <div className="relative">
        <Search
          className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          className="h-12 pl-9 text-base"
          placeholder={t("party.searchHint")}
          aria-label={t("common.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="party-search"
        />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t("party.roles")}>
        <button
          type="button"
          aria-pressed={!role}
          onClick={() => setRole(undefined)}
          className={`min-h-11 shrink-0 rounded-full border px-3 text-sm ${!role ? "bg-primary text-primary-foreground" : ""}`}
        >
          {t("common.all")}
        </button>
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={role === r}
            onClick={() => setRole(role === r ? undefined : r)}
            className={`min-h-11 shrink-0 rounded-full border px-3 text-sm ${role === r ? "bg-primary text-primary-foreground" : ""}`}
          >
            {t(`partyRole.${r}` as TKey)}
          </button>
        ))}
      </div>
      {!readOnly ? (
        <Button asChild className="h-11 self-start">
          <Link href="/party/new" data-testid="party-new">
            <Plus className="size-4" aria-hidden />
            {t("party.new")}
          </Link>
        </Button>
      ) : null}
      {!data ? (
        <Loading />
      ) : data.list.length === 0 ? (
        <EmptyState text={t("party.empty")} />
      ) : (
        <VirtualList
          items={data.list}
          getKey={(p) => p._id}
          testId="party-list"
          render={(p) => {
            const { title, sub } = partyTitle(p, lang);
            return (
              <Link
                href={`/party/view?id=${p._id}`}
                className="hover:bg-muted flex min-h-16 items-center gap-3 border-b px-1 py-2"
                data-testid="party-row"
              >
                <SyncIcon
                  entityId={p._id}
                  {...(p.serverSeq !== undefined ? { serverSeq: p.serverSeq } : {})}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{title}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {[
                      sub,
                      p.village,
                      p.phone,
                      p.roles.map((r) => t(`partyRole.${r}` as TKey)).join(", "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <Balance paise={data.balances.get(p._id) ?? 0n} />
              </Link>
            );
          }}
        />
      )}
    </div>
  );
}

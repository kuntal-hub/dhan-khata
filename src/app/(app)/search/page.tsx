"use client";

/**
 * Global search (requirement_v2 §11 header): parties (name in either script, mobile) and entries
 * (number, party, vehicle number, amount in rupees) of the active Gola(s), on the device. Each
 * result opens its party ledger or the entry's detail page.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useDeferredValue, useState } from "react";
import { FileText, Search as SearchIcon, Users } from "lucide-react";
import { docPath } from "@/components/entry/docPath";
import { docTitle } from "@/components/entry/docLabel";
import { EmptyState, TxnCard } from "@/components/kit/Kit";
import { useReportScope } from "@/components/reports/ReportView";
import { PageTitle } from "@/components/shell/PageTitle";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { db } from "@/client/db/dexie";
import { partyIdOf } from "@/client/queries/dashboard";
import { businessDate, type Doc, type Party } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { matchesSearch } from "@/i18n/translit";

function amountOf(d: Doc): bigint | undefined {
  const x = d as {
    totalPaise?: string;
    amountPaise?: string;
    totalValuePaise?: string;
    totalIncomePaise?: string;
  };
  const v = x.totalPaise ?? x.amountPaise ?? x.totalValuePaise ?? x.totalIncomePaise;
  return v !== undefined ? BigInt(v) : undefined;
}

export default function SearchPage() {
  const { t, date } = useI18n();
  const scope = useReportScope();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const data = useLiveQuery(async () => {
    if (dq.length < 2) return null;
    const lower = dq.toLowerCase();
    const digits = dq.replace(/[^0-9]/g, "");
    const parties: Party[] = [];
    const docs: Array<{ doc: Doc; party?: Party }> = [];
    for (const id of scope.ids) {
      const ps = await db().parties.where("godownId").equals(id).toArray();
      const byId = new Map(ps.map((p) => [p._id, p] as const));
      parties.push(
        ...ps.filter(
          (p) =>
            p.status === "active" &&
            (matchesSearch(p.searchKey, dq) ||
              (digits.length >= 4 && (p.phone ?? "").includes(digits))),
        ),
      );
      const vs = await db().vouchers.where("godownId").equals(id).toArray();
      for (const d of vs) {
        if (d.type === "DAY_CLOSE") continue;
        const pid = partyIdOf(d);
        const party = pid ? byId.get(pid) : undefined;
        const vehicle = (d as { vehicleNumber?: string }).vehicleNumber ?? "";
        const amt = amountOf(d);
        const hit =
          d.number.toLowerCase().includes(lower) ||
          (party && matchesSearch(party.searchKey, dq)) ||
          (vehicle && vehicle.toLowerCase().includes(lower.replace(/\s+/g, ""))) ||
          (digits.length >= 3 && amt !== undefined && (amt / 100n).toString().startsWith(digits));
        if (hit) docs.push({ doc: d, ...(party ? { party } : {}) });
      }
    }
    docs.sort((a, b) => (a.doc.createdAt < b.doc.createdAt ? 1 : -1));
    return { parties: parties.slice(0, 20), docs: docs.slice(0, 50) };
  }, [dq, scope.ids.join(",")]);

  return (
    <div className="flex flex-col gap-4" data-testid="search">
      <PageTitle title={t("search.title")} back="/" />
      <div className="bg-card shadow-card flex items-center gap-2 rounded-2xl border px-3">
        <SearchIcon className="text-muted-foreground size-5" aria-hidden />
        <input
          autoFocus
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="search-input"
        />
        <VoiceButton mode="text" onText={setQ} testId="search-input" />
      </div>
      {data === null || data === undefined ? (
        <p className="text-muted-foreground text-sm">{t("search.hint")}</p>
      ) : data.parties.length + data.docs.length === 0 ? (
        <EmptyState icon={SearchIcon} title={t("search.none")} />
      ) : (
        <>
          {data.parties.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-[15px] font-semibold">{t("search.parties")}</h2>
              <ul className="flex flex-col gap-2" data-testid="search-parties">
                {data.parties.map((p, i) => (
                  <li key={p._id}>
                    <TxnCard
                      index={i}
                      icon={Users}
                      title={p.name}
                      subtitle={[p.phone, scope.ids.length > 1 ? scope.name(p.godownId) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                      href={`/dues/party?id=${p._id}`}
                      testId="search-party"
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.docs.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-[15px] font-semibold">{t("search.entries")}</h2>
              <ul className="flex flex-col gap-2" data-testid="search-docs">
                {data.docs.map(({ doc, party }, i) => {
                  const title = docTitle(doc, t, party?.name);
                  const href = docPath(doc);
                  const amt = amountOf(doc);
                  return (
                    <li key={doc._id}>
                      <TxnCard
                        index={i}
                        icon={FileText}
                        tone="gold"
                        title={title.title}
                        subtitle={`${t(`voucherType.${doc.type}` as TKey)} · ${doc.number}`}
                        date={date(businessDate(doc), "short")}
                        {...(amt !== undefined ? { amountPaise: amt } : {})}
                        {...(doc.status === "void" ? { status: "VOID" as const } : {})}
                        {...(href ? { href } : {})}
                        testId="search-doc"
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

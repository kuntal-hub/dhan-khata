"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Loading } from "@/components/lists/common";
import { PrintFrame, type ReceiptLang } from "@/components/print/PrintFrame";
import { Letterhead } from "@/components/print/Receipt";
import { PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { paren, spaced } from "@/client/ui/text";
import { partyStatement, type Statement } from "@/client/queries/parties";
import { formatDate, formatMoney } from "@/i18n/format";
import type { Lang, TKey } from "@/i18n/translate";
import { translate } from "@/i18n/translateAll";
import type { Godown, Party } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";

function signed(p: bigint, lang: Lang): string {
  const prefs = { digits: lang } as const;
  if (p === 0n) return formatMoney(0n, prefs);
  return `${formatMoney(p > 0n ? p : -p, prefs)} ${translate(lang, p > 0n ? "due.receivableShort" : "due.payableShort")}`;
}

function StatementBody({
  godown,
  party,
  st,
  lang,
  from,
  to,
}: {
  godown: Godown;
  party: Party;
  st: Statement;
  lang: Lang;
  from?: string;
  to?: string;
}) {
  const t = (k: TKey, vars?: Record<string, string>) => translate(lang, k, vars);
  const d = (x: string) => formatDate(x, { lang, digits: lang }, "short");
  const m = (p: bigint) => formatMoney(p, { digits: lang });
  return (
    <div className="flex flex-col gap-2" lang={lang}>
      <Letterhead godown={godown} lang={lang} />
      <div className="text-center font-semibold">{t("receipt.statementTitle")}</div>
      <div className="text-sm">
        {t("receipt.partyLine", {
          name: party.village ? spaced(party.name, paren(party.village)) : party.name,
        })}
      </div>
      {from || to ? (
        <div className="text-xs">
          {t("receipt.period", { from: from ? d(from) : "—", to: to ? d(to) : "—" })}
        </div>
      ) : null}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="py-1 text-left">{t("common.date")}</th>
            <th className="py-1 text-left">{t("party.voucher")}</th>
            <th className="py-1 text-right">{t("party.debit")}</th>
            <th className="py-1 text-right">{t("party.credit")}</th>
            <th className="py-1 text-right">{t("party.runningBalance")}</th>
          </tr>
        </thead>
        <tbody className="tabular">
          <tr className="border-b">
            <td className="py-1" colSpan={4}>
              {t("party.opening")}
            </td>
            <td className="py-1 text-right">{signed(st.openingPaise, lang)}</td>
          </tr>
          {st.rows.map((r) => (
            <tr key={r.voucherId} className="border-b">
              <td className="py-1">{d(r.date)}</td>
              <td className="py-1">{spaced(t(`voucherType.${r.type}` as TKey), r.number)}</td>
              <td className="py-1 text-right">{r.debitPaise > 0n ? m(r.debitPaise) : ""}</td>
              <td className="py-1 text-right">{r.creditPaise > 0n ? m(r.creditPaise) : ""}</td>
              <td className="py-1 text-right">{signed(r.balancePaise, lang)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="py-1" colSpan={4}>
              {t("party.closing")}
            </td>
            <td className="py-1 text-right" data-testid={`statement-closing-${lang}`}>
              {signed(st.closingPaise, lang)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Inner() {
  const { t } = useI18n();
  const partyId = useParam("partyId");
  const from = useParam("from");
  const to = useParam("to");
  const data = useLiveQuery(async () => {
    if (!partyId) return null;
    const party = await db().parties.get(partyId);
    if (!party) return null;
    const godown = await db().godowns.get(party.godownId);
    if (!godown) return null;
    const st = await partyStatement(party.godownId, partyId, {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    return { party, godown, st };
  }, [partyId, from, to]);
  const [lang, setLang] = useState<ReceiptLang | null>(null);
  if (data === undefined) return <Loading />;
  if (!data) return <ReadOnlyNotice reason="notFound" />;
  const l = lang ?? data.godown.receiptLanguage;
  const body = (x: Lang) => (
    <StatementBody
      godown={data.godown}
      party={data.party}
      st={data.st}
      lang={x}
      {...(from ? { from } : {})}
      {...(to ? { to } : {})}
    />
  );
  return (
    <PrintFrame
      title={`${t("receipt.statementTitle")} · ${data.party.name}`}
      filename={`khata-${data.party.name}`}
      receiptLang={l}
      onReceiptLang={setLang}
    >
      {l === "both" ? (
        <div className="grid grid-cols-2 gap-4">
          {body("bn")}
          {body("en")}
        </div>
      ) : (
        body(l)
      )}
    </PrintFrame>
  );
}

/** Party khata statement print / share (spec §9.6). */
export default function PrintStatementPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

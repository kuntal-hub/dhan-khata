"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Loading } from "@/components/lists/common";
import { PrintFrame, type ReceiptLang } from "@/components/print/PrintFrame";
import { Letterhead } from "@/components/print/Receipt";
import { ReportTables, useReportLabels } from "@/components/reports/ReportTables";
import { PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { useActiveGodown } from "@/client/hooks";
import { reportById } from "@/client/reports/registry";
import { dot } from "@/client/ui/text";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

/** Printable report with the godown letterhead (spec §9.14): HTML print / share as image. */
function Inner() {
  const { t, date } = useI18n();
  const def = reportById(useParam("r"));
  const from = useParam("from") ?? "";
  const to = useParam("to") ?? "";
  const party = useParam("party");
  const account = useParam("account") ?? "CASH";
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const { godownId, godown, godowns, canConsolidate } = useActiveGodown();
  const labels = useReportLabels(godownId);
  const [lang, setLang] = useState<ReceiptLang | null>(null);
  const ids = (godowns ?? []).filter((g) => g.status === "active").map((g) => g._id);
  const model = useLiveQuery(async () => {
    if (!def || !labels || !to) return null;
    return def.build({
      godownId: godownId ?? ids[0] ?? "",
      godownIds: ids,
      from,
      to,
      ...(party ? { partyId: party } : {}),
      account,
      labels,
    });
  }, [def?.id, godownId, from, to, party, account, labels === undefined, ids.join(",")]);
  if (!def) return <ReadOnlyNotice reason="notFound" />;
  if ((def.ownerOnly && !isOwner) || (def.consolidated && !canConsolidate)) {
    return <ReadOnlyNotice reason="viewer" />;
  }
  if (model === undefined || !godown) return <Loading />;
  const l = lang ?? godown.receiptLanguage;
  const title = t(def.title);
  return (
    <PrintFrame title={title} filename={def.id} receiptLang={l} onReceiptLang={setLang}>
      <div className="flex flex-col gap-2 bg-white text-black">
        {def.consolidated ? null : <Letterhead godown={godown} lang={l === "both" ? "bn" : l} />}
        <div className="text-center font-semibold">{title}</div>
        <div className="text-center text-xs">
          {dot(
            def.consolidated ? t("reports.allGodowns") : null,
            from
              ? t("reports.period", { from: date(from, "short"), to: date(to, "short") })
              : t("reports.asOf", { date: date(to, "short") }),
          )}
        </div>
        {model ? (
          <>
            {model.notes?.map((n, i) => (
              <p key={i} className="text-xs">
                {n.text}
              </p>
            ))}
            <ReportTables model={model} compact />
          </>
        ) : null}
      </div>
    </PrintFrame>
  );
}

export default function PrintReportPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

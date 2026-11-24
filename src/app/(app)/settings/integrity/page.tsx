"use client";

import { useState } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/money/display";
import { PageHeader, ReadOnlyNotice } from "@/components/system/page";
import { useReportLabels } from "@/components/reports/ReportTables";
import { runIntegrity, type IntegrityReport } from "@/client/admin";
import { QUICK_INTEGRITY_KEY, type QuickIntegrity } from "@/client/diagnostics";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useMeta, useOutbox } from "@/client/hooks";
import { accountLabel } from "@/client/reports/defs";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

function Line({
  ok,
  label,
  detail,
  testId,
}: {
  ok: boolean;
  label: string;
  detail: string;
  testId: string;
}) {
  return (
    <div
      className="flex items-start gap-2 border-t py-2 first:border-t-0"
      data-testid={testId}
      data-ok={ok}
    >
      {ok ? (
        <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <ShieldAlert className="text-destructive size-5 shrink-0" aria-hidden />
      )}
      <div className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span className={ok ? "text-muted-foreground text-xs" : "text-destructive text-xs"}>
          {detail}
        </span>
      </div>
    </div>
  );
}

/** হিসাব যাচাই (spec §6.6): device checks + comparison with the server (owner). */
export default function IntegrityPage() {
  const { t } = useI18n();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const { godownId, godown } = useActiveGodown();
  const labels = useReportLabels(godownId);
  const quick = useMeta<QuickIntegrity>(QUICK_INTEGRITY_KEY);
  const outbox = useOutbox();
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [busy, setBusy] = useState(false);
  if (!isOwner) return <ReadOnlyNotice reason="viewer" />;
  if (!godownId) return <ReadOnlyNotice reason="noGodown" />;
  const run = async (compareServer: boolean) => {
    setBusy(true);
    try {
      setReport(await runIntegrity(godownId, { compareServer }));
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  const pendingHere = (outbox ?? []).filter((o) => o.godownId === godownId).length;
  return (
    <div className="flex flex-col gap-3" data-testid="integrity">
      <PageHeader title={`${t("integrity.title")} · ${godown?.name ?? ""}`} />
      {quick ? (
        <p className="text-muted-foreground text-xs">
          {t("integrity.lastQuick", { date: new Date(quick.at).toLocaleString() })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-11"
          disabled={busy}
          onClick={() => void run(false)}
          data-testid="integrity-run"
        >
          {t("integrity.run")}
        </Button>
        <Button
          variant="outline"
          className="h-11"
          disabled={busy || pendingHere > 0}
          onClick={() => void run(true)}
          data-testid="integrity-server"
        >
          {t("integrity.server")}
        </Button>
      </div>
      {pendingHere > 0 ? (
        <p className="text-muted-foreground text-xs">{t("integrity.needSync")}</p>
      ) : null}
      {report ? (
        <Card>
          <CardContent className="flex flex-col pt-4 text-sm">
            <Line
              ok={report.trial.balanced}
              label={t("integrity.trial")}
              detail={report.trial.balanced ? t("integrity.ok") : t("integrity.bad")}
              testId="integrity-trial"
            />
            <Line
              ok={report.repostMismatches.length === 0}
              label={t("integrity.repost")}
              detail={
                report.repostMismatches.length === 0
                  ? t("integrity.ok")
                  : t("integrity.repostBad", { count: report.repostMismatches.length })
              }
              testId="integrity-repost"
            />
            <Line
              ok={report.staleOps === 0}
              label={t("integrity.outbox")}
              detail={
                report.staleOps === 0
                  ? t("integrity.ok")
                  : t("integrity.outboxBad", { count: report.staleOps })
              }
              testId="integrity-outbox"
            />
            {report.server ? (
              report.server.diffs.length === 0 &&
              report.server.serverRepostMismatches.length === 0 ? (
                <p
                  className="border-t pt-2 font-semibold text-emerald-700 dark:text-emerald-400"
                  data-testid="integrity-server-ok"
                >
                  {t("integrity.serverOk")}
                </p>
              ) : (
                <div
                  className="flex flex-col gap-1 border-t pt-2"
                  data-testid="integrity-server-diff"
                >
                  <span className="text-destructive font-semibold">
                    {t("integrity.serverDiff")}
                  </span>
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left" />
                        <th className="text-right">{t("integrity.device")}</th>
                        <th className="text-right">{t("integrity.serverCol")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.server.diffs.map((d) => (
                        <tr key={d.account} className="border-t">
                          <td className="py-1">
                            {labels ? accountLabel(d.account, labels) : d.account}
                          </td>
                          <td className="text-right">
                            <Money paise={d.devicePaise} />
                          </td>
                          <td className="text-right">
                            <Money paise={d.serverPaise} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

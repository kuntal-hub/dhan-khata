"use client";

/**
 * Printable report (requirement_v2 §13): the same model as on screen, without app chrome; A4 or
 * 80 mm thermal layout; Print (→ PDF via the browser's "Save as PDF"), Excel, CSV, share image.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Segmented } from "@/components/entry/Fields";
import { Loading } from "@/components/lists/common";
import {
  ReportActions,
  ReportDoc,
  useReportModel,
  type ReportParams,
} from "@/components/reports/ReportView";
import { PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { reportById } from "@/client/reports/defs";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";

function PrintReport() {
  const { t } = useI18n();
  const router = useRouter();
  const def = reportById(useParam("r") ?? "");
  const today = todayIST();
  const p: ReportParams = {
    id: def?.id ?? "",
    from: useParam("from") ?? today,
    to: useParam("to") ?? today,
    opt: useParam("opt") ?? "",
  };
  const model = useReportModel(def, p);
  const [paper, setPaper] = useState<"A4" | "80">("A4");
  const ref = useRef<HTMLDivElement>(null);
  if (!def) return <ReadOnlyNotice reason="notFound" />;
  if (model === undefined) return <Loading />;
  return (
    <div className="bg-background min-h-dvh p-3 sm:p-8" data-testid="print-report">
      <div className="no-print mx-auto mb-3 flex max-w-4xl flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-11" onClick={() => router.back()}>
            <ArrowLeft className="size-5" aria-hidden />
            {t("rcpt.back")}
          </Button>
          <div className="w-48">
            <Segmented
              label={t("rep.paper")}
              value={paper}
              options={[
                ["A4", t("rep.a4")],
                ["80", t("rep.mm80")],
              ]}
              onChange={setPaper}
              testId="report-paper"
            />
          </div>
        </div>
        <ReportActions def={def} p={p} model={model} docRef={ref} />
      </div>
      <div className="mx-auto max-w-4xl">
        <ReportDoc def={def} p={p} model={model} docRef={ref} narrow={paper === "80"} />
      </div>
    </div>
  );
}

export default function PrintReportPage() {
  return (
    <PageSuspense>
      <PrintReport />
    </PageSuspense>
  );
}

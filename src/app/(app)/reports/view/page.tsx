"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { FileSpreadsheet, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Choice, DateField } from "@/components/forms/fields";
import { PartyPicker } from "@/components/forms/pickers";
import { EmptyState, Loading } from "@/components/lists/common";
import { ReportTables, modelToSheets, useReportLabels } from "@/components/reports/ReportTables";
import { PageHeader, PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { useGodownSettings } from "@/components/trade/hooks";
import { db } from "@/client/db/dexie";
import { downloadWorkbook } from "@/client/export/excel";
import { useActiveGodown } from "@/client/hooks";
import { PRESETS, presetRange, reportQuery, type Preset } from "@/client/reports/model";
import { reportById } from "@/client/reports/registry";
import { bankLabel } from "@/client/ui/labels";
import { dot } from "@/client/ui/text";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

const ReportChart = dynamic(() => import("@/components/reports/ReportChart"), { ssr: false });

function Inner() {
  const { t, date } = useI18n();
  const router = useRouter();
  const id = useParam("r");
  const def = reportById(id);
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const { godownId, godown, godowns, canConsolidate } = useActiveGodown();
  const settings = useGodownSettings(godownId);
  const labels = useReportLabels(godownId);
  const today = todayIST();
  const [preset, setPreset] = useState<Preset>(def?.id === "dayBook" ? "today" : "month");
  const initial = presetRange(preset, today, settings?.seasonMap);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [partyId, setPartyId] = useState<string | undefined>(useParam("party"));
  const [account, setAccount] = useState("CASH");
  const [sharing, setSharing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const banks = useLiveQuery(
    async () => (godownId ? db().bankAccounts.where("godownId").equals(godownId).toArray() : []),
    [godownId],
  );
  const ids = (godowns ?? []).filter((g) => g.status === "active").map((g) => g._id);
  const model = useLiveQuery(async () => {
    if (!def || !labels || (!godownId && !def.consolidated)) return null;
    return def.build({
      godownId: godownId ?? ids[0] ?? "",
      godownIds: ids,
      from: def.asOf ? "" : from,
      to,
      ...(partyId ? { partyId } : {}),
      account,
      labels,
    });
  }, [def?.id, godownId, from, to, partyId, account, labels === undefined, ids.join(",")]);

  if (!def) return <ReadOnlyNotice reason="notFound" />;
  if ((def.ownerOnly && !isOwner) || (def.consolidated && !canConsolidate)) {
    return <ReadOnlyNotice reason="viewer" />;
  }
  const title = t(def.title);
  const scope = def.consolidated ? t("reports.allGodowns") : (godown?.name ?? "");
  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") {
      const r = presetRange(p, today, settings?.seasonMap);
      setFrom(r.from);
      setTo(r.to);
    }
  };
  const excel = async () => {
    if (!model) return;
    try {
      await downloadWorkbook(`${def.id}-${from || to}-${to}.xlsx`, modelToSheets(model, title));
    } catch {
      toast.error(t("errors.generic"));
    }
  };
  const share = async () => {
    if (!ref.current) return;
    setSharing(true);
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(ref.current, { pixelRatio: 2, backgroundColor: "#ffffff" });
      if (!blob) throw new Error("no image");
      const file = new File([blob], `${def.id}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) await nav.share({ files: [file], title });
      else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error(t("errors.generic"));
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="report-view" data-report={def.id}>
      <PageHeader title={title} />
      {!def.asOf ? (
        <Choice
          value={preset}
          wrap
          onChange={choosePreset}
          options={PRESETS.map((p) => ({ value: p, label: t(`reports.preset.${p}`) }))}
          testId="report-preset"
        />
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {!def.asOf ? (
          <DateField
            label={t("filters.from")}
            value={from}
            max={to}
            onChange={(v) => {
              if (!v) return;
              setPreset("custom");
              setFrom(v);
            }}
            testId="report-from"
          />
        ) : null}
        <DateField
          label={def.asOf ? t("common.date") : t("filters.to")}
          value={to}
          max={today}
          onChange={(v) => {
            if (!v) return;
            setPreset("custom");
            setTo(v);
          }}
          testId="report-to"
        />
      </div>
      {def.needs === "party" && godownId ? (
        <PartyPicker
          godownId={godownId}
          label={t("reports.filter.party")}
          value={partyId}
          onChange={setPartyId}
          testId="report-party"
        />
      ) : null}
      {def.needs === "account" ? (
        <label className="flex flex-col gap-1 text-sm">
          {t("reports.filter.account")}
          <select
            className="border-input h-12 rounded-md border px-2 text-base"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            data-testid="report-account"
          >
            <option value="CASH">{t("reports.filter.cash")}</option>
            {(banks ?? []).map((b) => (
              <option key={b._id} value={`BANK:${b._id}`}>
                {bankLabel(b)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-11"
          disabled={!model}
          onClick={() =>
            router.push(
              `/print/report?${reportQuery({ r: def.id, from: def.asOf ? "" : from, to, party: partyId, account })}`,
            )
          }
          data-testid="report-print"
        >
          <Printer className="size-4" aria-hidden />
          {t("reports.print")}
        </Button>
        <Button
          variant="outline"
          className="h-11"
          disabled={!model}
          onClick={() => void excel()}
          data-testid="report-excel"
        >
          <FileSpreadsheet className="size-4" aria-hidden />
          {t("reports.excel")}
        </Button>
        <Button
          variant="outline"
          className="h-11"
          disabled={!model || sharing}
          onClick={() => void share()}
        >
          <Share2 className="size-4" aria-hidden />
          {t("reports.share")}
        </Button>
      </div>
      <div ref={ref} className="bg-background flex flex-col gap-3 p-1">
        <p className="text-muted-foreground text-sm">
          {dot(
            scope,
            def.asOf
              ? t("reports.asOf", { date: date(to, "short") })
              : t("reports.period", { from: date(from, "short"), to: date(to, "short") }),
          )}
        </p>
        {model === undefined ? (
          <Loading />
        ) : model === null ? null : (
          <>
            {model.notes?.map((n, i) => (
              <p
                key={i}
                className={`rounded-md border p-2 text-sm ${n.tone === "warn" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
                data-testid="report-note"
              >
                {n.text}
              </p>
            ))}
            {model.tables.length > 0 && model.tables.every((tb) => tb.rows.length === 0) ? (
              <EmptyState text={t("reports.empty")} />
            ) : null}
            {model.chart ? <ReportChart chart={model.chart} /> : null}
            <ReportTables model={model} />
          </>
        )}
      </div>
    </div>
  );
}

/** One report: `?r=<id>` (date presets, filters, print, Excel, share as image). */
export default function ReportViewPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}

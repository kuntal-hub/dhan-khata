"use client";

/**
 * Reports (requirement_v2 §13): the section's রিপোর্ট tab and the print page share this.
 *  - ReportsTab: pick a report, date preset (আজ / গতকাল / এই সপ্তাহ / এই মাস / custom) or one
 *    date, the report's own filter, then the report with Print, Excel (.xlsx), CSV and
 *    share-as-image.
 *  - ReportDoc: header (business name + logo, Gola or "সব গোলা", period, generated at), table
 *    with a sticky first column and totals row, optional chart, note, empty state.
 * Everything is read from the device (works offline); labels follow the current language.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState, type RefObject } from "react";
import { FileSpreadsheet, FileText, Image as ImageIcon, Printer } from "lucide-react";
import { PartyPicker } from "@/components/entry/Fields";
import { rangeOf, type Preset } from "@/components/dashboard/range";
import { EmptyState, Skeleton } from "@/components/kit/Kit";
import { lazyToast } from "@/components/system/IdleToaster";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { downloadWorkbook } from "@/client/export/excel";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { reportById, reportsOf, type ReportDef, type ReportSection } from "@/client/reports/defs";
import { modelToCsv, type CellValue, type ReportModel } from "@/client/reports/model";
import { excelCell, runReport } from "@/client/reports/run";
import { todayIST } from "@/domain/dates";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

const ReportChart = dynamic(() => import("./ReportChart"), { ssr: false });

const PRESETS: readonly Preset[] = ["today", "yesterday", "week", "month", "custom"];

export interface ReportParams {
  id: string;
  from: string;
  to: string;
  opt: string;
}

/** The scope (Golas) of the active view and a name lookup. */
export function useReportScope() {
  const { godownId, godowns, consolidated } = useActiveGodown();
  const active = (godowns ?? []).filter((g) => g.status === "active");
  const ids = consolidated ? active.map((g) => g._id) : godownId ? [godownId] : [];
  const name = (id: string) => (godowns ?? []).find((g) => g._id === id)?.name ?? "";
  return { ids, name, consolidated: !!consolidated, godownId };
}

export function useReportModel(def: ReportDef | undefined, p: ReportParams) {
  const { t } = useI18n();
  const scope = useReportScope();
  return useLiveQuery(
    () =>
      def && scope.ids.length
        ? runReport(def, {
            godownIds: scope.ids,
            golaName: scope.name,
            from: p.from,
            to: p.to,
            ...(p.opt ? { opt: p.opt } : {}),
            t,
          })
        : undefined,
    [def?.id, scope.ids.join(","), p.from, p.to, p.opt, t],
  );
}

function useCell() {
  const { money, date, count, digits } = useI18n();
  const business = useBusiness();
  return (v: CellValue): string => {
    if (v === null) return "";
    if (typeof v === "string") return v;
    if ("m" in v) return money(v.m);
    if ("q" in v) return formatWeightNumber(v.q, "QTL", { digits, monKg: business?.monKg });
    if ("n" in v) return count(v.n);
    return date(v.d, "short");
  };
}

function periodText(
  def: ReportDef,
  p: ReportParams,
  date: (d: string, s?: "long" | "short") => string,
  t: (k: TKey, v?: Record<string, string | number>) => string,
) {
  if (def.period === "none") return t("rep.asOfToday", { date: date(todayIST(), "short") });
  if (def.period === "date") return date(p.to, "short");
  return p.from === p.to
    ? date(p.from, "short")
    : `${date(p.from, "short")} – ${date(p.to, "short")}`;
}

export function ReportDoc({
  def,
  p,
  model,
  docRef,
  narrow = false,
}: {
  def: ReportDef;
  p: ReportParams;
  model: ReportModel;
  docRef?: RefObject<HTMLDivElement | null>;
  narrow?: boolean;
}) {
  const { t, date, digits } = useI18n();
  const business = useBusiness();
  const scope = useReportScope();
  const cell = useCell();
  const gola = scope.consolidated || def.business ? t("gola.all") : scope.name(scope.ids[0] ?? "");
  const now = new Intl.DateTimeFormat(digits === "bn" ? "bn-IN" : "en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return (
    <div
      ref={docRef}
      className={cn("print-sheet bg-card rounded-2xl border p-4", narrow && "report-80mm")}
      data-testid="report-doc"
      data-report={def.id}
    >
      <header className="mb-3 flex items-start gap-3 border-b pb-3">
        {business?.logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL from the device
          <img src={business.logoDataUrl} alt="" className="size-12 rounded-lg object-contain" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-sm">{business?.name ?? ""}</p>
          <h2 className="text-lg font-semibold">{t(def.title)}</h2>
          <p className="text-muted-foreground text-xs" data-testid="report-meta">
            {gola} · {periodText(def, p, date, t)} ·{" "}
            {t("rep.generatedAt", { date: date(todayIST(), "short"), time: now })}
          </p>
        </div>
      </header>
      {model.rows.length === 0 ? (
        <EmptyState icon={FileText} title={model.note ?? t("rep.empty")} testId="report-empty" />
      ) : (
        <>
          {model.chart && model.chart.labels.length > 1 ? (
            <div className="no-print mb-3">
              <ReportChart labels={model.chart.labels} series={model.chart.series} />
            </div>
          ) : null}
          {narrow ? (
            // 80 mm thermal paper: one block per row, "label: value" lines (no wide table).
            <div className="flex flex-col divide-y" data-testid="report-table">
              {[...model.rows, ...(model.totals ? [model.totals] : [])].map((r, i) => (
                <dl
                  key={i}
                  className={cn("py-1.5", i === model.rows.length && "font-semibold")}
                  data-testid={i === model.rows.length ? "report-totals" : "report-row"}
                >
                  {r.map((v, j) =>
                    v === null || v === "" ? null : (
                      <div key={j} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{model.columns[j]?.label}</dt>
                        <dd className="tabular text-right">{cell(v)}</dd>
                      </div>
                    ),
                  )}
                </dl>
              ))}
            </div>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full text-sm" data-testid="report-table">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    {model.columns.map((c, i) => (
                      <th
                        key={i}
                        className={cn(
                          "bg-card px-1.5 py-2 font-normal whitespace-nowrap",
                          i === 0 && "sticky left-0",
                          c.kind === "text" || c.kind === "date" ? "text-left" : "text-right",
                        )}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {model.rows.map((r, i) => (
                    <tr key={i} data-testid="report-row">
                      {r.map((v, j) => (
                        <td
                          key={j}
                          className={cn(
                            "bg-card px-1.5 py-1.5",
                            j === 0 && "sticky left-0",
                            model.columns[j]?.kind === "text" || model.columns[j]?.kind === "date"
                              ? "text-left"
                              : "tabular text-right whitespace-nowrap",
                          )}
                        >
                          {cell(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {model.totals ? (
                  <tfoot>
                    <tr className="border-t-2 font-semibold" data-testid="report-totals">
                      {model.totals.map((v, j) => (
                        <td
                          key={j}
                          className={cn(
                            "bg-card px-1.5 py-2",
                            j === 0 && "sticky left-0",
                            j === 0 ? "text-left" : "tabular text-right whitespace-nowrap",
                          )}
                          data-raw={
                            v && typeof v === "object" && "m" in v ? v.m.toString() : undefined
                          }
                        >
                          {cell(v)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          )}
          {model.note ? <p className="text-muted-foreground mt-2 text-xs">{model.note}</p> : null}
        </>
      )}
    </div>
  );
}

function slug(s: string) {
  return s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

export function ReportActions({
  def,
  p,
  model,
  docRef,
  printHref,
}: {
  def: ReportDef;
  p: ReportParams;
  model: ReportModel;
  docRef: RefObject<HTMLDivElement | null>;
  printHref?: string;
}) {
  const { t, date } = useI18n();
  const business = useBusiness();
  const scope = useReportScope();
  const title = t(def.title);
  const file = `${slug(title)}-${p.from}-${p.to}`;
  const gola = scope.consolidated || def.business ? t("gola.all") : scope.name(scope.ids[0] ?? "");
  const excel = async () => {
    await downloadWorkbook(`${file}.xlsx`, [
      {
        name: title,
        preface: [title, `${business?.name ?? ""} · ${gola}`, periodText(def, p, date, t)],
        headers: model.columns.map((c) => c.label),
        rows: model.rows.map((r) => r.map((v) => excelCell(v, (d) => d))),
        ...(model.totals ? { totals: model.totals.map((v) => excelCell(v, (d) => d)) } : {}),
      },
    ]);
  };
  const csv = () => {
    const blob = new Blob(
      [modelToCsv(`${title} · ${gola} · ${periodText(def, p, date, t)}`, model)],
      {
        type: "text/csv;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const image = async () => {
    const node = docRef.current;
    if (!node) return;
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, { backgroundColor: "#ffffff", pixelRatio: 2 });
      if (!blob) return;
      const f = new File([blob], `${file}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [f] })) {
        await navigator.share({ files: [f], title });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") lazyToast(t("rep.shareFailed"), "error");
    }
  };
  return (
    <div className="no-print flex flex-wrap gap-2" data-testid="report-actions">
      {printHref ? (
        <Button asChild variant="outline" className="h-11">
          <Link href={printHref} data-testid="report-print">
            <Printer className="size-4" aria-hidden />
            {t("rep.print")}
          </Link>
        </Button>
      ) : (
        <Button
          variant="outline"
          className="h-11"
          onClick={() => window.print()}
          data-testid="report-print-now"
        >
          <Printer className="size-4" aria-hidden />
          {t("rep.print")}
        </Button>
      )}
      <Button
        variant="outline"
        className="h-11"
        disabled={model.rows.length === 0}
        onClick={() => void excel()}
        data-testid="report-excel"
      >
        <FileSpreadsheet className="size-4" aria-hidden />
        {t("rep.excel")}
      </Button>
      <Button
        variant="outline"
        className="h-11"
        disabled={model.rows.length === 0}
        onClick={csv}
        data-testid="report-csv"
      >
        <FileText className="size-4" aria-hidden />
        {t("rep.csv")}
      </Button>
      <Button
        variant="outline"
        className="h-11"
        disabled={model.rows.length === 0}
        onClick={() => void image()}
        data-testid="report-image"
      >
        <ImageIcon className="size-4" aria-hidden />
        {t("rep.image")}
      </Button>
    </div>
  );
}

function OptionControl({
  def,
  value,
  onChange,
}: {
  def: ReportDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  const scope = useReportScope();
  const banks = useLiveQuery(
    async () =>
      def.option?.kind === "bank" && scope.godownId
        ? (await db().bankAccounts.where("godownId").equals(scope.godownId).toArray()).filter(
            (b) => b.status === "active",
          )
        : [],
    [def.id, scope.godownId],
  );
  const o = def.option;
  if (!o) return null;
  if (o.kind === "party") {
    if (!scope.godownId) return <p className="text-muted-foreground text-sm">{t("rep.oneGola")}</p>;
    return (
      <PartyPicker
        godownId={scope.godownId}
        roles={[
          "FARMER",
          "SUPPLIER",
          "CUSTOMER",
          "MILL",
          "SECOND_PARTY",
          "VEHICLE_CUSTOMER",
          "DRIVER",
          "LABOUR",
          "OTHER",
          "GOLA",
        ]}
        createRole="OTHER"
        value={value || undefined}
        onChange={(id) => onChange(id ?? "")}
        label={t(o.label)}
        testId="report-party"
      />
    );
  }
  const values =
    o.kind === "bank"
      ? [
          { value: "", label: t("pay.CASH") },
          ...(banks ?? []).map((b) => ({ value: b._id, label: b.name })),
        ]
      : (o.values ?? []).map((v) => ({ value: v.value, label: t(v.label) }));
  return (
    <label className="flex flex-col gap-1 text-sm">
      {t(o.label)}
      <select
        className="bg-card min-h-11 rounded-xl border px-3 text-[15px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="report-option"
      >
        {values.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function printHrefOf(p: ReportParams): string {
  const q = new URLSearchParams({
    r: p.id,
    from: p.from,
    to: p.to,
    ...(p.opt ? { opt: p.opt } : {}),
  });
  return `/print/report?${q.toString()}`;
}

export function ReportsTab({
  section,
  initial,
}: {
  section: ReportSection;
  initial?: Partial<ReportParams>;
}) {
  const { t } = useI18n();
  const defs = reportsOf(section);
  const [id, setId] = useState(initial?.id ?? defs[0]!.id);
  const def = reportById(id) ?? defs[0]!;
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(initial?.from ?? rangeOf("month").from);
  const [to, setTo] = useState(initial?.to ?? todayIST());
  const [opt, setOpt] = useState(initial?.opt ?? def.option?.values?.[0]?.value ?? "");
  const p: ReportParams = { id: def.id, from, to, opt };
  const model = useReportModel(def, p);
  const ref = useRef<HTMLDivElement>(null);
  const today = todayIST();
  return (
    <div className="flex flex-col gap-3" data-testid={`reports-${section}`}>
      <div
        className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        role="tablist"
      >
        {defs.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={r.id === def.id}
            onClick={() => {
              setId(r.id);
              setOpt(r.option?.values?.[0]?.value ?? "");
            }}
            data-testid={`report-pick-${r.id}`}
            className={cn(
              "press min-h-10 shrink-0 rounded-full border px-4 text-sm",
              r.id === def.id ? "bg-primary text-primary-foreground border-primary" : "bg-card",
            )}
          >
            {t(r.title)}
          </button>
        ))}
      </div>
      {def.period !== "none" ? (
        <div className="flex flex-col gap-2">
          {def.period === "range" ? (
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
              {PRESETS.map((pr) => (
                <button
                  key={pr}
                  type="button"
                  aria-pressed={preset === pr}
                  data-testid={`report-range-${pr}`}
                  onClick={() => {
                    setPreset(pr);
                    if (pr !== "custom") {
                      const r = rangeOf(pr);
                      setFrom(r.from);
                      setTo(r.to);
                    }
                  }}
                  className={cn(
                    "press min-h-10 shrink-0 rounded-full border px-4 text-sm",
                    preset === pr ? "bg-gold-100 border-gold font-semibold" : "bg-card",
                  )}
                >
                  {t(`dsh.range.${pr}` as TKey)}
                </button>
              ))}
            </div>
          ) : null}
          {def.period === "date" || preset === "custom" ? (
            <div className="flex flex-wrap gap-2">
              {def.period === "range" ? (
                <label className="bg-card flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm">
                  {t("dsh.from")}
                  <input
                    type="date"
                    className="bg-transparent"
                    value={from}
                    max={to}
                    onChange={(e) => e.target.value && setFrom(e.target.value)}
                    data-testid="report-from"
                  />
                </label>
              ) : null}
              <label className="bg-card flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm">
                {def.period === "date" ? t("rep.onDate") : t("dsh.to")}
                <input
                  type="date"
                  className="bg-transparent"
                  value={to}
                  min={def.period === "range" ? from : undefined}
                  max={today}
                  onChange={(e) => e.target.value && setTo(e.target.value)}
                  data-testid="report-to"
                />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
      <OptionControl def={def} value={opt} onChange={setOpt} />
      {model === undefined ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <ReportActions def={def} p={p} model={model} docRef={ref} printHref={printHrefOf(p)} />
          <ReportDoc def={def} p={p} model={model} docRef={ref} />
        </>
      )}
    </div>
  );
}

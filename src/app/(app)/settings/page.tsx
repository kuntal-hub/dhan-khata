"use client";

/**
 * Settings (requirement_v2 §11 avatar menu, §20): theme; where units / deductions, low-stock
 * thresholds, language / digits and sessions are set; backup (JSON, this Gola or all, owner,
 * online) and Excel export of the registers (offline, from the device); the integrity check
 * (trial balance, re-posting, stock that went below zero, stale unsent work, server comparison).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Building2,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Moon,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sun,
  UserRound,
  Warehouse,
} from "lucide-react";
import { Segmented } from "@/components/entry/Fields";
import { varietyName } from "@/components/entry/Variety";
import { Panel } from "@/components/kit/Kit";
import { useReportScope } from "@/components/reports/ReportView";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { useTheme } from "@/components/system/theme";
import { Button } from "@/components/ui/button";
import { backupOnline, runIntegrity, type IntegrityReport } from "@/client/admin";
import { db } from "@/client/db/dexie";
import { downloadText } from "@/client/download";
import { errorKey } from "@/client/errors";
import { downloadWorkbook } from "@/client/export/excel";
import { useActiveGodown, useGodownRole } from "@/client/hooks";
import { reportById } from "@/client/reports/defs";
import { excelCell, runReport } from "@/client/reports/run";
import { todayIST } from "@/domain/dates";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

const EXPORT_REPORTS = [
  "purchase-register",
  "sales-register",
  "expense-daily",
  "load-register",
  "due-advance",
  "vehicle-income",
  "mill-dispatch",
  "mill-return",
  "second-party",
  "daily-overview",
];

function Row({ href, icon: Icon, label }: { href: string; icon: typeof Sun; label: string }) {
  return (
    <Link href={href} className="press flex min-h-12 items-center gap-3 py-2 text-[15px]">
      <Icon className="text-forest size-5" aria-hidden />
      <span className="flex-1">{label}</span>
      <ChevronRight className="text-muted-foreground size-4" aria-hidden />
    </Link>
  );
}

function IntegrityResult({ r, name }: { r: IntegrityReport; name: string }) {
  const { t, money, date, count, digits } = useI18n();
  const [varieties, setVarieties] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void db()
      .varieties.where("godownId")
      .equals(r.godownId)
      .toArray()
      .then((vs) => setVarieties(new Map(vs.map((v) => [v._id, varietyName(v, t)] as const))));
  }, [r.godownId, t]);
  const ok =
    r.trial.balanced &&
    r.repostMismatches.length === 0 &&
    r.negativeStock.length === 0 &&
    (r.server === null ||
      (r.server.diffs.length === 0 && r.server.serverRepostMismatches.length === 0));
  return (
    <div className="rounded-xl border p-3 text-sm" data-testid="integrity-result" data-ok={ok}>
      <p className="mb-1 font-semibold">
        {name} · {ok ? t("set.allGood") : t("set.needsLook")}
      </p>
      <ul className="flex flex-col gap-1">
        <li>
          {r.trial.balanced
            ? t("set.trialOk", { amount: money(r.trial.debitPaise) })
            : t("set.trialBad", { dr: money(r.trial.debitPaise), cr: money(r.trial.creditPaise) })}
        </li>
        <li>{t("set.repost", { count: count(r.repostMismatches.length) })}</li>
        <li data-testid="integrity-negative">
          {t("set.negative", { count: count(r.negativeStock.length) })}
        </li>
        {r.negativeStock.map((n) => (
          <li key={n.key} className="text-muted-foreground pl-3 text-xs">
            {t(`stk.${n.product}` as TKey)}
            {n.varietyId ? ` · ${varieties.get(n.varietyId) ?? ""}` : ""}
            {n.otherProductName ? ` · ${n.otherProductName}` : ""} ·{" "}
            {t("set.negLine", {
              qty: formatWeightNumber(n.minG, "QTL", { digits }),
              date: date(n.onDate, "short"),
              now: formatWeightNumber(n.nowG, "QTL", { digits }),
            })}
          </li>
        ))}
        {r.staleOps ? <li>{t("set.stale", { count: count(r.staleOps) })}</li> : null}
        <li>
          {r.server === null
            ? t("set.serverSkipped")
            : t("set.server", {
                count: count(r.server.diffs.length + r.server.serverRepostMismatches.length),
              })}
        </li>
      </ul>
    </div>
  );
}

export default function SettingsPage() {
  const { t, date } = useI18n();
  const { theme, setTheme } = useTheme();
  const { godown, godowns } = useActiveGodown();
  const role = useGodownRole();
  const owner = role === "owner";
  const scope = useReportScope();
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<IntegrityReport[] | null>(null);
  useEffect(() => {
    const u = () => setOnline(navigator.onLine);
    u();
    window.addEventListener("online", u);
    window.addEventListener("offline", u);
    return () => {
      window.removeEventListener("online", u);
      window.removeEventListener("offline", u);
    };
  }, []);
  const nameOf = (id: string) => (godowns ?? []).find((g) => g._id === id)?.name ?? "";

  const backup = async (all: boolean) => {
    setBusy(all ? "backupAll" : "backup");
    try {
      const text = await backupOnline(all ? undefined : godown?._id);
      downloadText(
        `dhan-gola-backup-${all ? "all" : (godown?.code ?? "gola")}-${todayIST()}.json`,
        text,
      );
      lazyToast(t("set.backupDone"), "success");
    } catch (e) {
      lazyToast(t(errorKey(e)), "error");
    } finally {
      setBusy(null);
    }
  };

  const excel = async () => {
    setBusy("excel");
    try {
      const sheets = [];
      for (const id of EXPORT_REPORTS) {
        const def = reportById(id)!;
        const model = await runReport(def, {
          godownIds: scope.ids,
          golaName: scope.name,
          from: "2000-01-01",
          to: todayIST(),
          t,
        });
        sheets.push({
          name: t(def.title),
          preface: [
            t(def.title),
            scope.consolidated ? t("gola.all") : scope.name(scope.ids[0] ?? ""),
          ],
          headers: model.columns.map((c) => c.label),
          rows: model.rows.map((r) => r.map((v) => excelCell(v, (d) => d))),
          ...(model.totals ? { totals: model.totals.map((v) => excelCell(v, (d) => d)) } : {}),
        });
      }
      await downloadWorkbook(`dhan-gola-${todayIST()}.xlsx`, sheets);
    } catch (e) {
      lazyToast(t(errorKey(e)), "error");
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy("integrity");
    try {
      const out: IntegrityReport[] = [];
      for (const id of scope.ids) {
        out.push(await runIntegrity(id, { compareServer: online && owner }));
      }
      setResults(out);
    } catch (e) {
      lazyToast(t(errorKey(e)), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="settings">
      <PageTitle title={t("menu.settings")} back="/" />
      <Panel title={t("set.look")}>
        <Segmented
          label={t("set.theme")}
          value={theme}
          options={[
            ["light", t("set.light")],
            ["dark", t("set.dark")],
          ]}
          onChange={setTheme}
          testId="settings-theme"
        />
        <p className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
          {theme === "dark" ? (
            <Moon className="size-4" aria-hidden />
          ) : (
            <Sun className="size-4" aria-hidden />
          )}
          {t("set.themeHint")}
        </p>
      </Panel>
      <Panel title={t("set.where")}>
        <nav className="flex flex-col divide-y">
          {owner ? (
            <Row href="/business" icon={Building2} label={t("set.unitsDeductions")} />
          ) : null}
          {owner && godown ? (
            <Row
              href={`/golas/edit?id=${godown._id}`}
              icon={Warehouse}
              label={t("set.thresholds")}
            />
          ) : null}
          <Row href="/profile" icon={UserRound} label={t("set.languageDigits")} />
          <Row href="/sessions" icon={Smartphone} label={t("menu.sessions")} />
          <Row href="/sync" icon={RefreshCw} label={t("menu.sync")} />
        </nav>
      </Panel>
      <Panel title={t("set.backupTitle")}>
        <p className="text-muted-foreground mb-3 text-sm">{t("set.backupHint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-12"
            disabled={busy !== null}
            onClick={() => void excel()}
            data-testid="settings-excel"
          >
            <FileSpreadsheet className="size-5" aria-hidden />
            {t("set.excelAll")}
          </Button>
          {owner ? (
            <>
              <Button
                variant="outline"
                className="h-12"
                disabled={busy !== null || !online || !godown}
                onClick={() => void backup(false)}
                data-testid="settings-backup"
              >
                <Database className="size-5" aria-hidden />
                {t("set.backupGola")}
              </Button>
              <Button
                variant="outline"
                className="h-12"
                disabled={busy !== null || !online}
                onClick={() => void backup(true)}
              >
                <Database className="size-5" aria-hidden />
                {t("set.backupAll")}
              </Button>
            </>
          ) : null}
        </div>
        {owner && !online ? (
          <p className="text-muted-foreground mt-2 text-xs">{t("set.backupOnline")}</p>
        ) : null}
      </Panel>
      <Panel title={t("set.integrity")}>
        <p className="text-muted-foreground mb-3 text-sm">{t("set.integrityHint")}</p>
        <Button
          className="h-12"
          disabled={busy !== null || scope.ids.length === 0}
          onClick={() => void check()}
          data-testid="settings-integrity"
        >
          <ShieldCheck className="size-5" aria-hidden />
          {busy === "integrity" ? t("set.checking") : t("set.runCheck")}
        </Button>
        {results ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              {t("set.checkedAt", { date: date(todayIST(), "short") })}
            </p>
            {results.map((r) => (
              <IntegrityResult key={r.godownId} r={r} name={nameOf(r.godownId)} />
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

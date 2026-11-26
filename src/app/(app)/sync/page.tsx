"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OutboxRow } from "@/client/db/dexie";
import { downloadText } from "@/client/download";
import { errorKey, reasonKey } from "@/client/errors";
import { useOutbox } from "@/client/hooks";
import { getSyncEngine } from "@/client/sync/instance";
import {
  applyMineAsNewRevision,
  conflictOf,
  discardOp,
  exportUnsynced,
  keepServer,
  retryOp,
} from "@/client/sync/resolve";
import { applyDigits } from "@/domain/digits";
import { useI18n, type I18nValue } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { useAppSelector } from "@/store";

/** Sync screen (spec §12.3, §16): every pending/error/conflict op in plain language. */
export default function SyncPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const sync = useAppSelector((s) => s.sync);
  const ops = useOutbox();

  const syncNow = () => void getSyncEngine().syncNow();
  const doExport = async () => {
    downloadText(
      `dhan-khata-unsynced-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`,
      await exportUnsynced(),
    );
    toast.success(t("sync.exported"));
  };

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">{t("sync.title")}</h1>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="text-sm" data-testid="sync-online">
            {sync.online ? t("sync.online") : t("sync.offline")}
          </p>
          <p className="text-muted-foreground text-sm">
            {sync.lastSyncAt
              ? t("sync.lastSync", { time: formatTime(sync.lastSyncAt, i18n) })
              : t("sync.never")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-11"
              onClick={syncNow}
              disabled={sync.running}
              data-testid="sync-now"
              data-pending={ops?.length ?? 0}
            >
              {sync.running ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              {sync.running ? t("sync.running") : t("sync.syncNow")}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => void doExport()}
              disabled={!ops?.length}
            >
              <Download className="size-4" aria-hidden />
              {t("sync.exportUnsynced")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {ops && ops.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CheckCircle2 className="text-primary size-4" aria-hidden />
          {t("sync.nothingPending")}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2" aria-label={t("sync.title")}>
        {(ops ?? []).map((op) => (
          <li key={op.seq}>
            <OpCard op={op} i18n={i18n} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTime(iso: string, i18n: I18nValue): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${i18n.date(ymd, "short")} ${applyDigits(`${hh}:${mm}`, i18n.digits)}`;
}

function describe(op: OutboxRow, i18n: I18nValue): string {
  const p = (op.payload ?? {}) as Record<string, unknown>;
  const { t } = i18n;
  if (op.entity === "voucher" && typeof p.type === "string") {
    const parts = [t(`voucherType.${p.type}` as TKey)];
    if (typeof p.number === "string") parts.push(p.number);
    if (typeof p.date === "string") parts.push(i18n.date(p.date, "short"));
    if (op.op === "dueDate") parts.push(t("dueF.syncOp"));
    return parts.join(" · ");
  }
  const label = t(`sync.entity.${op.entity}` as TKey);
  const name =
    typeof p.name === "string" && p.name ? p.name : typeof p.number === "string" ? p.number : "";
  return name ? `${label} · ${name}` : label;
}

const STATUS_VARIANT: Record<
  OutboxRow["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  sending: "outline",
  error: "destructive",
  conflict: "destructive",
};

function OpCard({ op, i18n }: { op: OutboxRow; i18n: I18nValue }) {
  const { t } = i18n;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const conflict = op.status === "conflict" ? conflictOf(op) : null;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      void getSyncEngine().syncNow();
    } catch (e) {
      toast.error(t(errorKey(e)));
    }
  };

  return (
    <Card data-testid="outbox-op">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-start justify-between gap-2 text-base">
          <span className="min-w-0 break-words">{describe(op, i18n)}</span>
          <Badge variant={STATUS_VARIANT[op.status]}>
            {t(`sync.opStatus.${op.status}` as TKey)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {op.lastError && op.status !== "pending" ? (
          <p className="text-destructive text-sm">{t(reasonKey(op.lastError))}</p>
        ) : null}
        {conflict ? <ConflictView op={op} i18n={i18n} /> : null}
        <div className="flex flex-wrap gap-2">
          {op.status === "error" ? (
            <>
              <Button className="h-11" onClick={() => void run(() => retryOp(op.seq!))}>
                {t("sync.retry")}
              </Button>
              <Button variant="outline" className="h-11" onClick={() => setConfirmDiscard(true)}>
                {t("sync.discard")}
              </Button>
            </>
          ) : null}
          {conflict ? (
            <>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => void run(() => keepServer(op.seq!))}
              >
                {t("sync.keepServer")}
              </Button>
              {conflict.doc.status !== "void" ? (
                <Button
                  className="h-11"
                  onClick={() => void run(() => applyMineAsNewRevision(op.seq!))}
                >
                  {t("sync.applyMine")}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </CardContent>
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("sync.discard")}</DialogTitle>
            <DialogDescription>{t("sync.discardConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setConfirmDiscard(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              onClick={() => {
                setConfirmDiscard(false);
                void run(() => discardOp(op.seq!));
              }}
            >
              {t("sync.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const SKIP = new Set([
  "_id",
  "godownId",
  "createdAt",
  "createdBy",
  "deviceId",
  "serverSeq",
  "updatedBy",
  "number",
  "fy",
]);

function flatten(v: unknown, prefix: string, out: Map<string, unknown>) {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => flatten(x, `${prefix}.${i}`, out));
  } else if (v !== undefined) out.set(prefix, v);
}

function show(path: string, v: unknown, i18n: I18nValue): string {
  if (v === undefined) return "—";
  const leaf = path.split(".").pop() ?? "";
  if (typeof v === "string" && /^-?\d+$/.test(v)) {
    if (leaf.endsWith("Paise") || leaf === "ratePaisePerQtl") return i18n.money(BigInt(v));
    if (leaf.endsWith("G")) return i18n.weightOf(BigInt(v));
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return i18n.date(v, "short");
  if (typeof v === "number") return i18n.count(v);
  return String(v);
}

/** Side by side: "এই ডিভাইসের সংস্করণ" vs "সার্ভারের সংস্করণ" — only the fields that differ. */
function ConflictView({ op, i18n }: { op: OutboxRow; i18n: I18nValue }) {
  const { t } = i18n;
  const c = conflictOf(op)!;
  const rows = useMemo(() => {
    const mine = new Map<string, unknown>();
    const theirs = new Map<string, unknown>();
    flatten(op.payload, "", mine);
    flatten(c.doc, "", theirs);
    const keys = [...new Set([...mine.keys(), ...theirs.keys()])].filter(
      (k) => !SKIP.has(k.split(".")[0]!) && mine.get(k) !== theirs.get(k),
    );
    return keys.sort().map((k) => ({ k, mine: mine.get(k), theirs: theirs.get(k) }));
  }, [op.payload, c.doc]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="py-1 pr-2 font-normal">{t("sync.field")}</th>
            <th className="py-1 pr-2 font-normal">{t("sync.thisDevice")}</th>
            <th className="py-1 font-normal">{t("sync.serverVersion")}</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => (
            <tr key={r.k} className="border-t align-top">
              <td className="text-muted-foreground py-1 pr-2 break-all">{r.k}</td>
              <td className="py-1 pr-2">{show(r.k, r.mine, i18n)}</td>
              <td className="py-1">{show(r.k, r.theirs, i18n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

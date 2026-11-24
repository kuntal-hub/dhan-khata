"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, ReadOnlyNotice } from "@/components/system/page";
import { useNames } from "@/components/vouchers/names";
import { backupOnline, restoreOnline } from "@/client/admin";
import { downloadText } from "@/client/download";
import { errorKey } from "@/client/errors";
import { downloadWorkbook } from "@/client/export/excel";
import { godownWorkbook } from "@/client/export/workbook";
import { useActiveGodown } from "@/client/hooks";
import { getSyncEngine } from "@/client/sync/instance";
import { todayIST } from "@/domain/dates";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

/** Owner: full backup JSON, Excel workbook per godown, restore into an empty DB (spec §17). */
export default function BackupPage() {
  const { t } = useI18n();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const { godownId, godown } = useActiveGodown();
  const names = useNames(godownId);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!isOwner) return <ReadOnlyNotice reason="viewer" />;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  const json = (all: boolean) =>
    run(async () => {
      const text = await backupOnline(all ? undefined : (godownId ?? undefined));
      downloadText(
        `dhan-khata-backup-${all ? "all" : (godown?.code ?? "")}-${todayIST()}.json`,
        text,
      );
    });
  const excel = () =>
    run(async () => {
      if (!godownId || !names) return;
      const sheets = await godownWorkbook(godownId, t, { variety: (id) => names.variety(id) });
      await downloadWorkbook(`dhan-khata-${godown?.code ?? ""}-${todayIST()}.xlsx`, sheets);
    });
  const restore = (f: File) =>
    run(async () => {
      const backup = JSON.parse(await f.text()) as unknown;
      await restoreOnline(backup);
      toast.success(t("backup.restored"));
      await getSyncEngine().syncNow();
    });
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("backup.title")} />
      <p className="text-muted-foreground text-xs">{t("settings.onlineNeeded")}</p>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("backup.fullJson")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            className="h-11"
            disabled={busy || !godownId}
            onClick={() => void json(false)}
            data-testid="backup-godown"
          >
            <Download className="size-4" aria-hidden />
            {t("backup.thisGodown")}
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => void json(true)}
            data-testid="backup-all"
          >
            <Download className="size-4" aria-hidden />
            {t("backup.all")}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <Button
            variant="outline"
            className="h-11"
            disabled={busy || !names}
            onClick={() => void excel()}
            data-testid="backup-excel"
          >
            <FileSpreadsheet className="size-4" aria-hidden />
            {t("backup.excel")}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("backup.restore")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">{t("backup.restoreHint")}</p>
          <Button
            variant="outline"
            className="h-11 self-start"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" aria-hidden />
            {t("backup.restore")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void restore(f);
              e.target.value = "";
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

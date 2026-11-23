"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currentDbName, exportRawDatabase, type DbOpenError } from "@/client/db/dexie";
import { downloadText } from "@/client/download";
import { useT } from "@/i18n/I18nProvider";

/**
 * Shown when the local database can't be opened (version/upgrade error, spec §12.9).
 * Offers "export local data" first; there is deliberately NO reset button here.
 */
export function DbRecovery({ error }: { error: DbOpenError }) {
  const t = useT();
  const exportData = async () => {
    const dump = await exportRawDatabase(currentDbName());
    downloadText(
      `dhan-khata-device-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ kind: "dhan-khata-device-dump", error: error.kind, dump }, null, 2),
    );
  };
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive size-5" aria-hidden />
            {t("recovery.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm">{t("recovery.body")}</p>
          <Button className="h-11" onClick={() => void exportData()}>
            {t("recovery.export")}
          </Button>
          <Button variant="outline" className="h-11" onClick={() => window.location.reload()}>
            {t("recovery.reload")}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

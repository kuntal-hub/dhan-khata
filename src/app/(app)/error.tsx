"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/client/diagnostics";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * Per-route error boundary (spec §16): data stays safe in IndexedDB; "রিপোর্ট পাঠান" stores the
 * error on the device and uploads it on the next sync (owner → Settings → Diagnostics).
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useI18n();
  const path = usePathname();
  const [sent, setSent] = useState(false);
  const message = error instanceof Error ? error.message : String(error);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div
      className="flex flex-col items-center gap-3 py-10 text-center"
      role="alert"
      data-testid="route-error"
    >
      <AlertTriangle className="text-destructive size-10" aria-hidden />
      <h1 className="text-lg font-semibold">{t("diag.title")}</h1>
      <p className="text-muted-foreground max-w-sm text-sm">{t("diag.body")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button className="h-11" onClick={() => retry()}>
          {t("diag.retry")}
        </Button>
        <Button
          variant="outline"
          className="h-11"
          disabled={sent}
          onClick={() =>
            void reportClientError({
              route: path,
              message,
              ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
            }).then(() => setSent(true))
          }
          data-testid="route-error-report"
        >
          {sent ? t("diag.reported") : t("diag.report")}
        </Button>
      </div>
    </div>
  );
}

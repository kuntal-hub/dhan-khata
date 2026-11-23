"use client";

import Link from "next/link";
import { Clock, HardDrive, LogIn, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { META, setMeta } from "@/client/db/meta";
import { useMeta } from "@/client/hooks";
import { CLOCK_SKEW_WARN_MS } from "@/client/sync/engine";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";
import { useUpdateApp } from "@/components/pwa/PwaRuntime";

/** Non-blocking banners: re-login, app update, clock skew, storage eviction notice. */
export function Banners() {
  const { t, count } = useI18n();
  const sync = useAppSelector((s) => s.sync);
  const storageNotice = useMeta<string>(META.storageNoticeShown);
  const { updateReady, applyUpdate } = useUpdateApp();
  const skewMin =
    sync.clockSkewMs !== null && Math.abs(sync.clockSkewMs) > CLOCK_SKEW_WARN_MS
      ? Math.round(Math.abs(sync.clockSkewMs) / 60_000)
      : null;

  return (
    <div className="flex flex-col gap-2 empty:hidden">
      {sync.authRequired ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <LogIn className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{t("auth.reloginBanner")}</span>
          <Button asChild size="sm" className="h-11">
            <Link href="/login">{t("auth.relogin")}</Link>
          </Button>
        </div>
      ) : null}
      {updateReady ? (
        <div className="bg-primary/10 flex items-center gap-2 rounded-md p-2 text-sm">
          <Sparkles className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{t("pwa.updateAvailable")}</span>
          <Button
            size="sm"
            className="h-11"
            onClick={() => {
              if (!applyUpdate()) toast(t("pwa.updateWait"));
            }}
          >
            {t("pwa.update")}
          </Button>
        </div>
      ) : null}
      {skewMin !== null ? (
        <div className="text-destructive flex items-center gap-2 rounded-md border p-2 text-sm">
          <Clock className="size-4 shrink-0" aria-hidden />
          <span>{t("pwa.clockSkew", { minutes: count(skewMin) })}</span>
        </div>
      ) : null}
      {storageNotice === "pending" ? (
        <div className="flex items-center gap-2 rounded-md border p-2 text-sm">
          <HardDrive className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{t("pwa.storageDenied")}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-11"
            onClick={() => void setMeta(META.storageNoticeShown, "shown")}
          >
            {t("pwa.dismiss")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

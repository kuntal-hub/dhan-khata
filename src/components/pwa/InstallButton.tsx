"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  canPromptInstall,
  isIos,
  isStandalone,
  onInstallPromptChange,
  promptInstall,
} from "@/client/pwa/browser";
import { META, getMeta, setMeta } from "@/client/db/meta";
import { useT } from "@/i18n/I18nProvider";

/**
 * "অ্যাপ ইনস্টল করুন" (spec §13): Android/desktop use the captured `beforeinstallprompt`;
 * iOS gets one-time illustrated instructions (Share → Add to Home Screen).
 */
export function InstallButton() {
  const t = useT();
  const canPrompt = useSyncExternalStore(onInstallPromptChange, canPromptInstall, () => false);
  const [iosOpen, setIosOpen] = useState(false);

  useEffect(() => {
    if (!isIos() || isStandalone()) return;
    void getMeta<boolean>(META.iosInstallShown).then((shown) => {
      if (!shown) setIosOpen(true);
    });
  }, []);

  const closeIos = () => {
    setIosOpen(false);
    void setMeta(META.iosInstallShown, true);
  };

  return (
    <>
      {canPrompt ? (
        <Button variant="outline" className="h-11" onClick={() => void promptInstall()}>
          <Download className="size-4" aria-hidden />
          {t("pwa.install")}
        </Button>
      ) : null}
      <Dialog open={iosOpen} onOpenChange={(o) => !o && closeIos()}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("pwa.iosTitle")}</DialogTitle>
            <DialogDescription asChild>
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-left">
                <li>
                  <span className="inline-flex items-center gap-1">
                    {t("pwa.iosStep1")}
                    <Share className="size-4" aria-hidden />
                  </span>
                </li>
                <li>{t("pwa.iosStep2")}</li>
              </ol>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="h-11" onClick={closeIos}>
              {t("pwa.dismiss")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

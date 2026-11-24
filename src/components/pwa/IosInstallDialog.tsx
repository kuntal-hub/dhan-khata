"use client";

import { Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/I18nProvider";

/** One-time iOS "Share → Add to Home Screen" instructions. Loaded only on iOS when needed. */
export function IosInstallDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
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
          <Button className="h-11" onClick={onClose}>
            {t("pwa.dismiss")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

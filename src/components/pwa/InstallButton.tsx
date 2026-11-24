"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  canPromptInstall,
  isIos,
  isStandalone,
  onInstallPromptChange,
  promptInstall,
} from "@/client/pwa/browser";
import { META, getMeta, setMeta } from "@/client/db/meta";
import { useT } from "@/i18n/I18nProvider";

// Radix dialog only for iOS, loaded when it is actually shown (spec §15 Home JS budget).
const IosInstallDialog = dynamic(
  () => import("./IosInstallDialog").then((m) => m.IosInstallDialog),
  { ssr: false },
);

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
      {iosOpen ? <IosInstallDialog onClose={closeIos} /> : null}
    </>
  );
}

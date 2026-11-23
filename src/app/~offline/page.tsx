"use client";

import Link from "next/link";
import { WifiOff } from "lucide-react";
import { useT } from "@/i18n/I18nProvider";

/** Service-worker fallback for anything unexpected (never shown for app routes). */
export default function OfflinePage() {
  const t = useT();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <WifiOff className="text-muted-foreground size-10" aria-hidden />
      <h1 className="text-xl font-semibold">{t("pwa.offlineTitle")}</h1>
      <p className="text-muted-foreground text-sm">{t("pwa.offlineBody")}</p>
      <Link href="/" className="text-primary min-h-11 py-3 underline">
        {t("pwa.goHome")}
      </Link>
    </main>
  );
}

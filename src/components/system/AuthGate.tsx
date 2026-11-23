"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ShieldOff } from "lucide-react";
import { useBootstrapped } from "@/client/hooks";
import { useT } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";
import { BootstrapScreen } from "./BootstrapScreen";
import { Splash } from "./Splash";

/**
 * App pages render only for an unlocked session whose first download (bootstrap) finished.
 * Not logged in → /login; session but locked → /unlock (PIN, works offline).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const status = useAppSelector((s) => s.session.status);
  const bootstrapped = useBootstrapped();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
    else if (status === "locked") router.replace("/unlock");
  }, [status, router]);

  if (status === "revoked") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldOff className="text-destructive size-10" aria-hidden />
        <h1 className="text-xl font-semibold">{t("auth.deviceRevokedTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("auth.deviceRevokedBody")}</p>
      </main>
    );
  }
  if (status !== "active" || bootstrapped === undefined)
    return <Splash label={t("common.loading")} />;
  if (!bootstrapped) return <BootstrapScreen />;
  return <>{children}</>;
}

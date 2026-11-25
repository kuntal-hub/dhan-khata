"use client";

/**
 * A new owner has no Gola yet (right after registration): ask for the first one before the app
 * opens (requirement_v2 §2.2). Golas are created online; afterwards everything works offline.
 */
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Splash } from "@/components/system/Splash";
import { useAccessibleGodowns, useActiveGodown } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";
import dynamic from "next/dynamic";

// Needed only by a brand-new owner: kept out of the start-up JS (it pulls in sync + repo code).
const GolaForm = dynamic(() => import("./GolaForm").then((m) => m.GolaForm), { ssr: false });

export function FirstGolaGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const godowns = useAccessibleGodowns();
  const { select } = useActiveGodown();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  if (godowns === undefined) return <Splash label={t("common.loading")} />;
  if (godowns.length > 0 || !isOwner) return <>{children}</>;
  return (
    <main
      className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4"
      data-testid="first-gola"
    >
      <Logo name={t("common.appName")} tagline={t("acct.tagline")} />
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-xl">{t("gola.firstTitle")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("gola.firstHint")}</p>
        </CardHeader>
        <CardContent>
          <GolaForm onSaved={(g) => select(g._id)} />
        </CardContent>
      </Card>
    </main>
  );
}

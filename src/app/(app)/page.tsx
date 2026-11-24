"use client";

import { InstallButton } from "@/components/pwa/InstallButton";
import { useActiveGodown } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * Home. TRANSITIONAL (v2 Phase 2): the v1 dashboard was removed with the v1 data model; the
 * v2 Dashboard section (overview, cashbook, stock, daily overview, reports) replaces this page
 * in v2 Phases 4 and 8.
 */
export default function HomePage() {
  const { t } = useI18n();
  const { godown } = useActiveGodown();
  return (
    <div className="flex flex-col gap-3" data-testid="home">
      <h1 className="text-lg font-semibold">{godown ? godown.name : t("common.loading")}</h1>
      <InstallButton />
    </div>
  );
}

"use client";

import Link from "next/link";
import { BarChart3, ChevronRight, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/system/page";
import { useActiveGodown } from "@/client/hooks";
import { ALL_REPORTS } from "@/client/reports/registry";
import type { ReportGroup } from "@/client/reports/defs";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

const GROUPS: ReportGroup[] = ["daily", "party", "stock", "owner", "all"];

/** রিপোর্ট (spec §9.14): every report for the active godown, plus owner / all-godowns ones. */
export default function ReportsPage() {
  const { t } = useI18n();
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const { canConsolidate, consolidated } = useActiveGodown();
  const visible = ALL_REPORTS.filter(
    (r) =>
      (!r.ownerOnly || isOwner) &&
      (!r.consolidated || canConsolidate) &&
      (!consolidated || r.consolidated),
  );
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t("reports.title")} />
      {GROUPS.map((g) => {
        const list = visible.filter((r) => r.group === g);
        if (list.length === 0) return null;
        return (
          <Card key={g}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {g === "owner" || g === "all" ? <Lock className="size-4" aria-hidden /> : null}
                {t(`reports.group.${g}`)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col">
                {list.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/reports/view?r=${r.id}`}
                      className="hover:bg-muted flex min-h-12 items-center gap-3 rounded-md px-2"
                      data-testid={`report-${r.id}`}
                    >
                      <BarChart3 className="text-primary size-4 shrink-0" aria-hidden />
                      <span className="flex-1">{t(r.title)}</span>
                      <ChevronRight className="size-4" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

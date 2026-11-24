"use client";

import { dot } from "@/client/ui/text";
import { formatScaled } from "@/domain/decimal";
import { TRIP_EXPENSE_KINDS } from "@/domain/schemas";
import type { VehiclePnl } from "@/domain/calc/vehicle";
import { Money } from "@/components/money/display";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";

function Line({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex justify-between gap-2" data-testid={testId}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular text-right">{children}</span>
    </div>
  );
}

/** Vehicle dashboard figures (spec §9.7). */
export function VehiclePnlCard({ pnl, detailed }: { pnl: VehiclePnl; detailed?: boolean }) {
  const { t, count, money } = useI18n();
  const litres = formatScaled(pnl.dieselMl, 3).replace(/\.?0+$/, "");
  return (
    <div className="flex flex-col gap-1 text-sm">
      <Line label={t("fleet.trips")}>{count(pnl.tripCount)}</Line>
      <Line label={t("fleet.freightEarned")}>
        <Money paise={pnl.freightPaise} />
      </Line>
      <Line label={t("fleet.totalExpenses")}>
        <Money paise={pnl.totalExpensesPaise} />
      </Line>
      <Line label={t("fleet.netProfit")} testId="vehicle-net-profit">
        <Money
          paise={pnl.netProfitPaise}
          className={`font-semibold ${pnl.netProfitPaise < 0n ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
        />
      </Line>
      <Line label={t("fleet.dueFromHirers")}>
        <Money paise={pnl.dueFromHirersPaise} />
      </Line>
      <Line label={t("fleet.diesel")}>{t("fleet.litres", { litres: litres || "0" })}</Line>
      {pnl.perKmPaise !== null ? (
        <Line label={t("fleet.perKm")}>
          {dot(money(pnl.perKmPaise), t("fleet.km", { km: count(pnl.km) }))}
        </Line>
      ) : null}
      {detailed ? (
        <div className="mt-2 flex flex-col gap-1 border-t pt-2">
          <span className="font-medium">{t("fleet.byKind")}</span>
          {TRIP_EXPENSE_KINDS.filter((k) => pnl.expensesByKind[k] > 0n).map((k) => (
            <Line key={k} label={t(`vehicle.expenseKind.${k}` as TKey)}>
              <Money paise={pnl.expensesByKind[k]} />
            </Line>
          ))}
          {pnl.otherExpensesPaise > 0n ? (
            <Line label={t("fleet.otherExpenses")}>
              <Money paise={pnl.otherExpensesPaise} />
            </Line>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

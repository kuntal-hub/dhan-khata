"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SyncIcon } from "@/components/lists/common";
import { amountOf } from "@/client/ui/amount";
import { dot } from "@/client/ui/text";
import type { Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { viewPathOf } from "./paths";

export function VoucherRow({ v, partyName }: { v: Voucher; partyName: string }) {
  const { t, money, date } = useI18n();
  const isVoid = v.status === "void";
  return (
    <Link
      href={viewPathOf(v)}
      className="hover:bg-muted flex min-h-16 items-center gap-3 border-b px-1 py-2"
      data-testid="voucher-row"
      data-number={v.number}
    >
      <SyncIcon
        entityId={v._id}
        {...(v.serverSeq !== undefined ? { serverSeq: v.serverSeq } : {})}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate font-medium ${isVoid ? "line-through" : ""}`}>
          {partyName || t(`voucherType.${v.type}` as TKey)}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {dot(v.number, date(v.date, "short"))}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={`tabular text-sm font-semibold ${isVoid ? "line-through" : ""}`}>
          {money(amountOf(v))}
        </span>
        {isVoid ? <Badge variant="destructive">{t("voucher.void")}</Badge> : null}
        {v.type === "SALE" && !isVoid ? (
          <Badge variant={v.settlementStatus === "SETTLED" ? "default" : "secondary"}>
            {v.settlementStatus === "SETTLED" ? t("sale.settled") : t("sale.pending")}
          </Badge>
        ) : null}
      </div>
    </Link>
  );
}

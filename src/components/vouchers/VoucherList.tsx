"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField, SeasonField } from "@/components/forms/fields";
import { VarietyPicker } from "@/components/forms/pickers";
import { EmptyState, Loading } from "@/components/lists/common";
import { VirtualList } from "@/components/lists/VirtualList";
import { listVouchers, type ListFilter } from "@/client/queries/vouchers";
import type { Voucher, VoucherType } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { useNames } from "./names";
import { VoucherRow } from "./VoucherRow";

export { VoucherRow };

function partyOf(v: Voucher): string | undefined {
  if (v.type === "LOAD") return v.toMillPartyId;
  return "partyId" in v ? (v.partyId as string | undefined) : undefined;
}

/** Filterable, virtualized list of one voucher type in the active godown. */
export function VoucherList({
  godownId,
  type,
  newHref,
  showStatusFilter,
}: {
  godownId: string;
  type: VoucherType;
  newHref?: string;
  showStatusFilter?: "settlement";
}) {
  const { t } = useI18n();
  const names = useNames(godownId);
  const [f, setF] = useState<ListFilter & { settlement?: "ALL" | "PENDING" | "SETTLED" }>({
    status: "all",
  });
  const [open, setOpen] = useState(false);
  const list = useLiveQuery(
    () => listVouchers(godownId, type, f),
    [godownId, type, JSON.stringify(f)],
  );
  const shown =
    list?.filter(
      (v) =>
        !f.settlement ||
        f.settlement === "ALL" ||
        (v.type === "SALE" && v.settlementStatus === f.settlement),
    ) ?? undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="h-11"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {t("filters.title")}
        </Button>
        {newHref ? (
          <Button asChild className="h-11">
            <Link href={newHref} data-testid="list-new">
              <Plus className="size-4" aria-hidden />
              {t("common.addNew")}
            </Link>
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="grid grid-cols-2 gap-2 rounded-md border p-2">
          <DateField
            label={t("filters.from")}
            value={f.from ?? ""}
            optional
            onChange={(from) => setF({ ...f, ...(from ? { from } : { from: undefined }) })}
          />
          <DateField
            label={t("filters.to")}
            value={f.to ?? ""}
            optional
            onChange={(to) => setF({ ...f, ...(to ? { to } : { to: undefined }) })}
          />
          <div className="col-span-2">
            <SeasonField
              value={f.season}
              onChange={(season) =>
                setF({ ...f, season: f.season === season ? undefined : season })
              }
            />
          </div>
          <div className="col-span-2">
            <VarietyPicker
              godownId={godownId}
              label={t("trade.variety")}
              value={f.varietyId}
              onChange={(varietyId) => setF({ ...f, varietyId })}
              allowClear
            />
          </div>
          <select
            className="border-input h-12 rounded-md border px-2 text-base"
            value={f.status ?? "all"}
            aria-label={t("filters.status")}
            onChange={(e) => setF({ ...f, status: e.target.value as ListFilter["status"] })}
          >
            <option value="all">{t("filters.statusAll")}</option>
            <option value="active">{t("filters.statusActive")}</option>
            <option value="void">{t("voucher.void")}</option>
          </select>
          {showStatusFilter === "settlement" ? (
            <select
              className="border-input h-12 rounded-md border px-2 text-base"
              value={f.settlement ?? "ALL"}
              aria-label={t("sale.settlementStatus")}
              onChange={(e) =>
                setF({ ...f, settlement: e.target.value as "ALL" | "PENDING" | "SETTLED" })
              }
            >
              <option value="ALL">{t("filters.statusAll")}</option>
              <option value="PENDING">{t("sale.pending")}</option>
              <option value="SETTLED">{t("sale.settled")}</option>
            </select>
          ) : null}
        </div>
      ) : null}
      {!shown || !names ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState
          text={t("filters.empty")}
          action={
            newHref ? (
              <Button asChild className="h-11">
                <Link href={newHref}>{t("common.addNew")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <VirtualList
          items={shown}
          getKey={(v) => v._id}
          testId="voucher-list"
          render={(v) => <VoucherRow v={v} partyName={names.party(partyOf(v))} />}
        />
      )}
    </div>
  );
}

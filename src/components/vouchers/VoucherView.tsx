"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState, type ReactNode } from "react";
import { Ban, Link2, Pencil, Printer, Scale } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TextField } from "@/components/forms/fields";
import { Loading, SyncIcon } from "@/components/lists/common";
import { ReadOnlyNotice } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { getSession } from "@/client/db/meta";
import { errorKey } from "@/client/errors";
import { useGodownRole } from "@/client/hooks";
import { groupOf } from "@/client/queries/vouchers";
import { amountOf } from "@/client/ui/amount";
import { dot, spaced } from "@/client/ui/text";
import { groupPrimary, LINKED_REMOVED, unlockDay, voidTransfer, voidVoucher } from "@/client/repo";
import { categoryLabel } from "@/client/ui/labels";
import { loadMargin } from "@/domain/calc/load";
import { tripProfit } from "@/domain/calc/trip";
import { saleSummary } from "@/domain/calc/sale";
import { computeDeductions, lineInputFromJson } from "@/domain/calc/trade";
import { formatVehicleNumber, type TradeLine, type Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { Qty } from "@/components/money/display";
import { useNames, type Names } from "./names";

export function isTransfer(v: Voucher): boolean {
  return "interGodown" in v && !!v.interGodown;
}

export function editPathOf(v: Voucher): string | null {
  if (isTransfer(v)) return `/transfer?id=${v._id}`;
  switch (v.type) {
    case "EXPENSE":
      return `/expense/edit?id=${v._id}`;
    case "TRIP":
      return `/trip/edit?id=${v._id}`;
    case "CONTRA":
      return `/cashbank/entry?id=${v._id}`;
    case "STOCK_ADJUST":
      return `/stock/adjust?id=${v._id}`;
    case "PURCHASE":
      return `/purchase/edit?id=${v._id}`;
    case "SALE":
      return `/sale/edit?id=${v._id}`;
    case "LOAD":
      return `/load/edit?id=${v._id}`;
    case "PAYMENT":
    case "RECEIPT":
      return `/payment/edit?id=${v._id}`;
    case "MILL_SETTLEMENT":
      return `/sale/settle?id=${v.saleId}`;
    default:
      return null;
  }
}

export function viewPathOf(v: Pick<Voucher, "_id" | "type">): string {
  switch (v.type) {
    case "PURCHASE":
      return `/purchase/view?id=${v._id}`;
    case "SALE":
      return `/sale/view?id=${v._id}`;
    case "LOAD":
      return `/load/view?id=${v._id}`;
    case "PAYMENT":
    case "RECEIPT":
      return `/payment/view?id=${v._id}`;
    default:
      return `/voucher/view?id=${v._id}`;
  }
}

const PRINTABLE = new Set(["PURCHASE", "SALE", "PAYMENT", "RECEIPT"]);

/** Common voucher view (spec §9 + §9 "every voucher view shows…"). */
export function VoucherView({ id }: { id: string | undefined }) {
  const { t, money, date } = useI18n();
  const router = useRouter();
  const role = useGodownRole();
  const v = useLiveQuery(async () => (id ? ((await db().vouchers.get(id)) ?? null) : null), [id]);
  const names = useNames(v ? v.godownId : null);
  const group = useLiveQuery(async () => (v ? await groupOf(v) : []), [v?._id, v?.rev]);
  const session = useLiveQuery(() => getSession(), []);
  const history = useLiveQuery(
    async () =>
      id
        ? await db()
            .auditLocal.filter((a) => a.entityId === id)
            .toArray()
        : [],
    [id],
  );
  const settlement = useLiveQuery(
    async () =>
      v && v.type === "SALE"
        ? ((await db()
            .vouchers.where("[godownId+type+date]")
            .between([v.godownId, "MILL_SETTLEMENT", ""], [v.godownId, "MILL_SETTLEMENT", "￿"])
            .filter(
              (x) => x.status === "active" && x.type === "MILL_SETTLEMENT" && x.saleId === v._id,
            )
            .first()) ?? null)
        : null,
    [v?._id, v?.rev],
  );
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (v === undefined || !names || group === undefined) return <Loading />;
  if (v === null) return <ReadOnlyNotice reason="notFound" />;

  const primary = groupPrimary(group);
  const linked = v.status === "active" && primary !== undefined && primary._id !== v._id;
  const isVoid = v.status === "void";
  const canEdit =
    !isVoid && !linked && role !== null && role !== "viewer" && editPathOf(v) !== null;
  const canVoid = !isVoid && !linked && role === "owner";
  const createdBy =
    session && session.user._id === v.createdBy ? session.user.name : t("voucher.otherUser");

  const doVoid = async () => {
    try {
      if (v.type === "DAY_CLOSE") await unlockDay(v.godownId, v.date, reason);
      else if (isTransfer(v)) await voidTransfer(v.godownId, v._id, reason);
      else await voidVoucher(v.godownId, v._id, reason);
      setVoidOpen(false);
      toast.success(t("voucher.voided"));
    } catch (e) {
      toast.error(t(errorKey(e)));
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="voucher-view">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <span className={isVoid ? "line-through" : ""} data-testid="voucher-number">
              {v.number}
            </span>
            <Badge variant="secondary">{t(`voucherType.${v.type}` as TKey)}</Badge>
            {isVoid ? <Badge variant="destructive">{t("voucher.void")}</Badge> : null}
            <SyncIcon
              entityId={v._id}
              {...(v.serverSeq !== undefined ? { serverSeq: v.serverSeq } : {})}
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <Row label={t("common.date")} value={date(v.date)} />
          <Row
            label={t("voucher.createdBy")}
            value={`${createdBy} · ${new Date(v.createdAt).toLocaleString()}`}
          />
          {v.season ? (
            <Row label={t("form.season")} value={t(`season.${v.season}` as TKey)} />
          ) : null}
          {v.rev > 1 ? <Row label={t("voucher.revision")} value={String(v.rev)} /> : null}
          {isVoid && v.voidReason ? (
            <Row
              label={t("voucher.voidReason")}
              value={v.voidReason === LINKED_REMOVED ? t("voucher.linkedRemoved") : v.voidReason}
            />
          ) : null}
          {v.editReason ? <Row label={t("voucher.editReason")} value={v.editReason} /> : null}
        </CardContent>
      </Card>

      {linked && primary ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          data-testid="linked-notice"
        >
          <Link2 className="size-4" aria-hidden />
          <span className="flex-1">{t("voucher.linkedReadOnly")}</span>
          <Link className="text-primary min-h-11 py-3 underline" href={viewPathOf(primary)}>
            {primary.number}
          </Link>
        </div>
      ) : null}

      <Card className={isVoid ? "opacity-70" : ""}>
        <CardContent className="flex flex-col gap-2 pt-6 text-sm">
          <Body v={v} names={names} money={money} settlement={settlement ?? null} />
          {v.notes ? <Row label={t("common.notes")} value={v.notes} /> : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <Button
            className="h-11"
            onClick={() => router.push(editPathOf(v)!)}
            data-testid="voucher-edit"
          >
            <Pencil className="size-4" aria-hidden />
            {t("common.edit")}
          </Button>
        ) : null}
        {v.type === "SALE" && !isVoid && role !== "viewer" && !isTransfer(v) ? (
          <Button
            variant="outline"
            className="h-11"
            onClick={() => router.push(`/sale/settle?id=${v._id}`)}
            data-testid="sale-settle"
          >
            <Scale className="size-4" aria-hidden />
            {settlement ? t("sale.editSettlement") : t("sale.enterMillWeight")}
          </Button>
        ) : null}
        {PRINTABLE.has(v.type) ? (
          <Button
            variant="outline"
            className="h-11"
            onClick={() => router.push(`/print/voucher?id=${v._id}`)}
            data-testid="voucher-print"
          >
            <Printer className="size-4" aria-hidden />
            {t("common.shareReceipt")}
          </Button>
        ) : null}
        {canVoid ? (
          <Button
            variant="destructive"
            className="h-11"
            onClick={() => setVoidOpen(true)}
            data-testid="voucher-void"
          >
            <Ban className="size-4" aria-hidden />
            {v.type === "DAY_CLOSE" ? t("dayClose.unlock") : t("common.void")}
          </Button>
        ) : null}
      </div>

      {isTransfer(v) && "interGodown" in v && v.interGodown ? <TransferNotice v={v} /> : null}

      {group.length > 1 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("voucher.linkedVouchers")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {group
                .filter((g) => g._id !== v._id)
                .map((g) => (
                  <li key={g._id}>
                    <Link
                      href={viewPathOf(g)}
                      className="hover:bg-muted flex min-h-11 items-center justify-between gap-2 rounded-md px-2"
                    >
                      <span className={g.status === "void" ? "line-through" : ""}>
                        {dot(t(`voucherType.${g.type}` as TKey), g.number)}
                      </span>
                      <span className="tabular">{money(amountOf(g))}</span>
                    </Link>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {(role === "owner" || role === "manager") && history && history.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("voucher.history")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex justify-between gap-2">
                  <span>
                    {dot(
                      t(`voucher.action.${h.action}` as TKey),
                      h.rev ? spaced(t("voucher.revision"), h.rev) : null,
                      h.reason
                        ? h.reason === LINKED_REMOVED
                          ? t("voucher.linkedRemoved")
                          : h.reason
                        : null,
                    )}
                  </span>
                  <span className="text-muted-foreground">{new Date(h.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("voucher.voidTitle")}</DialogTitle>
            <DialogDescription>{t("voucher.voidBody")}</DialogDescription>
          </DialogHeader>
          <TextField
            label={t("voucher.voidReason")}
            value={reason}
            onChange={setReason}
            required
            testId="void-reason"
          />
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setVoidOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              disabled={!reason.trim()}
              onClick={() => void doVoid()}
              data-testid="void-confirm"
            >
              {t("common.void")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { amountOf };

/** Which godown is on the other side of a transfer, and its entry (when visible here). */
function TransferNotice({ v }: { v: Voucher }) {
  const { t } = useI18n();
  const ig = "interGodown" in v ? v.interGodown : undefined;
  const info = useLiveQuery(async () => {
    if (!ig || !v.groupId) return null;
    const g = await db().godowns.get(ig.counterGodownId);
    const other = await db()
      .vouchers.where("[godownId+groupId]")
      .equals([ig.counterGodownId, v.groupId])
      .first();
    return { name: g?.name ?? "", other: other ?? null };
  }, [v._id, v.rev]);
  if (!ig || !info) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
      data-testid="transfer-notice"
    >
      <Link2 className="size-4" aria-hidden />
      <span className="flex-1">
        {dot(
          ig.side === "SEND" ? t("transfer.sent") : t("transfer.accepted"),
          info.name ? t("godown.otherGodownParty", { name: info.name }) : null,
        )}
      </span>
      {info.other ? (
        <span className="text-muted-foreground">
          {dot(t("transfer.counterpart"), info.other.number)}
        </span>
      ) : null}
    </div>
  );
}

export function Row({
  label,
  value,
  testId,
}: {
  label: string;
  value: ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="tabular min-w-0 text-right break-words" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

function LinesTable({ lines, names }: { lines: TradeLine[]; names: Names }) {
  const { t, weightOf, rate, money } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      {lines.map((l, i) => {
        const d = computeDeductions(lineInputFromJson(l));
        const ded = BigInt(l.grossG) - BigInt(l.netG);
        return (
          <div
            key={i}
            className="flex flex-col gap-1 rounded-md border p-2"
            data-testid={`view-line-${i}`}
          >
            <div className="font-medium">{names.variety(l.varietyId)}</div>
            {l.bags !== undefined ? <Row label={t("units.bag")} value={String(l.bags)} /> : null}
            <Row label={t("trade.grossWeight")} value={weightOf(BigInt(l.grossG))} />
            {ded > 0n ? (
              <Row
                label={t("trade.deductions")}
                value={`${weightOf(ded)}${d.moistureG > 0n ? ` (${t("trade.moistureCut")}: ${weightOf(d.moistureG)})` : ""}`}
              />
            ) : null}
            <Row label={t("trade.netWeight")} value={weightOf(BigInt(l.netG))} />
            <Row label={t("trade.rate")} value={rate(BigInt(l.ratePaisePerQtl))} />
            <Row label={t("trade.lineAmount")} value={money(BigInt(l.amountPaise))} />
          </div>
        );
      })}
    </div>
  );
}

function Body({
  v,
  names,
  money,
  settlement,
}: {
  v: Voucher;
  names: Names;
  money: (p: bigint) => string;
  settlement: Voucher | null;
}) {
  const { t, weightOf, rate, date } = useI18n();
  switch (v.type) {
    case "PURCHASE":
      return (
        <>
          <Row label={t("purchase.farmer")} value={names.party(v.partyId)} testId="view-party" />
          <Row
            label={t("purchase.whereTo")}
            value={v.storeAt === "STORE" ? t("purchase.storeInGodown") : t("purchase.directLoad")}
          />
          <LinesTable lines={v.lines} names={names} />
          {v.charges.map((c, i) => (
            <Row
              key={i}
              label={c.label}
              value={`${c.kind === "add" ? "+" : "−"}${money(BigInt(c.amountPaise))}`}
            />
          ))}
          <Row label={t("trade.roundOff")} value={money(BigInt(v.roundOffPaise))} />
          <Row
            label={t("common.total")}
            value={<strong>{money(BigInt(v.totalPaise))}</strong>}
            testId="view-total"
          />
          {v.paidNow ? (
            <Row
              label={t("purchase.paidNow")}
              value={`${money(BigInt(v.paidNow.amountPaise))} · ${t(`payMode.${v.paidNow.mode}` as TKey)}`}
            />
          ) : null}
          {v.dueDate ? <Row label={t("purchase.dueDate")} value={date(v.dueDate)} /> : null}
        </>
      );
    case "SALE": {
      const s = saleSummary(v);
      return (
        <>
          <Row label={t("sale.party")} value={names.party(v.partyId)} testId="view-party" />
          {v.millPartyId ? <Row label={t("sale.mill")} value={names.party(v.millPartyId)} /> : null}
          {v.vehicleNumber ? (
            <Row label={t("sale.vehicleNumber")} value={formatVehicleNumber(v.vehicleNumber)} />
          ) : null}
          <Row
            label={t("sale.source")}
            value={v.source === "STORE" ? t("sale.fromStore") : t("purchase.directLoad")}
          />
          <LinesTable lines={v.lines} names={names} />
          <Row
            label={t("sale.goodsValue")}
            value={<strong>{money(s.goodsValue)}</strong>}
            testId="view-total"
          />
          {s.freight > 0n ? (
            <Row
              label={t("sale.freight")}
              value={`${money(s.freight)} · ${t(`sale.payer.${v.delivery!.payer}` as TKey)}`}
            />
          ) : null}
          {s.loading > 0n ? <Row label={t("sale.loading")} value={money(s.loading)} /> : null}
          {s.vehicleAdvance > 0n ? (
            <Row label={t("sale.vehicleAdvance")} value={money(s.vehicleAdvance)} />
          ) : null}
          {s.advanceReceived > 0n ? (
            <Row label={t("sale.advanceReceived")} value={money(s.advanceReceived)} />
          ) : null}
          <Row label={t("sale.netReceivable")} value={money(s.netReceivable)} />
          <Row
            label={t("sale.settlementStatus")}
            value={
              <Badge variant={v.settlementStatus === "SETTLED" ? "default" : "secondary"}>
                {v.settlementStatus === "SETTLED" ? t("sale.settled") : t("sale.pending")}
              </Badge>
            }
            testId="view-settlement-status"
          />
          {settlement && settlement.type === "MILL_SETTLEMENT" ? (
            <div
              className="flex flex-col gap-1 rounded-md border p-2"
              data-testid="view-settlement"
            >
              <Row label={t("sale.millNet")} value={weightOf(BigInt(settlement.millNetG))} />
              <Row
                label={t("sale.finalAmount")}
                value={money(BigInt(settlement.finalAmountPaise))}
              />
              <Row label={t("sale.difference")} value={money(BigInt(settlement.differencePaise))} />
              <Row
                label={t("sale.shortage")}
                value={<Qty grams={BigInt(settlement.shortageG)} testId="view-shortage" />}
              />
            </div>
          ) : null}
          {v.expectedPaymentDate ? (
            <Row label={t("sale.expectedPaymentDate")} value={date(v.expectedPaymentDate)} />
          ) : null}
        </>
      );
    }
    case "LOAD":
      return (
        <>
          <Row
            label={t("load.mode")}
            value={v.mode === "OWN_TRADE" ? t("load.modeOwn") : t("load.modeAgent")}
          />
          <Row
            label={t("load.loadPlace")}
            value={names.place(v.loadPlaceId) || v.loadPlaceText || "—"}
          />
          <Row
            label={t("load.from")}
            value={v.fromStore ? t("load.fromStore") : names.party(v.fromPartyId)}
          />
          <Row label={t("load.toMill")} value={names.party(v.toMillPartyId)} />
          {v.secondPartyId ? (
            <Row label={t("load.secondParty")} value={names.party(v.secondPartyId)} />
          ) : null}
          <Row label={t("sale.vehicleNumber")} value={formatVehicleNumber(v.vehicleNumber)} />
          <Row label={t("trade.variety")} value={names.variety(v.varietyId)} />
          {v.bags !== undefined ? <Row label={t("units.bag")} value={String(v.bags)} /> : null}
          <Row label={t("trade.grossWeight")} value={weightOf(BigInt(v.grossG))} />
          <Row label={t("trade.netWeight")} value={weightOf(BigInt(v.netG))} />
          {v.partySellRatePaisePerQtl ? (
            <Row label={t("load.partySell")} value={rate(BigInt(v.partySellRatePaisePerQtl))} />
          ) : null}
          {v.millRatePaisePerQtl ? (
            <Row label={t("load.millRate")} value={rate(BigInt(v.millRatePaisePerQtl))} />
          ) : null}
          {v.mode === "OWN_TRADE" ? (
            <Row
              label={t("load.saleAmount")}
              value={money(BigInt(v.totalAmountPaise))}
              testId="view-total"
            />
          ) : null}
          {v.mode === "OWN_TRADE" && !v.fromStore ? (
            <Row label={t("load.margin")} value={money(loadMargin(v))} />
          ) : null}
          {v.commission ? (
            <Row label={t("load.commission")} value={money(BigInt(v.commission.amountPaise))} />
          ) : null}
        </>
      );
    case "PAYMENT":
    case "RECEIPT":
      return (
        <>
          <Row
            label={v.type === "RECEIPT" ? t("payment.fromParty") : t("payment.toParty")}
            value={names.party(v.partyId)}
            testId="view-party"
          />
          <Row
            label={t("common.amount")}
            value={<strong>{money(BigInt(v.amountPaise))}</strong>}
            testId="view-total"
          />
          <Row label={t("payment.mode")} value={t(`payMode.${v.mode}` as TKey)} />
          {v.ourBankAccountId ? (
            <Row label={t("payment.ourBank")} value={names.bank(v.ourBankAccountId)} />
          ) : null}
          {v.theirBankText ? <Row label={t("payment.theirBank")} value={v.theirBankText} /> : null}
          {v.utrOrRef ? <Row label={t("payment.utrOrRef")} value={v.utrOrRef} /> : null}
          {v.chequeNo ? <Row label={t("payment.chequeNo")} value={v.chequeNo} /> : null}
          {v.chequeDate ? <Row label={t("payment.chequeDate")} value={date(v.chequeDate)} /> : null}
          {v.cashVia?.vehicleNumber ? (
            <Row
              label={t("payment.viaVehicle")}
              value={formatVehicleNumber(v.cashVia.vehicleNumber)}
            />
          ) : null}
          {v.cashVia?.personName ? (
            <Row label={t("payment.viaPerson")} value={v.cashVia.personName} />
          ) : null}
          {v.type === "RECEIPT" && v.tdsPaise ? (
            <Row label={t("payment.tds")} value={money(BigInt(v.tdsPaise))} />
          ) : null}
          <Row
            label={t("payment.purpose")}
            value={t(
              `payment.purpose${v.purpose === "BILL" ? "Bill" : v.purpose === "ADVANCE" ? "Advance" : "Other"}` as TKey,
            )}
          />
          {v.dueDate ? <Row label={t("payment.advanceDueDate")} value={date(v.dueDate)} /> : null}
        </>
      );
    case "MILL_SETTLEMENT":
      return (
        <>
          <Row label={t("sale.party")} value={names.party(v.partyId)} />
          <Row label={t("sale.dispatchedNet")} value={weightOf(BigInt(v.dispatchedNetG))} />
          <Row label={t("sale.millGross")} value={weightOf(BigInt(v.millReceivedGrossG))} />
          <Row label={t("sale.millNet")} value={weightOf(BigInt(v.millNetG))} />
          <Row label={t("sale.finalRate")} value={rate(BigInt(v.finalRatePaisePerQtl))} />
          <Row label={t("sale.finalAmount")} value={money(BigInt(v.finalAmountPaise))} />
          <Row label={t("sale.difference")} value={money(BigInt(v.differencePaise))} />
          <Row label={t("sale.shortage")} value={weightOf(BigInt(v.shortageG))} />
        </>
      );
    case "EXPENSE":
      return (
        <>
          <Row label={t("expense.description")} value={v.description} />
          <Row
            label={t("exp.category")}
            value={<CategoryName godownId={v.godownId} code={v.categoryCode} />}
          />
          <Row
            label={t("common.amount")}
            value={<strong>{money(BigInt(v.amountPaise))}</strong>}
            testId="view-total"
          />
          <Row
            label={t("payment.mode")}
            value={v.onCredit ? t("exp.onCredit") : t(`payMode.${v.mode}` as TKey)}
          />
          {v.bankAccountId ? (
            <Row label={t("payment.ourBank")} value={names.bank(v.bankAccountId)} />
          ) : null}
          {v.payeePartyId || v.payeeText ? (
            <Row label={t("exp.payee")} value={names.party(v.payeePartyId) || v.payeeText} />
          ) : null}
          {v.vehicleId ? (
            <Row label={t("trip.vehicle")} value={names.vehicle(v.vehicleId)} />
          ) : null}
        </>
      );
    case "TRIP": {
      return (
        <>
          <Row label={t("trip.vehicle")} value={names.vehicle(v.vehicleId)} />
          {v.driverPartyId ? (
            <Row label={t("trip.driver")} value={names.party(v.driverPartyId)} />
          ) : null}
          <Row label={t("trip.loadingPlace")} value={v.loadingPlace || "—"} />
          <Row label={t("trip.unloadingPlace")} value={v.unloadingPlace || "—"} />
          {v.hirerPartyId ? (
            <Row label={t("trip.hirer")} value={names.party(v.hirerPartyId)} />
          ) : null}
          {v.qtyG ? <Row label={t("trip.qty")} value={weightOf(BigInt(v.qtyG))} /> : null}
          {v.ownTradeLoadId ? <Row label={t("trip.ownTrade")} value={t("common.yes")} /> : null}
          <Row
            label={t("trip.freight")}
            value={<strong>{money(BigInt(v.freightPaise))}</strong>}
            testId="view-total"
          />
          {v.advanceReceivedPaise ? (
            <Row label={t("trip.advance")} value={money(BigInt(v.advanceReceivedPaise))} />
          ) : null}
          <Row label={t("trip.due")} value={money(BigInt(v.duePaise))} />
          {v.expenses.map((e, i) => (
            <Row
              key={i}
              label={t(`vehicle.expenseKind.${e.kind}` as TKey)}
              value={money(BigInt(e.amountPaise))}
            />
          ))}
          <Row label={t("trip.profit")} value={money(tripProfit(v))} />
        </>
      );
    }
    case "CONTRA":
      return (
        <>
          <Row label={t("voucherType.CONTRA")} value={t(`cashbank.kind.${v.kind}` as TKey)} />
          <Row
            label={t("common.amount")}
            value={<strong>{money(BigInt(v.amountPaise))}</strong>}
            testId="view-total"
          />
          {v.bankAccountId ? (
            <Row
              label={v.kind === "BANK_TRANSFER" ? t("cashbank.fromBank") : t("cashbank.bank")}
              value={names.bank(v.bankAccountId)}
            />
          ) : null}
          {v.toBankAccountId ? (
            <Row label={t("cashbank.toBank")} value={names.bank(v.toBankAccountId)} />
          ) : null}
          {v.partyId ? <Row label={t("sale.party")} value={names.party(v.partyId)} /> : null}
        </>
      );
    case "STOCK_ADJUST":
      return (
        <>
          {v.lines.map((l, i) => (
            <Row
              key={i}
              label={dot(names.variety(l.varietyId), t(`stock.adjustReason.${l.reason}` as TKey))}
              value={<Qty grams={BigInt(l.qtyG)} />}
            />
          ))}
        </>
      );
    case "DAY_CLOSE": {
      const diff = BigInt(v.differencePaise);
      return (
        <>
          <Row label={t("dayClose.expected")} value={money(BigInt(v.expectedCashPaise))} />
          <Row label={t("dayClose.counted")} value={money(BigInt(v.countedCashPaise))} />
          <Row
            label={t("dayClose.difference")}
            value={
              diff === 0n
                ? t("dayClose.matched")
                : diff < 0n
                  ? t("dayClose.short", { amount: money(-diff) })
                  : t("dayClose.excess", { amount: money(diff) })
            }
            testId="view-total"
          />
        </>
      );
    }
    case "OPENING":
      return (
        <>
          {v.items.map((it, i) => (
            <Row
              key={i}
              label={
                it.kind === "PARTY"
                  ? names.party(it.refId)
                  : it.kind === "BANK"
                    ? names.bank(it.refId)
                    : it.kind === "STOCK"
                      ? dot(names.variety(it.varietyId), it.qtyG ? weightOf(BigInt(it.qtyG)) : null)
                      : t(it.kind === "CASH" ? "account.CASH" : "account.CAPITAL")
              }
              value={money(BigInt(it.amountPaise))}
            />
          ))}
        </>
      );
    default:
      return <Row label={t("common.amount")} value={money(amountOf(v))} />;
  }
}

function CategoryName({ godownId, code }: { godownId: string; code: string }) {
  const { t } = useI18n();
  const c = useLiveQuery(
    () => db().expenseCategories.where("[godownId+code]").equals([godownId, code]).first(),
    [godownId, code],
  );
  return <>{c ? categoryLabel(c, t) : code}</>;
}

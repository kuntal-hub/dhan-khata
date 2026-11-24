"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { HandCoins, MessageCircle, Pencil, Phone, Printer, Merge, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BottomSheet } from "@/components/forms/BottomSheet";
import { Choice, DateField, SeasonField } from "@/components/forms/fields";
import { BankPicker, PartyPicker, VarietyPicker } from "@/components/forms/pickers";
import { Balance } from "@/components/money/display";
import { EmptyState, Loading } from "@/components/lists/common";
import { useVirtualRows } from "@/components/lists/VirtualList";
import { ReadOnlyNotice, useWriteGodown } from "@/components/system/page";
import { VoucherRow } from "@/components/vouchers/VoucherList";
import { Row, viewPathOf } from "@/components/vouchers/VoucherView";
import { useNames } from "@/components/vouchers/names";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useGodownRole } from "@/client/hooks";
import { mergePartiesOnline } from "@/client/party/merge";
import {
  partyAging,
  partyBalances,
  partyBills,
  partyStatement,
  partyVouchers,
  purchaseHistory,
} from "@/client/queries/parties";
import { getSyncEngine } from "@/client/sync/instance";
import { partyTitle } from "@/client/ui/labels";
import { dot } from "@/client/ui/text";
import { AGING_BUCKETS } from "@/domain/aging";
import { todayIST } from "@/domain/dates";
import type { Party } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { Lang, TKey } from "@/i18n/translate";
import { translate } from "@/i18n/translateAll";

const TABS = ["summary", "khata", "purchases", "sales", "payments", "loads", "reminders"] as const;
type Tab = (typeof TABS)[number];

export function PartyProfile({ id, tab }: { id: string | undefined; tab: string | undefined }) {
  const { t, lang } = useI18n();
  const { godownId } = useWriteGodown();
  const party = useLiveQuery(
    async () => (id ? ((await db().parties.get(id)) ?? null) : null),
    [id],
  );
  const [current, setCurrent] = useState<Tab>(
    (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "summary",
  );
  if (party === undefined || !godownId) return <Loading />;
  if (!party || party.godownId !== godownId) return <ReadOnlyNotice reason="notFound" />;
  const { title, sub } = partyTitle(party, lang);
  return (
    <div className="flex flex-col gap-3" data-testid="party-profile">
      <div className="flex flex-col">
        <h1 className="text-xl font-semibold" data-testid="party-title">
          {title}
        </h1>
        <p className="text-muted-foreground text-sm">
          {[
            sub,
            party.village,
            party.phone,
            party.roles.map((r) => t(`partyRole.${r}` as TKey)).join(", "),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {party.status === "void" ? <Badge variant="destructive">{t("party.merged")}</Badge> : null}
      </div>
      <Tabs value={current} onValueChange={(v) => setCurrent(v as Tab)}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          {TABS.map((x) => (
            <TabsTrigger key={x} value={x} className="min-h-11" data-testid={`party-tab-${x}`}>
              {t(`party.tab.${x}` as TKey)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="summary">
          <Summary party={party} godownId={godownId} />
        </TabsContent>
        <TabsContent value="khata">
          <Khata party={party} godownId={godownId} />
        </TabsContent>
        <TabsContent value="purchases">
          <Purchases party={party} godownId={godownId} />
        </TabsContent>
        <TabsContent value="sales">
          <TypeList party={party} godownId={godownId} types={["SALE"]} />
        </TabsContent>
        <TabsContent value="payments">
          <TypeList party={party} godownId={godownId} types={["PAYMENT", "RECEIPT"]} />
        </TabsContent>
        <TabsContent value="loads">
          <TypeList party={party} godownId={godownId} types={["LOAD"]} />
        </TabsContent>
        <TabsContent value="reminders">
          <Reminders party={party} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** WhatsApp "তাগাদা" text in the chosen language (spec §9.6). */
export function reminderText(lang: Lang, name: string, amount: string, firm: string): string {
  return translate(lang, "whatsapp.reminder", { name, amount, firm });
}

export function waLink(phone: string | undefined, text: string): string {
  const p = phone ? `91${phone}` : "";
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

function Summary({ party, godownId }: { party: Party; godownId: string }) {
  const { t, money, date, lang } = useI18n();
  const router = useRouter();
  const role = useGodownRole();
  const [waLang, setWaLang] = useState<Lang>(lang);
  const [mergeOpen, setMergeOpen] = useState(false);
  const data = useLiveQuery(async () => {
    const [balances, aging, bills, vouchers, godown] = await Promise.all([
      partyBalances(godownId),
      partyAging(godownId, party._id, todayIST()),
      partyBills(godownId, party._id),
      partyVouchers(godownId, party._id),
      db().godowns.get(godownId),
    ]);
    return {
      balance: balances.get(party._id) ?? 0n,
      aging,
      bills,
      last: vouchers.find((v) => v.status === "active"),
      godown,
    };
  }, [godownId, party._id, party.rev]);
  if (!data) return <Loading />;
  const bal = data.balance;
  const firm = data.godown?.firmName ?? data.godown?.name ?? "";
  const amountText = money(bal >= 0n ? bal : -bal);
  const waText = reminderText(waLang, party.name, amountText, firm);
  const canWrite = role !== null && role !== "viewer";
  return (
    <div className="flex flex-col gap-3 pt-2">
      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          <span className="text-muted-foreground text-sm">{t("party.balance")}</span>
          <span className="text-2xl">
            <Balance paise={bal} testId="party-balance" />
          </span>
          {data.bills.advanceGivenPaise > 0n ? (
            <Row label={t("due.advanceGiven")} value={money(data.bills.advanceGivenPaise)} />
          ) : null}
          {data.bills.advanceTakenPaise > 0n ? (
            <Row label={t("due.advanceTaken")} value={money(data.bills.advanceTakenPaise)} />
          ) : null}
          {data.last ? <Row label={t("party.lastActivity")} value={date(data.last.date)} /> : null}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-2">
        {party.phone ? (
          <Button asChild variant="outline" className="h-11">
            <a href={`tel:+91${party.phone}`}>
              <Phone className="size-4" aria-hidden />
              {t("party.call")}
            </a>
          </Button>
        ) : null}
        {party.phone ? (
          <Button asChild variant="outline" className="h-11">
            <a href={waLink(party.phone, "")} target="_blank" rel="noreferrer">
              <MessageCircle className="size-4" aria-hidden />
              {t("party.whatsapp")}
            </a>
          </Button>
        ) : null}
        {canWrite ? (
          <>
            <Button
              className="h-11"
              onClick={() => router.push(`/payment/new?type=PAYMENT&partyId=${party._id}`)}
              data-testid="party-pay"
            >
              <Wallet className="size-4" aria-hidden />
              {t("payment.paymentGiven")}
            </Button>
            <Button
              className="h-11"
              onClick={() => router.push(`/payment/new?type=RECEIPT&partyId=${party._id}`)}
              data-testid="party-receive"
            >
              <HandCoins className="size-4" aria-hidden />
              {t("payment.moneyReceived")}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() =>
                router.push(`/payment/new?type=PAYMENT&purpose=ADVANCE&partyId=${party._id}`)
              }
            >
              {t("payment.advanceGivenShort")}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() =>
                router.push(`/payment/new?type=RECEIPT&purpose=ADVANCE&partyId=${party._id}`)
              }
            >
              {t("payment.advanceTakenShort")}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => router.push(`/party/edit?id=${party._id}`)}
              data-testid="party-edit"
            >
              <Pencil className="size-4" aria-hidden />
              {t("common.edit")}
            </Button>
          </>
        ) : null}
        <Button
          variant="outline"
          className="h-11"
          onClick={() => router.push(`/print/statement?partyId=${party._id}`)}
        >
          <Printer className="size-4" aria-hidden />
          {t("party.printStatement")}
        </Button>
        {role === "owner" ? (
          <Button variant="outline" className="h-11" onClick={() => setMergeOpen(true)}>
            <Merge className="size-4" aria-hidden />
            {t("party.mergeDuplicate")}
          </Button>
        ) : null}
      </div>
      {bal > 0n ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("party.whatsappReminder")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Choice
              value={waLang}
              onChange={setWaLang}
              options={[
                { value: "bn", label: t("lang.bn") },
                { value: "en", label: t("lang.en") },
              ]}
            />
            <p className="bg-muted rounded-md p-2 text-sm">{waText}</p>
            <Button asChild className="h-11">
              <a
                href={waLink(party.phone, waText)}
                target="_blank"
                rel="noreferrer"
                data-testid="party-wa-reminder"
              >
                <MessageCircle className="size-4" aria-hidden />
                {t("party.sendReminder")}
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("due.agingTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          {AGING_BUCKETS.map((b) => (
            <Row
              key={b}
              label={t(`due.aging.${b}` as TKey)}
              value={money(data.aging.receivable[b] + data.aging.payable[b])}
            />
          ))}
        </CardContent>
      </Card>
      <Bills party={party} godownId={godownId} />
      <MergeSheet open={mergeOpen} onOpenChange={setMergeOpen} keep={party} godownId={godownId} />
    </div>
  );
}

function Bills({ party, godownId }: { party: Party; godownId: string }) {
  const { t, money, date } = useI18n();
  const data = useLiveQuery(async () => {
    const bills = await partyBills(godownId, party._id);
    const all = [...bills.purchases, ...bills.sales];
    const vs = await db().vouchers.bulkGet(all.map((b) => b.voucherId));
    return all.map((b, i) => ({ b, v: vs[i] })).filter((x) => x.v);
  }, [godownId, party._id]);
  if (!data || data.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("due.bills")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-sm" data-testid="party-bills">
          {data.map(({ b, v }) => (
            <li key={b.voucherId} className="flex items-center justify-between gap-2 border-b py-2">
              <Link
                href={
                  v!.type === "PURCHASE" ? `/purchase/view?id=${v!._id}` : `/sale/view?id=${v!._id}`
                }
                className="min-w-0 flex-1 truncate underline"
              >
                {dot(v!.number, date(v!.date, "short"))}
              </Link>
              <span className="tabular">{money(b.outstandingPaise)}</span>
              <Badge
                variant={
                  b.status === "SETTLED"
                    ? "default"
                    : b.status === "PARTIAL"
                      ? "secondary"
                      : "outline"
                }
                data-testid={`bill-status-${v!.number}`}
              >
                {t(`due.billStatus.${b.status}` as TKey)}
              </Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Khata({ party, godownId }: { party: Party; godownId: string }) {
  const { t, money, date } = useI18n();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [bank, setBank] = useState<string | undefined>(undefined);
  const st = useLiveQuery(
    () =>
      partyStatement(
        godownId,
        party._id,
        { ...(from ? { from } : {}), ...(to ? { to } : {}) },
        bank ? { bankAccountId: bank } : {},
      ),
    [godownId, party._id, from, to, bank],
  );
  const {
    attach: attachRows,
    measureRow,
    indices: rowIdx,
    padTop,
    padBottom,
  } = useVirtualRows(st?.rows.length ?? 0);
  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="grid grid-cols-2 gap-2">
        <DateField label={t("filters.from")} value={from} optional onChange={setFrom} />
        <DateField label={t("filters.to")} value={to} optional onChange={setTo} />
        <div className="col-span-2">
          <BankPicker
            godownId={godownId}
            label={t("party.bankFilter")}
            value={bank}
            onChange={setBank}
            allowClear
          />
        </div>
      </div>
      {!st ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto rounded-md border" data-testid="party-statement">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-2 py-2 text-left font-medium">{t("common.date")}</th>
                <th className="px-2 py-2 text-left font-medium">{t("party.voucher")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("party.debit")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("party.credit")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("party.runningBalance")}</th>
              </tr>
            </thead>
            <tbody className="tabular">
              <tr className="border-t">
                <td className="px-2 py-2" colSpan={4}>
                  {t("party.opening")}
                </td>
                <td className="px-2 py-2 text-right">
                  <Balance paise={st.openingPaise} />
                </td>
              </tr>
            </tbody>
            <tbody className="tabular" ref={attachRows}>
              {padTop > 0 ? (
                <tr aria-hidden>
                  <td colSpan={5} style={{ height: padTop, padding: 0 }} />
                </tr>
              ) : null}
              {rowIdx
                .map((i) => st.rows[i]!)
                .map((r, k) => (
                  <tr
                    key={r.voucherId}
                    className="border-t"
                    data-index={rowIdx[k]}
                    ref={measureRow}
                  >
                    <td className="px-2 py-2">{date(r.date, "short")}</td>
                    <td className="px-2 py-2">
                      <Link
                        href={viewPathOf({ _id: r.voucherId, type: r.type })}
                        className="underline"
                      >
                        {dot(t(`voucherType.${r.type}` as TKey), r.number)}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {r.debitPaise > 0n ? money(r.debitPaise) : ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {r.creditPaise > 0n ? money(r.creditPaise) : ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Balance paise={r.balancePaise} />
                    </td>
                  </tr>
                ))}
              {padBottom > 0 ? (
                <tr aria-hidden>
                  <td colSpan={5} style={{ height: padBottom, padding: 0 }} />
                </tr>
              ) : null}
            </tbody>
            <tbody className="tabular">
              <tr className="bg-muted/40 border-t font-semibold">
                <td className="px-2 py-2" colSpan={2}>
                  {t("party.closing")}
                </td>
                <td className="px-2 py-2 text-right">{money(st.totalDebitPaise)}</td>
                <td className="px-2 py-2 text-right">{money(st.totalCreditPaise)}</td>
                <td className="px-2 py-2 text-right">
                  <Balance paise={st.closingPaise} testId="statement-closing" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <Button asChild variant="outline" className="h-11 self-start">
        <Link
          href={`/print/statement?partyId=${party._id}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`}
        >
          <Printer className="size-4" aria-hidden />
          {t("party.printStatement")}
        </Link>
      </Button>
    </div>
  );
}

function Purchases({ party, godownId }: { party: Party; godownId: string }) {
  const { t, money, weightOf, rate, date } = useI18n();
  const names = useNames(godownId);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [season, setSeason] = useState<string | undefined>(undefined);
  const [varietyId, setVarietyId] = useState<string | undefined>(undefined);
  const h = useLiveQuery(
    () =>
      purchaseHistory(godownId, party._id, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(season ? { season } : {}),
        ...(varietyId ? { varietyId } : {}),
      }),
    [godownId, party._id, from, to, season, varietyId],
  );
  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="grid grid-cols-2 gap-2">
        <DateField label={t("filters.from")} value={from} optional onChange={setFrom} />
        <DateField label={t("filters.to")} value={to} optional onChange={setTo} />
        <div className="col-span-2">
          <SeasonField value={season} onChange={(s) => setSeason(season === s ? undefined : s)} />
        </div>
        <div className="col-span-2">
          <VarietyPicker
            godownId={godownId}
            label={t("trade.variety")}
            value={varietyId}
            onChange={setVarietyId}
            allowClear
          />
        </div>
      </div>
      {!h || !names ? (
        <Loading />
      ) : (
        <>
          <Card>
            <CardContent
              className="grid grid-cols-2 gap-2 pt-6 text-sm"
              data-testid="purchase-history-summary"
            >
              <Row label={t("party.totalQty")} value={weightOf(h.totalNetG)} />
              <Row label={t("party.totalAmount")} value={money(h.totalAmountPaise)} />
              <Row label={t("party.totalPaid")} value={money(h.totalPaidPaise)} />
              <Row label={t("party.avgRate")} value={rate(h.avgRatePaisePerQtl)} />
              <div className="col-span-2">
                <Row label={t("party.balance")} value={<Balance paise={h.balancePaise} />} />
              </div>
            </CardContent>
          </Card>
          {h.rows.length === 0 ? (
            <EmptyState text={t("filters.empty")} />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    {[
                      t("common.date"),
                      t("party.billNo"),
                      t("trade.variety"),
                      t("units.bag"),
                      t("trade.netWeight"),
                      t("trade.rate"),
                      t("common.amount"),
                      t("party.paid"),
                      t("party.due"),
                    ].map((x) => (
                      <th key={x} className="px-2 py-2 text-left font-medium">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {h.rows.map(({ voucher: v, netG, bags, bill }) => (
                    <tr key={v._id} className="border-t">
                      <td className="px-2 py-2">{date(v.date, "short")}</td>
                      <td className="px-2 py-2">
                        <Link href={`/purchase/view?id=${v._id}`} className="underline">
                          {v.number}
                        </Link>
                      </td>
                      <td className="px-2 py-2">
                        {v.type === "PURCHASE"
                          ? v.lines.map((l) => names.variety(l.varietyId)).join(", ")
                          : ""}
                      </td>
                      <td className="px-2 py-2 text-right">{bags || ""}</td>
                      <td className="px-2 py-2 text-right">{weightOf(netG)}</td>
                      <td className="px-2 py-2 text-right">
                        {v.type === "PURCHASE" && v.lines.length === 1
                          ? rate(BigInt(v.lines[0]!.ratePaisePerQtl))
                          : ""}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {v.type === "PURCHASE" ? money(BigInt(v.totalPaise)) : ""}
                      </td>
                      <td className="px-2 py-2 text-right">{money(bill?.paidPaise ?? 0n)}</td>
                      <td className="px-2 py-2 text-right">
                        {money(bill?.outstandingPaise ?? 0n)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TypeList({ party, godownId, types }: { party: Party; godownId: string; types: string[] }) {
  const { t } = useI18n();
  const names = useNames(godownId);
  const list = useLiveQuery(
    async () => (await partyVouchers(godownId, party._id)).filter((v) => types.includes(v.type)),
    [godownId, party._id, types.join()],
  );
  if (!list || !names) return <Loading />;
  if (list.length === 0) return <EmptyState text={t("filters.empty")} />;
  return (
    <ul className="pt-2">
      {list.map((v) => (
        <li key={v._id}>
          <VoucherRow
            v={v}
            partyName={names.party(
              "partyId" in v
                ? (v.partyId as string)
                : v.type === "LOAD"
                  ? v.toMillPartyId
                  : undefined,
            )}
          />
        </li>
      ))}
    </ul>
  );
}

function Reminders({ party }: { party: Party }) {
  const { t, money, date } = useI18n();
  const list = useLiveQuery(
    () => db().reminders.where("partyId").equals(party._id).toArray(),
    [party._id],
  );
  if (!list) return <Loading />;
  const open = list
    .filter((r) => r.status !== "done")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  if (open.length === 0) return <EmptyState text={t("party.noReminders")} />;
  return (
    <ul className="flex flex-col gap-1 pt-2 text-sm" data-testid="party-reminders">
      {open.map((r) => (
        <li key={r._id} className="flex justify-between gap-2 border-b py-2">
          <span>{r.title || t(`reminder.kind.${r.kind}` as TKey)}</span>
          <span className="tabular">
            {dot(date(r.dueDate, "short"), r.amountPaise ? money(BigInt(r.amountPaise)) : null)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Owner-only, online: re-point every voucher of a duplicate to this party (server batch). */
function MergeSheet({
  open,
  onOpenChange,
  keep,
  godownId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  keep: Party;
  godownId: string;
}) {
  const { t } = useI18n();
  const [drop, setDrop] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!drop || drop === keep._id) return;
    setBusy(true);
    try {
      await mergePartiesOnline(godownId, keep._id, drop);
      await getSyncEngine().syncNow();
      toast.success(t("party.mergeDone"));
      onOpenChange(false);
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("party.mergeDuplicate")}
      description={t("party.mergeHint", { name: keep.name })}
    >
      <PartyPicker
        godownId={godownId}
        label={t("party.mergeDrop")}
        value={drop}
        onChange={setDrop}
      />
      <Button
        className="h-12"
        variant="destructive"
        disabled={!drop || drop === keep._id || busy}
        onClick={() => void run()}
      >
        {t("party.mergeConfirm")}
      </Button>
    </BottomSheet>
  );
}

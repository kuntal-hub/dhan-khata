"use client";

/**
 * Dashboard → ক্যাশবই (requirement_v2 §12.1B). Any date (◀ ▶); cash book or one bank book. Lines:
 * শুরুর নগদ, নগদ পেলাম, নগদ দিলাম, নগদ খরচ, দিনশেষে থাকার কথা (formula shown), আসল নগদ, কম / বেশি,
 * bank balances. The day's entries in three groups, each linked to its source ("সংশোধন" opens
 * it). Day close with the note-counting helper; the owner can reopen. Money moves: ব্যাংকে জমা,
 * ব্যাংক থেকে তোলা, bank → bank, মূলধন, মালিকের তোলা; opening cash once.
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Lock, RotateCcw } from "lucide-react";
import { docPath } from "@/components/entry/docPath";
import { docTitle } from "@/components/entry/docLabel";
import { BankPicker, FieldBox } from "@/components/entry/Fields";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { Panel, Skeleton } from "@/components/kit/Kit";
import { AmountInput } from "@/components/money/inputs";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { lazyToast } from "@/components/system/IdleToaster";
import { useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useGodownRole } from "@/client/hooks";
import { cashbookView, partyIdOf, type CashbookView } from "@/client/queries/dashboard";
import {
  closeDay,
  hasOpeningCash,
  reopenDay,
  saveContra,
  saveOpeningCash,
  type ContraKind,
  voidDoc,
} from "@/client/repo";
import { parseAmountField } from "@/client/ui/parse";
import { addDays, todayIST } from "@/domain/dates";
import type { CashEffect } from "@/domain/v2/cashbook";
import type { Doc, Party } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

const NOTES = [500, 200, 100, 50, 20, 10] as const;

function Line({
  label,
  paise,
  testId,
  strong,
  sign,
}: {
  label: string;
  paise: bigint;
  testId: string;
  strong?: boolean;
  sign?: "+" | "−";
}) {
  const { money } = useI18n();
  return (
    <div className={cn("flex items-baseline justify-between py-1.5", strong && "border-t pt-2.5")}>
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span
        className={cn("tabular", strong ? "text-xl font-semibold" : "text-[15px]")}
        data-testid={testId}
        data-paise={paise.toString()}
      >
        {sign ? `${sign} ` : ""}
        {money(paise)}
      </span>
    </div>
  );
}

function Items({
  title,
  list,
  docs,
  parties,
  onVoid,
}: {
  title: string;
  list: readonly CashEffect[];
  docs: Map<string, Doc>;
  parties: Map<string, Party>;
  onVoid?: (d: Doc) => void;
}) {
  const { t, money } = useI18n();
  return (
    <div className="flex flex-col">
      <h3 className="text-muted-foreground mb-1 text-xs font-medium">{title}</h3>
      {list.length === 0 ? (
        <p className="text-muted-foreground py-1 text-sm">{t("cb.noItems")}</p>
      ) : (
        <ul className="divide-y">
          {list.map((e, i) => {
            const d = docs.get(e.docId);
            const pid = d ? partyIdOf(d) : undefined;
            const who = pid ? parties.get(pid)?.name : undefined;
            const href = d ? docPath(d) : undefined;
            const abs = e.signedPaise < 0n ? -e.signedPaise : e.signedPaise;
            return (
              <li
                key={`${e.docId}:${i}`}
                className="flex items-center gap-2 py-2"
                data-testid="cb-item"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">
                    {d
                      ? docTitle(
                          d,
                          t,
                          who,
                          d.type === "PAYMENT" && d.source.id
                            ? docs.get(d.source.id.split(":")[0]!)
                            : undefined,
                        ).title
                      : t(`voucherType.${e.docType}` as TKey)}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {d
                      ? docTitle(
                          d,
                          t,
                          who,
                          d.type === "PAYMENT" && d.source.id
                            ? docs.get(d.source.id.split(":")[0]!)
                            : undefined,
                        ).subtitle
                      : t(`voucherType.${e.docType}` as TKey)}
                  </span>
                </span>
                <span className="tabular text-sm font-medium">{money(abs)}</span>
                {href ? (
                  <Link href={href} className="text-primary min-h-11 content-center px-1 text-xs">
                    {t("cb.correct")}
                  </Link>
                ) : d && d.type === "CONTRA" && onVoid ? (
                  <button
                    type="button"
                    className="text-primary min-h-11 px-1 text-xs"
                    onClick={() => onVoid(d)}
                    data-testid="cb-contra-correct"
                  >
                    {t("cb.correct")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CloseSheet({
  godownId,
  date,
  expected,
  onClose,
}: {
  godownId: string;
  date: string;
  expected: bigint;
  onClose: () => void;
}) {
  const { t, money, date: fmt } = useI18n();
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [coins, setCoins] = useState("");
  const [error, setError] = useState<string | null>(null);
  const a = parseAmountField(actual, true, 0n).value;
  const diff = a !== undefined ? a - expected : undefined;
  const counted =
    NOTES.reduce(
      (s, n) => s + BigInt(n) * 100n * BigInt(/^\d+$/.test(counts[n] ?? "") ? counts[n]! : "0"),
      0n,
    ) + (parseAmountField(coins, false, 0n).value ?? 0n);
  const save = async () => {
    if (a === undefined) return setError(t("acct.required"));
    if (diff !== 0n && !note.trim()) return setError(t("cb.noteRequired"));
    try {
      const den = Object.fromEntries(
        Object.entries(counts)
          .filter(([, v]) => /^\d+$/.test(v) && v !== "0")
          .map(([k, v]) => [k, Number.parseInt(v, 10)]),
      );
      await closeDay(godownId, { date, actualPaise: a, note, denominations: den });
      lazyToast(t("cb.savedClose"), "success");
      onClose();
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("cb.closeTitle", { date: fmt(date, "short") })}
      testId="close-sheet"
    >
      <div className="bg-muted/50 flex justify-between rounded-xl px-3 py-2 text-sm">
        <span>{t("cb.expected")}</span>
        <span className="tabular font-semibold">{money(expected)}</span>
      </div>
      <details className="rounded-xl border p-3">
        <summary className="min-h-10 cursor-pointer content-center text-sm font-medium">
          {t("cb.countHelp")}
        </summary>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {NOTES.map((n) => (
            <label key={n} className="flex flex-col gap-1 text-xs">
              <span className="tabular">{money(BigInt(n) * 100n)}</span>
              <Input
                inputMode="numeric"
                className="h-11 text-base"
                value={counts[n] ?? ""}
                onChange={(e) => setCounts({ ...counts, [n]: e.target.value.replace(/\D/g, "") })}
              />
            </label>
          ))}
        </div>
        <div className="mt-2">
          <AmountInput label={t("cb.coins")} value={coins} onChange={setCoins} allowZero />
        </div>
        <Button
          variant="outline"
          className="mt-2 h-11 w-full"
          onClick={() =>
            setActual(
              (counted / 100n).toString() +
                (counted % 100n ? `.${(counted % 100n).toString().padStart(2, "0")}` : ""),
            )
          }
        >
          {t("cb.useCount")} · {money(counted)}
        </Button>
      </details>
      <AmountInput
        label={t("cb.actual")}
        value={actual}
        onChange={setActual}
        required
        allowZero
        testId="cb-actual"
      />
      {diff !== undefined ? (
        <p
          className={cn(
            "rounded-xl px-3 py-2 text-sm font-medium",
            diff === 0n
              ? "bg-emerald-50 text-emerald-800"
              : diff < 0n
                ? "bg-red-50 text-red-800"
                : "bg-amber-50 text-amber-900",
          )}
          data-testid="cb-diff"
          data-paise={diff.toString()}
        >
          {diff === 0n
            ? t("cb.matched")
            : diff < 0n
              ? t("cb.short", { amount: money(-diff) })
              : t("cb.excess", { amount: money(diff) })}
        </p>
      ) : null}
      {diff !== undefined && diff !== 0n ? (
        <FieldBox label={t("cb.note")}>
          <Input
            className="h-12 text-base"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="cb-note"
          />
        </FieldBox>
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button className="h-12 text-base" onClick={() => void save()} data-testid="cb-close-save">
        {t("cb.closeDay")}
      </Button>
    </BottomSheet>
  );
}

function ContraSheet({
  godownId,
  date,
  kind,
  onClose,
}: {
  godownId: string;
  date: string;
  kind: ContraKind | "OPENING";
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [bank, setBank] = useState<string>();
  const [toBank, setToBank] = useState<string>();
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const needsBank = kind === "DEPOSIT" || kind === "WITHDRAW" || kind === "TRANSFER";
  const save = async () => {
    const a = parseAmountField(amount, true, 1n).value;
    if (a === undefined) return setError(t("acct.required"));
    try {
      if (kind === "OPENING") await saveOpeningCash(godownId, date, a);
      else
        await saveContra(godownId, {
          kind,
          date,
          amountPaise: a,
          ...(bank ? { bankAccountId: bank } : {}),
          ...(toBank ? { toBankAccountId: toBank } : {}),
          reference: ref,
        });
      lazyToast(t("cb.saved"), "success");
      onClose();
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={kind === "OPENING" ? t("cb.openingCash") : t(`cb.${kind}` as TKey)}
      {...(kind === "OPENING" ? { description: t("cb.openingCashHint") } : {})}
      testId="contra-sheet"
    >
      <AmountInput
        label={t("cb.amount")}
        value={amount}
        onChange={setAmount}
        required
        testId="contra-amount"
      />
      {kind === "OPENING" ? null : (
        <>
          <BankPicker godownId={godownId} value={bank} onChange={setBank} testId="contra-bank" />
          {!needsBank ? (
            <p className="text-muted-foreground -mt-2 text-xs">{t("cb.viaBank")}</p>
          ) : null}
          {kind === "TRANSFER" ? (
            <>
              <p className="text-muted-foreground text-xs">{t("cb.toBank")}</p>
              <BankPicker
                godownId={godownId}
                value={toBank}
                onChange={setToBank}
                testId="contra-to-bank"
              />
            </>
          ) : null}
          <FieldBox label={t("cb.reference")}>
            <Input
              className="h-12 text-base"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          </FieldBox>
        </>
      )}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button className="h-12 text-base" onClick={() => void save()} data-testid="contra-save">
        {t("common.save")}
      </Button>
    </BottomSheet>
  );
}

function sumViews(list: CashbookView[]): CashbookView {
  const out = { ...list[0]! };
  for (const v of list.slice(1)) {
    out.openingPaise += v.openingPaise;
    out.openingEntryPaise += v.openingEntryPaise;
    out.receivedPaise += v.receivedPaise;
    out.paidPaise += v.paidPaise;
    out.expensesPaise += v.expensesPaise;
    out.expectedClosingPaise += v.expectedClosingPaise;
    out.diffPaise += v.diffPaise;
    out.closingPaise += v.closingPaise;
    out.banks = [...out.banks, ...v.banks];
    out.items = {
      received: [...out.items.received, ...v.items.received],
      paid: [...out.items.paid, ...v.items.paid],
      expenses: [...out.items.expenses, ...v.items.expenses],
    };
  }
  return { ...out, closed: false, lateEntry: false };
}

export default function Cashbook() {
  const { t, money, date: fmt } = useI18n();
  const { godownId, godowns, consolidated } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const role = useGodownRole();
  const today = todayIST();
  const [day, setDay] = useState(() => {
    const p = dateFromUrl();
    return p && p <= today ? p : today;
  });
  const [book, setBook] = useState<string>("CASH");
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  const [contra, setContra] = useState<ContraKind | "OPENING" | null>(null);
  const [voiding, setVoiding] = useState<Doc | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const ids = consolidated
    ? (godowns ?? []).filter((g) => g.status === "active").map((g) => g._id)
    : godownId
      ? [godownId]
      : [];
  const data = useLiveQuery(async () => {
    if (ids.length === 0) return null;
    const views = await Promise.all(ids.map((g) => cashbookView(g, book, day)));
    const v = views.length === 1 ? views[0]! : sumViews(views);
    const docIds = [...v.items.received, ...v.items.paid, ...v.items.expenses].map((e) => e.docId);
    const first = (await db().vouchers.bulkGet(docIds)).filter((x): x is Doc => !!x);
    const srcIds = first
      .map((d) => (d.type === "PAYMENT" && d.source.id ? d.source.id.split(":")[0]! : ""))
      .filter(Boolean);
    const docs = [...first, ...((await db().vouchers.bulkGet(srcIds)).filter(Boolean) as Doc[])];
    const parties = await db().parties.where("godownId").anyOf(ids).toArray();
    const banks = (await db().bankAccounts.where("godownId").anyOf(ids).toArray()).filter(
      (b) => b.status === "active",
    );
    const opened = ids.length === 1 ? await hasOpeningCash(ids[0]!) : true;
    return {
      v,
      docs: new Map(docs.map((d) => [d._id, d] as const)),
      parties: new Map(parties.map((p) => [p._id, p] as const)),
      banks,
      opened,
    };
  }, [ids.join("|"), book, day]);
  if (data === undefined) return <Skeleton rows={6} />;
  if (data === null) return null;
  const { v, docs, parties, banks, opened } = data;
  const isCash = book === "CASH";
  const canWrite = !readOnly && !consolidated && !!godownId;
  const opening = v.openingPaise + v.openingEntryPaise;
  return (
    <div className="flex flex-col gap-4" data-testid="cashbook">
      <div className="bg-card shadow-card flex items-center gap-2 rounded-2xl border p-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("dash.prevDay")}
          onClick={() => setDay(addDays(day, -1))}
          data-testid="cb-prev-day"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
        <input
          type="date"
          className="h-11 min-w-0 flex-1 bg-transparent text-center text-base"
          value={day}
          max={today}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          aria-label={t("cb.date")}
          data-testid="cb-date"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("dash.nextDay")}
          disabled={day >= today}
          onClick={() => setDay(addDays(day, 1))}
          data-testid="cb-next-day"
        >
          <ChevronRight className="size-5" aria-hidden />
        </Button>
      </div>
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {[
          { id: "CASH", name: t("cb.cash") },
          ...banks.map((b) => ({ id: `BANK:${b._id}`, name: b.name })),
        ].map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={book === b.id}
            onClick={() => setBook(b.id)}
            data-testid={`cb-book-${b.id === "CASH" ? "CASH" : "BANK"}`}
            className={"chip"}
          >
            {b.name}
          </button>
        ))}
      </div>
      {v.lateEntry && isCash ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
          data-testid="cb-late"
        >
          {t("cb.lateEntry")}
          {canWrite && role === "owner" ? (
            <Button variant="outline" className="h-10 bg-white" onClick={() => setReopening(true)}>
              {t("cb.recheck")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <Panel>
        <Line
          label={isCash ? t("cb.opening") : t("cb.openingBank")}
          paise={opening}
          testId="cb-opening"
        />
        <Line
          label={isCash ? t("cb.received") : t("cb.receivedBank")}
          paise={v.receivedPaise}
          testId="cb-received"
          sign="+"
        />
        <Line
          label={isCash ? t("cb.paid") : t("cb.paidBank")}
          paise={v.paidPaise}
          testId="cb-paid"
          sign="−"
        />
        <Line
          label={isCash ? t("cb.expenses") : t("cb.expensesBank")}
          paise={v.expensesPaise}
          testId="cb-expenses"
          sign="−"
        />
        <Line label={t("cb.expected")} paise={v.expectedClosingPaise} testId="cb-expected" strong />
        <p className="text-muted-foreground tabular text-right text-xs" data-testid="cb-formula">
          {t("cb.formulaShort", {
            opening: money(opening),
            received: money(v.receivedPaise),
            paid: money(v.paidPaise),
            expenses: money(v.expensesPaise),
            expected: money(v.expectedClosingPaise),
          })}
        </p>
        {isCash && v.closed && v.dayClose && v.dayClose.type === "DAY_CLOSE" ? (
          <div
            className="bg-forest-100/60 mt-3 flex flex-col gap-2 rounded-xl p-3"
            data-testid="cb-closed"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Lock className="size-4" aria-hidden />
              {t("cb.closed", { amount: money(BigInt(v.dayClose.actualClosingPaise)) })}
            </span>
            {BigInt(v.dayClose.diffPaise) !== 0n ? (
              <span
                className={cn(
                  "text-sm",
                  BigInt(v.dayClose.diffPaise) < 0n ? "text-red-800" : "text-amber-900",
                )}
                data-testid="cb-closed-diff"
                data-paise={v.dayClose.diffPaise}
              >
                {BigInt(v.dayClose.diffPaise) < 0n
                  ? t("cb.short", { amount: money(-BigInt(v.dayClose.diffPaise)) })
                  : t("cb.excess", { amount: money(BigInt(v.dayClose.diffPaise)) })}
                {v.dayClose.notes ? ` · ${v.dayClose.notes}` : ""}
              </span>
            ) : (
              <span className="text-sm text-emerald-800">{t("cb.matched")}</span>
            )}
            {canWrite && role === "owner" ? (
              <Button
                variant="outline"
                className="h-11 self-start bg-white"
                onClick={() => setReopening(true)}
                data-testid="cb-reopen"
              >
                <RotateCcw className="size-4" aria-hidden />
                {t("cb.reopen")}
              </Button>
            ) : null}
          </div>
        ) : isCash && canWrite ? (
          <Button
            className="mt-3 h-12 w-full text-base"
            onClick={() => setClosing(true)}
            data-testid="cb-close"
          >
            {t("cb.closeDay")}
          </Button>
        ) : null}
        {isCash ? (
          <div className="mt-3 flex flex-col gap-1 border-t pt-2">
            <span className="text-muted-foreground text-xs">{t("cb.bankBalance")}</span>
            {v.banks.length === 0 ? (
              <span className="text-muted-foreground text-sm">{t("cb.noBank")}</span>
            ) : (
              v.banks.map((b) => (
                <div key={b.id} className="flex justify-between text-sm">
                  <span>{b.name}</span>
                  <span className="tabular">{money(b.closingPaise)}</span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </Panel>
      <Panel>
        <div className="grid gap-4 md:grid-cols-3">
          <Items
            title={t("cb.itemsReceived")}
            list={v.items.received}
            docs={docs}
            parties={parties}
            {...(canWrite ? { onVoid: setVoiding } : {})}
          />
          <Items
            title={t("cb.itemsPaid")}
            list={v.items.paid}
            docs={docs}
            parties={parties}
            {...(canWrite ? { onVoid: setVoiding } : {})}
          />
          <Items
            title={t("cb.itemsExpenses")}
            list={v.items.expenses}
            docs={docs}
            parties={parties}
          />
        </div>
      </Panel>
      {canWrite ? (
        <Panel title={t("cb.actions")}>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                "DEPOSIT",
                "WITHDRAW",
                "CAPITAL_IN",
                "DRAWINGS",
                ...(banks.length > 1 ? (["TRANSFER"] as const) : []),
              ] as const
            ).map((k) => (
              <Button
                key={k}
                variant="outline"
                className="h-12"
                onClick={() => setContra(k)}
                data-testid={`cb-action-${k}`}
              >
                {t(`cb.${k}` as TKey)}
              </Button>
            ))}
            {!opened ? (
              <Button
                variant="outline"
                className="h-12"
                onClick={() => setContra("OPENING")}
                data-testid="cb-opening-cash"
              >
                {t("cb.openingCash")}
              </Button>
            ) : null}
          </div>
        </Panel>
      ) : null}
      {closing && godownId ? (
        <CloseSheet
          godownId={godownId}
          date={day}
          expected={v.expectedClosingPaise}
          onClose={() => setClosing(false)}
        />
      ) : null}
      {contra && godownId ? (
        <ContraSheet godownId={godownId} date={day} kind={contra} onClose={() => setContra(null)} />
      ) : null}
      <ConfirmDialog
        open={reopening}
        onOpenChange={setReopening}
        title={t("cb.reopen")}
        body={t("cb.reopenBody", {
          date: fmt(day, "short"),
          amount: money(v.diffPaise < 0n ? -v.diffPaise : v.diffPaise),
        })}
        confirmLabel={t("cb.reopen")}
        onConfirm={async () => {
          if (!godownId) return;
          if (!reason.trim()) return lazyToast(t("pay.reasonRequired"), "error");
          try {
            await reopenDay(godownId, day, reason.trim());
            setReason("");
            setReopening(false);
            lazyToast(t("cb.reopened"), "success");
          } catch (e) {
            lazyToast(t(errorKey(e)), "error");
          }
        }}
      >
        <Input
          className="h-12 text-base"
          placeholder={t("cb.reopenReason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="reopen-reason"
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={voiding !== null}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={t("cb.voidContra")}
        body={
          voiding && voiding.type === "CONTRA"
            ? t("cb.voidContraBody", {
                kind: t(`cb.${voiding.kind}` as TKey),
                amount: money(BigInt(voiding.amountPaise)),
                date: fmt(voiding.transactionDate, "short"),
              })
            : ""
        }
        confirmLabel={t("cb.voidContra")}
        onConfirm={async () => {
          if (!voiding || !godownId) return;
          if (!voidReason.trim()) return lazyToast(t("pay.reasonRequired"), "error");
          try {
            await voidDoc(godownId, voiding._id, voidReason.trim());
            setVoiding(null);
            setVoidReason("");
            lazyToast(t("cb.voided"), "success");
          } catch (e) {
            lazyToast(t(errorKey(e)), "error");
          }
        }}
      >
        <Input
          className="h-12 text-base"
          placeholder={t("pay.reason")}
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
}

/** `?date=` on first render only (the tab keeps its own state after that). */
function dateFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const v = new URLSearchParams(window.location.search).get("date");
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

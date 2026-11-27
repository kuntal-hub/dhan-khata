"use client";

/**
 * Expense detail (requirement_v2 §12.4): title, category, amount, person, expense date, entry
 * date, due date, notes; paid / still to pay; every payment with its own date (edit / reverse /
 * receipt); "+ পেমেন্ট দিন"; edit, void (with its payments), history.
 */
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { History, Undo2 } from "lucide-react";
import { categoryName } from "@/components/expenses/category";
import { AddPaymentSheet, PaymentList } from "@/components/entry/Payments";
import { Panel, StatusPill } from "@/components/kit/Kit";
import { WhatsAppButton } from "@/components/kit/WhatsApp";
import { Loading } from "@/components/lists/common";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { paymentsOf, stateOf } from "@/client/queries/purchases";
import { voidDoc } from "@/client/repo";
import { useI18n } from "@/i18n/I18nProvider";

function Detail() {
  const { t, money, date, count } = useI18n();
  const router = useRouter();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const doc = await db().vouchers.get(id);
    if (!doc || doc.type !== "EXPENSE") return null;
    const [party, category, payments] = await Promise.all([
      doc.partyId ? db().parties.get(doc.partyId) : undefined,
      db()
        .expenseCategories.where("[godownId+code]")
        .equals([doc.godownId, doc.categoryCode])
        .first(),
      paymentsOf(doc._id),
    ]);
    return { doc, party, category, payments };
  }, [id]);
  const [paying, setPaying] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, party, category, payments } = data;
  const active = payments.filter((p) => p.status === "active");
  const st = stateOf(doc, active)!;
  const voided = doc.status === "void";
  const who = party?.name ?? doc.personText;
  const waText =
    st.duePaise > 0n && party
      ? t("wa.payNoDate", {
          name: party.name,
          business: business?.name ?? "",
          gola: godown.name,
          amount: money(st.duePaise),
        })
      : "";
  return (
    <div className="flex flex-col gap-4" data-testid="expense-detail">
      <PageTitle
        title={doc.title}
        subtitle={`${doc.number} · ${categoryName(category, t, doc.categoryCode)}`}
        back="/expenses?tab=all"
        actions={<StatusPill status={voided ? "VOID" : st.status} />}
        edit={
          !voided && !readOnly
            ? {
                href: `/expenses/edit?id=${doc._id}`,
                label: t("act.edit"),
                testId: "expense-edit",
              }
            : null
        }
      />
      <Panel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          <div>
            <dt className="text-muted-foreground text-xs">{t("xp.amount")}</dt>
            <dd className="tabular font-semibold" data-testid="detail-total">
              {money(BigInt(doc.amountPaise))}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("xp.category")}</dt>
            <dd className="font-medium">{categoryName(category, t, doc.categoryCode)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("xp.expenseDate")}</dt>
            <dd data-testid="detail-expense-date" data-date={doc.expenseDate}>
              {date(doc.expenseDate, "short")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("xp.entryDate")}</dt>
            <dd data-testid="detail-entry-date" data-date={doc.entryDate}>
              {date(doc.entryDate, "short")}
            </dd>
          </div>
          {who ? (
            <div>
              <dt className="text-muted-foreground text-xs">{t("xp.person")}</dt>
              <dd>{who}</dd>
            </div>
          ) : null}
          {doc.notes ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground text-xs">{t("xp.notes")}</dt>
              <dd>{doc.notes}</dd>
            </div>
          ) : null}
        </dl>
      </Panel>
      <Panel>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-forest-100/60 rounded-xl p-3">
            <span className="text-muted-foreground text-xs">{t("xp.paid")}</span>
            <p className="tabular text-xl font-semibold" data-testid="detail-paid">
              {money(st.paidPaise)}
            </p>
          </div>
          <div className="rounded-xl bg-red-50 p-3">
            <span className="text-xs text-red-900">{t("xp.remaining")}</span>
            <p
              className="tabular text-2xl font-semibold text-red-800"
              data-testid="detail-due"
              data-paise={st.duePaise.toString()}
            >
              {money(st.duePaise)}
            </p>
          </div>
        </div>
      </Panel>
      <Panel
        title={t("xp.payments")}
        action={
          !voided && !readOnly && st.duePaise > 0n ? (
            <Button className="h-11" onClick={() => setPaying(true)} data-testid="add-due-payment">
              {t("xp.addPayment")}
            </Button>
          ) : null
        }
      >
        <PaymentList payments={payments} godownId={godown._id} />
      </Panel>
      {!voided && !readOnly ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {party ? <WhatsAppButton phone={party.phone} text={waText} className="h-12" /> : null}
          <Button
            variant="outline"
            className="text-destructive h-12"
            onClick={() => setReversing(true)}
            data-testid="expense-reverse"
          >
            <Undo2 className="size-5" aria-hidden />
            {t("xp.reverse")}
          </Button>
        </div>
      ) : null}
      <Panel title={t("pur.history")}>
        <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
          <li className="flex items-center gap-2">
            <History className="size-4" aria-hidden />
            {t("hist.created", { date: date(doc.entryDate, "short") })}
          </li>
          {doc.rev > 1 ? (
            <li>
              {t("hist.edited", {
                date: date(doc.updatedAt.slice(0, 10), "short"),
                rev: count(doc.rev),
              })}
            </li>
          ) : null}
          {doc.editReason ? <li>{t("hist.reason", { reason: doc.editReason })}</li> : null}
          {voided ? <li>{t("hist.voided", { reason: doc.voidReason ?? "" })}</li> : null}
        </ul>
      </Panel>
      {paying ? (
        <AddPaymentSheet
          open={paying}
          onOpenChange={setPaying}
          godownId={godown._id}
          source={doc}
          duePaise={st.duePaise}
          direction="OUT"
        />
      ) : null}
      <ConfirmDialog
        open={reversing}
        onOpenChange={setReversing}
        title={t("xp.reverse")}
        body={`${t("xp.reverseConfirm", { amount: money(BigInt(doc.amountPaise)) })}${active.length ? ` ${t("xp.reverseWithPayments", { count: count(active.length) })}` : ""}`}
        confirmLabel={t("xp.reverse")}
        onConfirm={async () => {
          if (!reason.trim()) return lazyToast(t("pay.reasonRequired"), "error");
          try {
            await voidDoc(godown._id, doc._id, reason.trim(), { withPayments: true });
            lazyToast(t("xp.reversed"), "success");
            setReversing(false);
            router.replace("/expenses?tab=all");
          } catch (e) {
            lazyToast(t(errorKey(e)), "error");
          }
        }}
      >
        <Input
          className="h-12 text-base"
          placeholder={t("pay.reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="reverse-reason"
        />
      </ConfirmDialog>
    </div>
  );
}

export default function ExpenseViewPage() {
  return (
    <PageSuspense>
      <Detail />
    </PageSuspense>
  );
}

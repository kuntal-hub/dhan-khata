"use client";

/**
 * Load detail (requirement_v2 §12.5): all fields and bags, the link status with "link to a sale /
 * mill dispatch" (best matches first), "create a sale / dispatch from this load" (prefilled), unlink,
 * loading slip, edit, reverse, history.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Factory, HandCoins, Link2, Link2Off, Printer } from "lucide-react";
import { varietyName } from "@/components/entry/Variety";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { Panel, QtyTriple, StatusPill } from "@/components/kit/Kit";
import { Loading } from "@/components/lists/common";
import { Cell, HistoryPanel, ReverseButton } from "@/components/mill/common";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";
import { PageTitle } from "@/components/shell/PageTitle";
import { lazyToast } from "@/components/system/IdleToaster";
import { PageSuspense, ReadOnlyNotice, useParam, useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { useActiveGodown, useBusiness } from "@/client/hooks";
import { linkCandidates, type Load } from "@/client/queries/loads";
import { activeLinkOf, linkLoad, unlinkLoad, voidDoc, type LoadLinkType } from "@/client/repo";
import { formatWeightNumber } from "@/domain/units";
import { useI18n } from "@/i18n/I18nProvider";
import { displayVehicleNumber } from "@/domain/vehicleNumber";

function LinkSheet({
  load,
  type,
  onClose,
}: {
  load: Load;
  type: LoadLinkType;
  onClose: () => void;
}) {
  const { t, money, date, digits } = useI18n();
  const business = useBusiness();
  const list = useLiveQuery(() => linkCandidates(load.godownId, load, type), [load._id, type]);
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(type === "SALE" ? "ld.linkSale" : "ld.linkDispatch")}
      testId="load-link-sheet"
    >
      {list && list.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("ld.noCandidates")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(list ?? []).map((c) => {
            const d = c.doc.type === "SALE" ? c.doc.transactionDate : c.doc.dispatchDate;
            const amount = c.doc.type === "SALE" ? c.doc.totalPaise : c.doc.totalValuePaise;
            return (
              <li key={c.doc._id}>
                <button
                  type="button"
                  className="press bg-card flex min-h-14 w-full flex-col items-start rounded-xl border px-3 py-2 text-left text-sm"
                  data-testid="load-link-candidate"
                  onClick={async () => {
                    try {
                      await linkLoad(load.godownId, load._id, { type, id: c.doc._id });
                      lazyToast(t("ld.linked"), "success");
                      onClose();
                    } catch (e) {
                      lazyToast(t(errorKey(e)), "error");
                    }
                  }}
                >
                  <span className="font-medium">
                    {c.party?.name ?? ""} · {c.doc.number}
                  </span>
                  <span className="text-muted-foreground tabular text-xs">
                    {date(d, "short")} ·{" "}
                    {formatWeightNumber(BigInt(c.doc.weight.netG), "QTL", {
                      digits,
                      monKg: business?.monKg,
                    })}{" "}
                    {t("ui.unitQtlShort")} · {money(BigInt(amount))}
                    {c.doc.vehicleNumber ? ` · ${displayVehicleNumber(c.doc.vehicleNumber)}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </BottomSheet>
  );
}

function Detail() {
  const { t, money, date, digits, count } = useI18n();
  const router = useRouter();
  const id = useParam("id");
  const { godown } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const [linking, setLinking] = useState<LoadLinkType | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const doc = await db().vouchers.get(id);
    if (!doc || doc.type !== "LOAD") return null;
    const party = (x?: string) => (x ? db().parties.get(x) : Promise.resolve(undefined));
    const [from, mill, second, variety, linked] = await Promise.all([
      party(doc.fromPartyId),
      party(doc.destinationMillId),
      party(doc.secondPartyId),
      db().varieties.get(doc.varietyId),
      activeLinkOf(doc),
    ]);
    return { doc, from, mill, second, variety, linked };
  }, [id]);
  if (data === undefined) return <Loading />;
  if (data === null || !godown || data.doc.godownId !== godown._id)
    return <ReadOnlyNotice reason="notFound" />;
  const { doc, from, mill, second, variety, linked } = data;
  const o = { digits, monKg: business?.monKg };
  const voided = doc.status === "void";
  const bags = doc.weight.mode === "BAGS" ? (doc.weight.bags ?? []) : [];
  const linkedHref = linked
    ? linked.type === "SALE"
      ? `/sales/view?id=${linked._id}`
      : `/mill/dispatch/view?id=${linked._id}`
    : undefined;

  return (
    <div className="flex flex-col gap-4" data-testid="load-detail">
      <PageTitle
        title={displayVehicleNumber(doc.vehicleNumber)}
        subtitle={`${t("ld.title", { number: doc.number })} · ${date(doc.transactionDate)}`}
        back="/loads"
        actions={voided ? <StatusPill status="VOID" /> : null}
        edit={
          !voided && !readOnly
            ? { href: `/loads/edit?id=${doc._id}`, label: t("act.edit"), testId: "load-edit" }
            : null
        }
      />
      <Panel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          {from ? <Cell label={t("ld.from")}>{from.name}</Cell> : null}
          {mill ? <Cell label={t("ld.mill")}>{mill.name}</Cell> : null}
          <Cell label={t("pur.variety")}>{varietyName(variety, t)}</Cell>
          <Cell label={t("ld.quantity")}>
            <QtyTriple grams={BigInt(doc.weight.netG)} testId="load-detail-qty" />
          </Cell>
          <Cell label={t("ld.rate")}>
            <span className="tabular">{money(BigInt(doc.ratePaisePerQtl))}</span>
          </Cell>
          <Cell label={t("ld.total")}>
            <span className="tabular">{money(BigInt(doc.totalPaise))}</span>
          </Cell>
          {doc.driverName ? <Cell label={t("ld.driver")}>{doc.driverName}</Cell> : null}
          {second ? <Cell label={t("ld.secondParty")}>{second.name}</Cell> : null}
          {doc.notes ? (
            <Cell label={t("ld.notes")} wide>
              {doc.notes}
            </Cell>
          ) : null}
        </dl>
        {bags.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {bags.map((b) => (
              <span
                key={b.id}
                className="bg-gold-100 text-accent-foreground tabular rounded-full px-2.5 py-1 text-xs"
              >
                {t("wt.bagChip", {
                  n: count(b.seq),
                  w: formatWeightNumber(BigInt(b.weightG), "KG", o),
                  unit: t("ui.unitKg"),
                })}
              </span>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel title={t("ld.linkTitle")}>
        {linked && linkedHref ? (
          <div className="flex flex-col gap-3" data-testid="load-link-status">
            <Link
              href={linkedHref}
              className="text-primary flex items-center gap-2 text-[15px] font-medium"
              data-testid="load-linked-record"
            >
              <Link2 className="size-5" aria-hidden />
              {t(`ld.linkedTo${linked.type === "SALE" ? "SALE" : "MILL_DISPATCH"}`)} ·{" "}
              {linked.number}
            </Link>
            <p className="text-muted-foreground text-xs">{t("ld.onlyLinkedMoves")}</p>
            {!voided && !readOnly ? (
              <Button
                variant="outline"
                className="h-11 self-start"
                onClick={() => setUnlinking(true)}
                data-testid="load-unlink"
              >
                <Link2Off className="size-4" aria-hidden />
                {t("ld.unlink")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p
              className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"
              data-testid="load-not-linked"
            >
              <Link2Off className="size-4" aria-hidden />
              {t("ld.notLinkedHint")}
            </p>
            {!voided && !readOnly ? (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-12"
                  onClick={() => setLinking("SALE")}
                  data-testid="load-link-sale"
                >
                  <Link2 className="size-4" aria-hidden />
                  {t("ld.linkSale")}
                </Button>
                <Button
                  variant="outline"
                  className="h-12"
                  onClick={() => setLinking("MILL_DISPATCH")}
                  data-testid="load-link-dispatch"
                >
                  <Link2 className="size-4" aria-hidden />
                  {t("ld.linkDispatch")}
                </Button>
                <Button asChild className="h-12">
                  <Link href={`/sales/new?load=${doc._id}`} data-testid="load-create-sale">
                    <HandCoins className="size-4" aria-hidden />
                    {t("ld.createSale")}
                  </Link>
                </Button>
                <Button asChild className="h-12">
                  <Link
                    href={`/mill/dispatch/new?load=${doc._id}`}
                    data-testid="load-create-dispatch"
                  >
                    <Factory className="size-4" aria-hidden />
                    {t("ld.createDispatch")}
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      {!voided ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Button asChild variant="outline" className="h-12">
            <Link href={`/print/load?id=${doc._id}`} data-testid="load-print">
              <Printer className="size-5" aria-hidden />
              {t("ld.printSlip")}
            </Link>
          </Button>
          {readOnly ? null : (
            <ReverseButton
              label={t("ld.reverse")}
              testId="load-reverse"
              body={t("ld.reverseBody")}
              onReverse={async (reason) => {
                if (linked) await unlinkLoad(godown._id, doc._id);
                await voidDoc(godown._id, doc._id, reason);
                router.replace("/loads");
              }}
            />
          )}
        </div>
      ) : null}
      <HistoryPanel doc={doc} />

      {linking ? <LinkSheet load={doc} type={linking} onClose={() => setLinking(null)} /> : null}
      <ConfirmDialog
        open={unlinking}
        onOpenChange={setUnlinking}
        title={t("ld.unlink")}
        body={t("ld.unlinkBody")}
        confirmLabel={t("ld.unlink")}
        onConfirm={async () => {
          try {
            await unlinkLoad(godown._id, doc._id);
            setUnlinking(false);
          } catch (e) {
            lazyToast(t(errorKey(e)), "error");
          }
        }}
      />
    </div>
  );
}

export default function LoadViewPage() {
  return (
    <PageSuspense>
      <Detail />
    </PageSuspense>
  );
}

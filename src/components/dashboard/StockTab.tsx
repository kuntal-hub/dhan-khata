"use client";

/**
 * Dashboard → স্টক (requirement_v2 §12.1C, §9). Any date; ধান / চাল / অন্যান্য; variety filter;
 * kg / quintal / mon. Paddy (Gola): opening, purchase, returned from mill, sales, mill dispatch,
 * adjustments, expected closing — each line opens its movements; physical count → shortage /
 * excess → approved reasoned adjustment. Separate blocks for paddy at mills (per mill) and rice /
 * other products (never added to paddy). History of the last 14 days. Opening stock entry.
 */
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { docPath } from "@/components/entry/docPath";
import { FieldBox, Segmented } from "@/components/entry/Fields";
import { VarietyPicker, varietyName } from "@/components/entry/Variety";
import { LazyBottomSheet as BottomSheet } from "@/components/forms/LazyBottomSheet";
import { Panel, Skeleton } from "@/components/kit/Kit";
import { RateInput } from "@/components/money/inputs";
import { lazyToast } from "@/components/system/IdleToaster";
import { useWriteGodown } from "@/components/system/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { riceShown, useActiveGodown, useBusiness } from "@/client/hooks";
import { movesFor } from "@/client/queries/consolidated/dashboard";
import { approveStockCount, saveOpeningStock, type AdjustReason } from "@/client/repo";
import { parseRateField } from "@/client/ui/parse";
import { addDays, todayIST } from "@/domain/dates";
import { divRoundHalfUp } from "@/domain/rounding";
import type { Doc, StockMoveV2 } from "@/domain/schemas";
import { formatWeightNumber, parseWeightIn, type WeightUnit } from "@/domain/units";
import { millDay, paddyDay, productDay } from "@/domain/v2/stock";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

type Product = "PADDY" | "RICE" | "OTHER";
const REASONS: readonly AdjustReason[] = ["DRYING", "RODENT", "WET", "WEIGHING", "OTHER"];

function urlParam(name: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

export default function StockTab() {
  const { t, digits, date: fmt } = useI18n();
  const { godownId, godowns, consolidated } = useActiveGodown();
  const { readOnly } = useWriteGodown();
  const business = useBusiness();
  const monKg = business?.monKg ?? 40;
  const today = todayIST();
  const [day, setDay] = useState(() => {
    const p = urlParam("date");
    return p && /^\d{4}-\d{2}-\d{2}$/.test(p) && p <= today ? p : today;
  });
  const rice = riceShown(business);
  const [picked, setProduct] = useState<Product>(() =>
    urlParam("product") === "RICE" ? "RICE" : "PADDY",
  );
  // Rice hidden (business profile): paddy only.
  const product: Product = rice ? picked : "PADDY";
  const [varietyId, setVarietyId] = useState("");
  const [unit, setUnit] = useState<WeightUnit>("QTL");
  const [open, setOpen] = useState<string | null>(null);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState<AdjustReason>("DRYING");
  const [note, setNote] = useState("");
  const [openingSheet, setOpeningSheet] = useState(false);
  const ids = consolidated
    ? (godowns ?? []).filter((g) => g.status === "active").map((g) => g._id)
    : godownId
      ? [godownId]
      : [];
  const data = useLiveQuery(async () => {
    if (ids.length === 0) return null;
    const [moves, varieties, parties] = await Promise.all([
      movesFor(ids),
      db().varieties.where("godownId").anyOf(ids).toArray(),
      db().parties.where("godownId").anyOf(ids).toArray(),
    ]);
    const docIds = [...new Set(moves.filter((m) => m.date === day).map((m) => m.voucherId))];
    const docs = (await db().vouchers.bulkGet(docIds)).filter((x): x is Doc => !!x);
    return {
      moves,
      varieties,
      parties: new Map(parties.map((p) => [p._id, p] as const)),
      docs: new Map(docs.map((d) => [d._id, d] as const)),
    };
  }, [ids.join("|"), day]);
  if (data === undefined) return <Skeleton rows={6} />;
  if (data === null) return null;
  const { moves, varieties, parties, docs } = data;
  const o = { digits, monKg };
  const w = (g: bigint) =>
    `${formatWeightNumber(g, unit, o)} ${t(unit === "KG" ? "ui.unitKg" : unit === "QTL" ? "ui.unitQtlShort" : "ui.unitMon")}`;
  const vById = new Map(varieties.map((v) => [v._id, v] as const));
  const vid = varietyId || undefined;
  const pd = paddyDay(moves, day, vid);
  const dayMoves = (pred: (m: StockMoveV2) => boolean) =>
    moves.filter((m) => m.date === day && pred(m));
  const paddyWh = (m: StockMoveV2) =>
    m.product === "PADDY" && m.location === "WAREHOUSE" && (!vid || m.varietyId === vid);
  const lines: Array<{
    key: string;
    label: string;
    g: bigint;
    types: StockMoveV2["voucherType"][];
    sign?: string;
  }> = [
    { key: "opening", label: t("stk.opening"), g: pd.openingG, types: [] },
    { key: "purchase", label: t("stk.purchase"), g: pd.purchaseG, types: ["PURCHASE"], sign: "+" },
    {
      key: "returned",
      label: t("stk.returned"),
      g: pd.returnedFromMillG,
      types: ["MILL_RETURN"],
      sign: "+",
    },
    { key: "sales", label: t("stk.sales"), g: pd.salesG, types: ["SALE"], sign: "−" },
    {
      key: "dispatch",
      label: t("stk.dispatch"),
      g: pd.dispatchG,
      types: ["MILL_DISPATCH"],
      sign: "−",
    },
    {
      key: "adjust",
      label: t("stk.adjust"),
      g: pd.adjustmentsG,
      types: ["STOCK_ADJUST", "OPENING"],
      sign: "±",
    },
  ];
  const countedG = counted.trim() ? parseWeightIn(counted, unit, monKg) : undefined;
  const diff = countedG && countedG.ok ? countedG.value - pd.closingG : undefined;
  const canWrite = !readOnly && !consolidated && !!godownId;
  const mills = [
    ...new Set(
      moves
        .filter((m) => m.product === "PADDY" && m.location === "MILL")
        .map((m) => m.millPartyId ?? ""),
    ),
  ];
  const others = [
    ...new Set(moves.filter((m) => m.product === "OTHER").map((m) => m.otherProductName ?? "")),
  ];
  const history = Array.from({ length: 14 }, (_, i) => addDays(day, i - 13)).map((d) => ({
    date: d,
    g:
      product === "PADDY"
        ? paddyDay(moves, d, vid).closingG
        : product === "RICE"
          ? productDay(moves, d, "RICE").closingG
          : others.reduce((s, n) => s + productDay(moves, d, "OTHER", n).closingG, 0n),
  }));
  const maxH = history.reduce((m, h) => (h.g > m ? h.g : m), 0n);

  const moveList = (list: StockMoveV2[]) =>
    list.length === 0 ? (
      <p className="text-muted-foreground py-1 text-xs">{t("stk.noMovements")}</p>
    ) : (
      <ul className="bg-muted/30 mb-1 divide-y rounded-lg px-2 text-xs">
        {list.map((m) => {
          const d = docs.get(m.voucherId);
          const href = d ? docPath(d) : undefined;
          const pid = d && "partyId" in d ? (d.partyId as string | undefined) : undefined;
          const label = `${t(`voucherType.${m.voucherType}` as TKey)}${pid && parties.get(pid) ? ` · ${parties.get(pid)!.name}` : ""}${m.varietyId ? ` · ${varietyName(vById.get(m.varietyId), t)}` : ""}`;
          return (
            <li key={m._id} className="flex items-center justify-between gap-2 py-1.5">
              {href ? (
                <Link href={href} className="text-primary min-w-0 truncate">
                  {label}
                </Link>
              ) : (
                <span className="min-w-0 truncate">{label}</span>
              )}
              <span className="tabular shrink-0">
                {w(BigInt(m.qtyG))}
                {m.bags ? ` · ${t("stk.bags", { n: m.bags < 0 ? -m.bags : m.bags })}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="flex flex-col gap-4" data-testid="stock-tab">
      <div className="bg-card shadow-card flex items-center gap-2 rounded-2xl border p-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("dash.prevDay")}
          onClick={() => setDay(addDays(day, -1))}
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
          data-testid="stock-date"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("dash.nextDay")}
          disabled={day >= today}
          onClick={() => setDay(addDays(day, 1))}
        >
          <ChevronRight className="size-5" aria-hidden />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {rice ? (
          <Segmented
            label={t("sl.product")}
            value={product}
            options={[
              ["PADDY", t("stk.PADDY")],
              ["RICE", t("stk.RICE")],
              ["OTHER", t("stk.OTHER")],
            ]}
            onChange={setProduct}
            testId="stock-product"
          />
        ) : null}
        <Segmented
          label={t("stk.unit")}
          value={unit}
          options={[
            ["KG", t("ui.unitKg")],
            ["QTL", t("ui.unitQtl")],
            ["MON", t("ui.unitMon")],
          ]}
          onChange={setUnit}
          testId="stock-unit"
        />
      </div>
      {product === "PADDY" ? (
        <>
          <select
            className="bg-card min-h-11 rounded-xl border px-3 text-sm"
            value={varietyId}
            onChange={(e) => setVarietyId(e.target.value)}
            aria-label={t("pur.variety")}
            data-testid="stock-variety"
          >
            <option value="">{t("stk.allVarieties")}</option>
            {varieties
              .filter((v) => v.status === "active" && v.product === "PADDY")
              .map((v) => (
                <option key={v._id} value={v._id}>
                  {varietyName(v, t)}
                  {consolidated
                    ? ` · ${(godowns ?? []).find((g) => g._id === v.godownId)?.name ?? ""}`
                    : ""}
                </option>
              ))}
          </select>
          <Panel title={t("dsh.paddy")}>
            <ul className="flex flex-col" data-testid="stock-lines">
              {lines.map((l) => (
                <li key={l.key}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between text-left"
                    onClick={() => setOpen(open === l.key ? null : l.key)}
                    aria-expanded={open === l.key}
                    disabled={l.types.length === 0}
                  >
                    <span className="text-muted-foreground">{l.label}</span>
                    <span
                      className="tabular"
                      data-testid={`stock-${l.key}`}
                      data-grams={l.g.toString()}
                    >
                      {l.sign && l.g !== 0n ? `${l.sign} ` : ""}
                      {w(l.g < 0n ? -l.g : l.g)}
                    </span>
                  </button>
                  {open === l.key
                    ? moveList(dayMoves((m) => paddyWh(m) && l.types.includes(m.voucherType)))
                    : null}
                </li>
              ))}
              <li className="flex min-h-12 items-center justify-between border-t pt-2">
                <span className="font-semibold">{t("stk.expected")}</span>
                <span
                  className="tabular text-xl font-semibold"
                  data-testid="stock-closing"
                  data-grams={pd.closingG.toString()}
                >
                  {w(pd.closingG)}
                </span>
              </li>
            </ul>
            {canWrite ? (
              <div className="mt-3 flex flex-col gap-3 border-t pt-3">
                <FieldBox
                  label={`${t("stk.actual")} (${t(unit === "KG" ? "ui.unitKg" : unit === "QTL" ? "ui.unitQtl" : "ui.unitMon")})`}
                >
                  <Input
                    inputMode="decimal"
                    className="h-12 text-base"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    data-testid="stock-counted"
                  />
                </FieldBox>
                {diff !== undefined && diff !== 0n ? (
                  <>
                    <p
                      className={cn(
                        "rounded-xl px-3 py-2 text-sm font-medium",
                        diff < 0n ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900",
                      )}
                      data-testid="stock-diff"
                      data-grams={diff.toString()}
                    >
                      {diff < 0n
                        ? t("stk.shortage", { qty: w(-diff) })
                        : t("stk.excess", { qty: w(diff) })}
                    </p>
                    {vid ? (
                      <>
                        <FieldBox label={t("stk.reason")}>
                          <select
                            className="bg-card min-h-12 rounded-xl border px-3 text-base"
                            value={reason}
                            onChange={(e) => setReason(e.target.value as AdjustReason)}
                            data-testid="stock-reason"
                          >
                            {REASONS.map((r) => (
                              <option key={r} value={r}>
                                {t(`stk.reasons.${r}` as TKey)}
                              </option>
                            ))}
                          </select>
                        </FieldBox>
                        <Input
                          className="h-12 text-base"
                          placeholder={t("stk.note")}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                        />
                        <Button
                          className="h-12"
                          data-testid="stock-approve"
                          onClick={async () => {
                            if (!godownId || !countedG || !countedG.ok) return;
                            try {
                              await approveStockCount(godownId, {
                                date: day,
                                product: "PADDY",
                                varietyId: vid,
                                systemG: pd.closingG,
                                countedG: countedG.value,
                                reason,
                                note,
                              });
                              setCounted("");
                              setNote("");
                              lazyToast(t("stk.approved"), "success");
                            } catch (e) {
                              lazyToast(t(errorKey(e)), "error");
                            }
                          }}
                        >
                          {t("stk.approve")}
                        </Button>
                      </>
                    ) : (
                      <p className="text-muted-foreground text-xs">{t("stk.pickVariety")}</p>
                    )}
                  </>
                ) : null}
                <Button
                  variant="outline"
                  className="h-11 self-start"
                  onClick={() => setOpeningSheet(true)}
                  data-testid="stock-opening-add"
                >
                  {t("stk.openingStock")}
                </Button>
              </div>
            ) : null}
          </Panel>
          <Panel title={t("stk.millBlock")}>
            {mills.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("stk.noMill")}</p>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full text-sm" data-testid="stock-mills">
                  <thead className="text-muted-foreground text-xs">
                    <tr>
                      <th className="py-2 text-left font-normal">{t("sl.mill")}</th>
                      <th className="py-2 text-right font-normal">{t("stk.opening")}</th>
                      <th className="py-2 text-right font-normal">{t("stk.dispatched")}</th>
                      <th className="py-2 text-right font-normal">{t("stk.millReturned")}</th>
                      <th className="py-2 text-right font-normal">{t("stk.consumed")}</th>
                      <th className="py-2 text-right font-normal">{t("stk.settled")}</th>
                      <th className="py-2 text-right font-normal">{t("stk.closing")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {mills.map((id) => {
                      const m = millDay(moves, day, id || undefined);
                      return (
                        <tr key={id}>
                          <td className="py-2 whitespace-nowrap">{parties.get(id)?.name ?? ""}</td>
                          <td className="tabular py-2 text-right">{w(m.openingG)}</td>
                          <td className="tabular py-2 text-right">{w(m.dispatchedG)}</td>
                          <td className="tabular py-2 text-right">{w(m.returnedG)}</td>
                          <td className="tabular py-2 text-right">{w(m.consumedG)}</td>
                          <td className="tabular py-2 text-right">{w(m.settledG)}</td>
                          <td
                            className="tabular py-2 text-right font-semibold"
                            data-testid="stock-mill-closing"
                            data-grams={m.closingG.toString()}
                          >
                            {w(m.closingG)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : product === "RICE" ? (
        <Panel title={t("stk.riceBlock")}>
          {(() => {
            const r = productDay(moves, day, "RICE");
            return (
              <ul className="flex flex-col text-[15px]" data-testid="stock-rice">
                {(
                  [
                    [t("stk.opening"), r.openingG],
                    [t("stk.riceReturned"), r.returnedFromMillG],
                    [t("stk.riceSales"), r.salesG],
                    [t("stk.adjust"), r.adjustmentsG],
                  ] as Array<[string, bigint]>
                ).map(([label, g]) => (
                  <li key={label} className="flex min-h-10 items-center justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="tabular">{w(g)}</span>
                  </li>
                ))}
                <li className="flex min-h-12 items-center justify-between border-t pt-2">
                  <span className="font-semibold">{t("stk.closing")}</span>
                  <span
                    className="tabular text-xl font-semibold"
                    data-testid="stock-rice-closing"
                    data-grams={r.closingG.toString()}
                  >
                    {w(r.closingG)}
                  </span>
                </li>
              </ul>
            );
          })()}
        </Panel>
      ) : (
        <Panel title={t("stk.otherBlock")}>
          {others.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dsh.noStock")}</p>
          ) : (
            <ul className="divide-y">
              {others.map((n) => {
                const r = productDay(moves, day, "OTHER", n);
                return (
                  <li key={n} className="flex min-h-11 items-center justify-between">
                    <span>{n}</span>
                    <span className="tabular font-medium">{w(r.closingG)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
      <Panel title={t("stk.history")}>
        <ul className="flex flex-col gap-1.5" data-testid="stock-history">
          {history.map((h) => (
            <li
              key={h.date}
              className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-xs"
            >
              <span className="text-muted-foreground">{fmt(h.date, "short")}</span>
              <div className="bg-muted/50 h-2 overflow-hidden rounded-full">
                <div
                  className="bg-gold h-full rounded-full"
                  style={{
                    width: `${maxH > 0n && h.g > 0n ? Number(divRoundHalfUp(h.g * 100n, maxH)) : 0}%`,
                  }}
                />
              </div>
              <span className="tabular">{w(h.g)}</span>
            </li>
          ))}
        </ul>
      </Panel>
      {openingSheet && godownId ? (
        <OpeningStockSheet godownId={godownId} date={day} onClose={() => setOpeningSheet(false)} />
      ) : null}
    </div>
  );
}

function OpeningStockSheet({
  godownId,
  date,
  onClose,
}: {
  godownId: string;
  date: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const business = useBusiness();
  const [varietyId, setVarietyId] = useState<string>();
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const q = parseWeightIn(qty, "QTL", business?.monKg ?? 40);
    const r = parseRateField(rate, false, 0n);
    if (!varietyId || !q.ok || q.value <= 0n) return setError(t("acct.required"));
    try {
      await saveOpeningStock(godownId, {
        date,
        product: "PADDY",
        varietyId,
        qtyG: q.value,
        valuePaise: divRoundHalfUp(q.value * (r.value ?? 0n), 100_000n),
      });
      lazyToast(t("stk.saved"), "success");
      onClose();
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };
  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("stk.openingStock")}
      description={t("stk.openingStockHint")}
      testId="opening-stock-sheet"
    >
      <VarietyPicker
        godownId={godownId}
        value={varietyId}
        onChange={setVarietyId}
        testId="opening-variety"
      />
      <FieldBox label={t("stk.qty")}>
        <Input
          inputMode="decimal"
          className="h-12 text-base"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          data-testid="opening-qty"
        />
      </FieldBox>
      <RateInput label={t("stk.rate")} value={rate} onChange={setRate} testId="opening-rate" />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button className="h-12 text-base" onClick={() => void save()} data-testid="opening-save">
        {t("common.save")}
      </Button>
    </BottomSheet>
  );
}

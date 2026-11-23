"use client";

import type { ReactNode } from "react";
import { amountInWords } from "@/domain/amountInWords";
import { saleSummary } from "@/domain/calc/sale";
import { formatVehicleNumber, type Godown, type Voucher } from "@/domain/schemas";
import { formatDate, formatMoney, formatRate, formatWeight } from "@/i18n/format";
import { translate, type Lang, type TKey } from "@/i18n/translate";
import type { Names } from "@/components/vouchers/names";

/** Formatting bound to one receipt language (digits follow the language on paper). */
function fmt(lang: Lang) {
  const prefs = { lang, digits: lang } as const;
  return {
    t: (k: TKey, vars?: Record<string, string | number>) => translate(lang, k, vars),
    money: (p: bigint) => formatMoney(p, prefs),
    weight: (g: bigint) => formatWeight(g, prefs),
    rate: (r: bigint) => formatRate(r, prefs),
    date: (d: string) => formatDate(d, prefs, "long"),
  };
}

export function Letterhead({ godown, lang }: { godown: Godown; lang: Lang }) {
  const f = fmt(lang);
  return (
    <div className="flex flex-col items-center gap-0.5 border-b pb-2 text-center">
      <div className="text-lg font-bold">{godown.firmName || godown.name}</div>
      {godown.firmName ? (
        <div className="text-sm">{f.t("receipt.godownName", { name: godown.name })}</div>
      ) : null}
      {godown.proprietor ? (
        <div className="text-xs">{f.t("receipt.proprietor", { name: godown.proprietor })}</div>
      ) : null}
      {godown.address ? <div className="text-xs">{godown.address}</div> : null}
      {godown.phone ? (
        <div className="text-xs">{f.t("receipt.phone", { phone: godown.phone })}</div>
      ) : null}
      {godown.gstin ? (
        <div className="text-xs">{f.t("receipt.gstin", { gstin: godown.gstin })}</div>
      ) : null}
    </div>
  );
}

function R({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span>{label}</span>
      <span className="tabular text-right">{value}</span>
    </div>
  );
}

/** One receipt in one language. */
export function ReceiptBody({
  v,
  godown,
  lang,
  names,
}: {
  v: Voucher;
  godown: Godown;
  lang: Lang;
  names: Names;
}) {
  const f = fmt(lang);
  const total = receiptTotal(v);
  return (
    <div className="flex flex-col gap-2" lang={lang}>
      <Letterhead godown={godown} lang={lang} />
      <div className="text-center font-semibold">{f.t(`receipt.title.${v.type}` as TKey)}</div>
      <R label={f.t("receipt.number")} value={v.number} />
      <R label={f.t("common.date")} value={f.date(v.date)} />
      {"partyId" in v && typeof v.partyId === "string" ? (
        <R label={f.t("receipt.party")} value={names.party(v.partyId)} />
      ) : null}
      {(v.type === "PURCHASE" || v.type === "SALE") && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-1 text-left">{f.t("trade.variety")}</th>
              <th className="py-1 text-right">{f.t("trade.netWeight")}</th>
              <th className="py-1 text-right">{f.t("trade.rate")}</th>
              <th className="py-1 text-right">{f.t("trade.lineAmount")}</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {v.lines.map((l, i) => (
              <tr key={i} className="border-b">
                <td className="py-1">{names.variety(l.varietyId)}</td>
                <td className="py-1 text-right">{f.weight(BigInt(l.netG))}</td>
                <td className="py-1 text-right">{f.rate(BigInt(l.ratePaisePerQtl))}</td>
                <td className="py-1 text-right">{f.money(BigInt(l.amountPaise))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(v.type === "PURCHASE" || v.type === "SALE") &&
        v.charges.map((c, i) => (
          <R
            key={i}
            label={c.label}
            value={`${c.kind === "add" ? "+" : "−"}${f.money(BigInt(c.amountPaise))}`}
          />
        ))}
      {(v.type === "PURCHASE" || v.type === "SALE") && BigInt(v.roundOffPaise) !== 0n ? (
        <R label={f.t("trade.roundOff")} value={f.money(BigInt(v.roundOffPaise))} />
      ) : null}
      {v.type === "SALE" && v.vehicleNumber ? (
        <R label={f.t("sale.vehicleNumber")} value={formatVehicleNumber(v.vehicleNumber)} />
      ) : null}
      {v.type === "PAYMENT" || v.type === "RECEIPT" ? (
        <>
          <R label={f.t("payment.mode")} value={f.t(`payMode.${v.mode}` as TKey)} />
          {v.utrOrRef ? <R label={f.t("payment.utrOrRef")} value={v.utrOrRef} /> : null}
          {v.chequeNo ? <R label={f.t("payment.chequeNo")} value={v.chequeNo} /> : null}
          {v.cashVia?.vehicleNumber ? (
            <R
              label={f.t("payment.viaVehicle")}
              value={formatVehicleNumber(v.cashVia.vehicleNumber)}
            />
          ) : null}
          {v.cashVia?.personName ? (
            <R label={f.t("payment.viaPerson")} value={v.cashVia.personName} />
          ) : null}
        </>
      ) : null}
      <div className="flex justify-between border-t pt-1 font-bold">
        <span>{f.t("common.total")}</span>
        <span className="tabular" data-testid={`receipt-total-${lang}`}>
          {f.money(total)}
        </span>
      </div>
      <div className="text-xs italic">{amountInWords(total, lang)}</div>
      {v.type === "PURCHASE" && v.paidNow ? (
        <R label={f.t("purchase.paidNow")} value={f.money(BigInt(v.paidNow.amountPaise))} />
      ) : null}
      {v.type === "SALE" ? (
        <R label={f.t("sale.netReceivable")} value={f.money(saleSummary(v).netReceivable)} />
      ) : null}
      <div className="mt-6 flex justify-end text-xs">
        <span className="border-t px-6 pt-1">{f.t("receipt.signature")}</span>
      </div>
    </div>
  );
}

export function receiptTotal(v: Voucher): bigint {
  switch (v.type) {
    case "PURCHASE":
    case "SALE":
      return BigInt(v.totalPaise);
    case "PAYMENT":
    case "RECEIPT":
      return BigInt(v.amountPaise);
    default:
      return 0n;
  }
}

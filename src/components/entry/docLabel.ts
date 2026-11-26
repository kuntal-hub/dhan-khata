/**
 * A readable title for any document in mixed lists (recent entries, cashbook lines, day view):
 * the party when there is one, else the expense title / cash-bank kind / the bill a payment
 * settles. Plus the entry time in IST. Pure; safe anywhere.
 */
import type { Doc } from "@/domain/schemas";
import type { TKey } from "@/i18n/translate";

type T = (key: TKey, vars?: Record<string, string | number>) => string;

export function docTitle(
  doc: Doc,
  t: T,
  partyName?: string,
  source?: Doc,
): { title: string; subtitle: string } {
  const type = t(`voucherType.${doc.type}` as TKey);
  if (doc.type === "EXPENSE")
    return { title: partyName ? `${doc.title} · ${partyName}` : doc.title, subtitle: type };
  if (doc.type === "CONTRA") return { title: t(`cb.${doc.kind}` as TKey), subtitle: type };
  if (doc.type === "PAYMENT") {
    const of = source ? docTitle(source, t).title : undefined;
    const title = partyName ?? of ?? type;
    const sub =
      source && partyName
        ? `${type} · ${of}`
        : source
          ? `${type} · ${t(`voucherType.${source.type}` as TKey)}`
          : type;
    return { title, subtitle: sub };
  }
  if (doc.type === "OPENING") {
    // What was set: opening cash / bank balance / stock / a party's old due.
    const kind = doc.items[0]?.kind;
    const what =
      kind === "CASH"
        ? t("cb.opening")
        : kind === "BANK"
          ? t("cb.openingBank")
          : kind === "STOCK"
            ? t("stk.opening")
            : kind === "PARTY"
              ? t("dues.opening")
              : type;
    return { title: partyName ? `${what} · ${partyName}` : what, subtitle: type };
  }
  return { title: partyName ?? type, subtitle: type };
}

/**
 * The money amount to show for a document in mixed lists. An opening entry shows the cash /
 * bank money it set (stock or party openings show none here).
 */
export function docAmountPaise(doc: Doc): bigint | undefined {
  if (doc.type === "OPENING") {
    const money = doc.items.filter((i) => i.kind === "CASH" || i.kind === "BANK");
    return money.length ? money.reduce((s, i) => s + BigInt(i.amountPaise), 0n) : undefined;
  }
  if ("totalPaise" in doc) return BigInt(doc.totalPaise);
  if ("amountPaise" in doc) return BigInt(doc.amountPaise);
  return undefined;
}

/** "14:05" in IST, digits as the user chose. */
export function timeIST(iso: string, digits: "bn" | "en"): string {
  return new Intl.DateTimeFormat(digits === "bn" ? "bn-IN" : "en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

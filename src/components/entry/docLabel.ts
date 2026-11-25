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
  return { title: partyName ?? type, subtitle: type };
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

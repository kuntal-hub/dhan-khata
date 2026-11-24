/**
 * Display labels for masters: seeded items render through i18n (codes), user items as typed.
 * Party subtitle: `nameAlt` when the UI language differs from the script of `name` (§11.4).
 */
import { formatVehicleNumber } from "@/domain/vehicleNumber";
import type { BankAccount, ExpenseCategory, Party, Variety, Vehicle } from "@/domain/schemas";
import type { Lang, TKey } from "@/i18n/translate";

type T = (key: TKey) => string;

/** Bengali Unicode block U+0980–U+09FF. */
const BENGALI = /[ঀ-৿]/;

export function partyTitle(
  p: Pick<Party, "name" | "nameAlt">,
  lang: Lang,
): { title: string; sub?: string } {
  const nameIsBengali = BENGALI.test(p.name);
  const mismatch = (lang === "en" && nameIsBengali) || (lang === "bn" && !nameIsBengali);
  return mismatch && p.nameAlt ? { title: p.name, sub: p.nameAlt } : { title: p.name };
}

export function varietyLabel(
  v: Pick<Variety, "name" | "systemKey" | "renamed"> | undefined,
  t: T,
): string {
  if (!v) return "";
  if (v.systemKey && !v.renamed) return t(`variety.${v.systemKey}` as TKey);
  return v.name;
}

export function categoryLabel(
  c: Pick<ExpenseCategory, "code" | "isSystem" | "name"> | undefined,
  t: T,
): string {
  if (!c) return "";
  if (c.isSystem) return t(`expenseCategory.${c.code}` as TKey);
  return c.name ?? c.code;
}

export function vehicleLabel(v: Pick<Vehicle, "number"> | undefined): string {
  return v ? formatVehicleNumber(v.number) : "";
}

export function bankLabel(b: Pick<BankAccount, "name" | "last4"> | undefined): string {
  return b ? `${b.name} ••${b.last4}` : "";
}

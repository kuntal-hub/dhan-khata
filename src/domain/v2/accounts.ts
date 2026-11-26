/**
 * v2 chart of accounts, per Gola (requirement_v2 §8). Users never see these keys.
 * Party balance = Σdebit − Σcredit: > 0 they owe us (পাওনা), < 0 we owe them (দেনা).
 */
import type { Location, Product } from "./schemas";

export const ACC2 = {
  CASH: "CASH",
  STOCK_PADDY: "STOCK_PADDY",
  STOCK_RICE: "STOCK_RICE",
  SALES: "SALES",
  /** Paddy delivered to mills: income (the mill owes us, v2.1). */
  MILL_SALES: "MILL_SALES",
  /** Mill's final-settlement cut (moisture / quality / weight). Reduces income. */
  MILL_DEDUCTION: "MILL_DEDUCTION",
  COGS: "COGS",
  EXP_PAYABLE: "EXP_PAYABLE",
  CASH_DIFF: "CASH_DIFF",
  STOCK_ADJ: "STOCK_ADJ",
  OPENING_BAL: "OPENING_BAL",
  CAPITAL: "CAPITAL",
  DRAWINGS: "DRAWINGS",
  /** Counter account of second-party entries (DECISIONS D7). */
  SP_CLEARING: "SP_CLEARING",
} as const;
export type SystemAccountV2 = (typeof ACC2)[keyof typeof ACC2];

export type AccountTypeV2 = "asset" | "party" | "income" | "expense" | "equity" | "liability";

const SYSTEM: Record<SystemAccountV2, AccountTypeV2> = {
  CASH: "asset",
  STOCK_PADDY: "asset",
  STOCK_RICE: "asset",
  SALES: "income",
  MILL_SALES: "income",
  MILL_DEDUCTION: "income",
  COGS: "expense",
  EXP_PAYABLE: "liability",
  CASH_DIFF: "expense",
  STOCK_ADJ: "expense",
  OPENING_BAL: "equity",
  CAPITAL: "equity",
  DRAWINGS: "equity",
  SP_CLEARING: "equity",
};

export const bankKey = (bankAccountId: string) => `BANK:${bankAccountId}`;
export const partyKey = (partyId: string) => `PARTY:${partyId}`;
export const expenseKey = (categoryCode: string) => `EXP:${categoryCode}`;
export const vehIncomeKey = (vehicleId: string) => `VEH_INCOME:${vehicleId}`;
export const vehExpenseKey = (vehicleId: string, kind: string) => `VEH_EXP:${vehicleId}:${kind}`;
export const stockAtMillKey = (millPartyId: string) => `STOCK_AT_MILL:${millPartyId}`;
export const stockOtherKey = (name: string) => `STOCK_OTHER:${name}`;

/** Ledger account that carries the value of a stock position. */
export function stockAccount(
  product: Product,
  location: Location,
  millPartyId?: string,
  otherProductName?: string,
): string {
  if (product === "RICE") return ACC2.STOCK_RICE;
  if (product === "OTHER") return stockOtherKey(otherProductName ?? "");
  if (location === "MILL") return stockAtMillKey(millPartyId ?? "");
  return ACC2.STOCK_PADDY;
}

/**
 * v2.0 accounts that v2.1 no longer posts (milling charges payable to a mill; conversion loss).
 * Recognised only so ledger rows written before the mill-direction fix still classify until the
 * rebuild replaces them.
 */
const LEGACY: Record<string, AccountTypeV2> = {
  MILLING_CHARGES: "expense",
  MILLING_LOSS: "expense",
};

export function accountTypeV2(key: string): AccountTypeV2 {
  if (key in SYSTEM) return SYSTEM[key as SystemAccountV2];
  if (key in LEGACY) return LEGACY[key]!;
  if (key.startsWith("BANK:")) return "asset";
  if (key.startsWith("PARTY:")) return "party";
  if (key.startsWith("STOCK_AT_MILL:") || key.startsWith("STOCK_OTHER:")) return "asset";
  if (key.startsWith("EXP:") || key.startsWith("VEH_EXP:")) return "expense";
  if (key.startsWith("VEH_INCOME:")) return "income";
  throw new RangeError(`Unknown account key: ${key}`);
}

export const isCashOrBank = (key: string) => key === ACC2.CASH || key.startsWith("BANK:");

/** Expense category codes seeded into every Gola (§12.4). FARMER_PAYMENT opens the payment flow. */
export const EXPENSE_CATEGORY_CODES_V2 = [
  "FARMER_PAYMENT",
  "LABOUR",
  "LOADING",
  "TRANSPORT",
  "DIESEL",
  "VEHICLE",
  "OFFICE",
  // v2.1: the only way (besides a refund) to pay a mill: an expense with the mill as party.
  "MILL_CHARGES",
  "OTHERS",
] as const;
export const FARMER_PAYMENT_CODE = "FARMER_PAYMENT";

/** Seed accounts recorded for a new Gola (informational; dynamic accounts come from masters). */
export function seedChartOfAccountsV2(
  godownId: string,
): Array<{ godownId: string; key: string; type: AccountTypeV2; i18nKey: string }> {
  return (Object.keys(SYSTEM) as SystemAccountV2[]).map((key) => ({
    godownId,
    key,
    type: SYSTEM[key],
    i18nKey: `account.${key}`,
  }));
}

/**
 * Widely known public varieties seeded (verified) into every new Gola (§12.2). Company varieties
 * are added by the owner as he uses them; no invented company list.
 */
export const SEED_VARIETY_KEYS_V2 = [
  "SWARNA",
  "SATABDI",
  "GOBINDOBHOG",
  "MINIKIT",
  "LAL_SWARNA",
  "IR36",
] as const;

/** Colour chips for Golas (palette keys), assigned in creation order. */
export const GOLA_COLOURS = ["green", "gold", "teal", "rose", "indigo", "amber"] as const;

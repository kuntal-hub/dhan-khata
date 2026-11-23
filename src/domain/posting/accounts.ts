/**
 * Per-godown chart of accounts (spec §7.1). Account keys are unique WITHIN a godown; every
 * ledger line carries godownId, so CASH in godown A and CASH in godown B are different accounts.
 * System account names render via i18n `account.<KEY>`; dynamic accounts render from masters.
 *
 * Sign convention for PARTY accounts: balance = Σdebit − Σcredit;
 *   > 0 → they owe us (পাওনা), < 0 → we owe them (দেনা).
 */

export const ACC = {
  CASH: "CASH",
  CHEQUE_IN_HAND: "CHEQUE_IN_HAND",
  STOCK: "STOCK",
  PURCHASE: "PURCHASE",
  COGS: "COGS",
  SALES: "SALES",
  SALES_DEDUCTION: "SALES_DEDUCTION",
  COMMISSION_INCOME: "COMMISSION_INCOME",
  CASH_DIFF: "CASH_DIFF",
  STOCK_ADJ: "STOCK_ADJ",
  TDS_RECEIVABLE: "TDS_RECEIVABLE",
  CAPITAL: "CAPITAL",
  DRAWINGS: "DRAWINGS",
  OPENING_BAL: "OPENING_BAL",
} as const;
export type SystemAccount = (typeof ACC)[keyof typeof ACC];

export type AccountType = "asset" | "party" | "income" | "expense" | "equity";

const SYSTEM_TYPES: Record<SystemAccount, AccountType> = {
  CASH: "asset",
  CHEQUE_IN_HAND: "asset",
  STOCK: "asset",
  PURCHASE: "expense",
  COGS: "expense",
  SALES: "income",
  SALES_DEDUCTION: "expense",
  COMMISSION_INCOME: "income",
  CASH_DIFF: "expense",
  STOCK_ADJ: "expense",
  TDS_RECEIVABLE: "asset",
  CAPITAL: "equity",
  DRAWINGS: "equity",
  OPENING_BAL: "equity",
};

export const bankAccountKey = (bankAccountId: string) => `BANK:${bankAccountId}`;
export const partyAccountKey = (partyId: string) => `PARTY:${partyId}`;
export const expenseAccountKey = (categoryCode: string) => `EXP:${categoryCode}`;
export const vehicleIncomeKey = (vehicleId: string) => `VEH_INCOME:${vehicleId}`;
export const vehicleExpenseKey = (vehicleId: string, kind: string) =>
  `VEH_EXP:${vehicleId}:${kind}`;

export function accountType(key: string): AccountType {
  if (key in SYSTEM_TYPES) return SYSTEM_TYPES[key as SystemAccount];
  if (key.startsWith("BANK:")) return "asset";
  if (key.startsWith("PARTY:")) return "party";
  if (key.startsWith("EXP:") || key.startsWith("VEH_EXP:")) return "expense";
  if (key.startsWith("VEH_INCOME:")) return "income";
  throw new RangeError(`Unknown account key: ${key}`);
}

export function partyIdOfAccount(key: string): string | undefined {
  return key.startsWith("PARTY:") ? key.slice("PARTY:".length) : undefined;
}

export interface AccountDef {
  godownId: string;
  key: string;
  type: AccountType;
  /** i18n key for system accounts. */
  i18nKey: string;
}

/** The system accounts seeded into every new godown (dynamic BANK/PARTY/EXP accounts come from masters). */
export function seedChartOfAccounts(godownId: string): AccountDef[] {
  return (Object.keys(SYSTEM_TYPES) as SystemAccount[]).map((key) => ({
    godownId,
    key,
    type: SYSTEM_TYPES[key],
    i18nKey: `account.${key}`,
  }));
}

/** System expense category codes seeded into every godown (spec §24). */
export const SYSTEM_EXPENSE_CODES = ["LABOUR", "TRANSPORT", "OTHERS"] as const;
export const OPTIONAL_EXPENSE_CODES = [
  "GODOWN_RENT",
  "ELECTRICITY",
  "FOOD",
  "MOBILE",
  "BAGS",
  "REPAIR",
] as const;
export const SEED_VARIETY_KEYS = [
  "SWARNA",
  "MINIKIT",
  "SATABDI",
  "GOBINDOBHOG",
  "LAL_SWARNA",
  "V1010",
  "PUSA",
  "OTHER",
] as const;

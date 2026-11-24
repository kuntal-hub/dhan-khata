/**
 * Client-side test helpers: fake IndexedDB device databases seeded with a session, Golas,
 * varieties, parties and categories — plus v2 document draft builders.
 */
import "fake-indexeddb/auto";
import { setClockForTests } from "@/client/clock";
import { deleteDatabase, db, selectDatabase } from "@/client/db/dexie";
import { META, godownSettingsKey, setMeta } from "@/client/db/meta";
import type { DocDraft, DraftOf } from "@/client/repo";
import { todayIST } from "@/domain/dates";
import { EXPENSE_CATEGORY_CODES_V2, SEED_VARIETY_KEYS_V2 } from "@/domain/v2/accounts";
import {
  defaultGodownSettings,
  type ExpenseCategory,
  type Godown,
  type GodownRole,
  type Party,
  type User,
  type Variety,
} from "@/domain/schemas";
import { buildSearchKey } from "@/i18n/translit";

export const T0 = "2026-11-23T04:30:00.000Z";
export const BIZ = "B-TEST";

export function godownDoc(id: string, code: string, name = code, businessId = BIZ): Godown {
  return {
    _id: id,
    businessId,
    rev: 1,
    createdAt: T0,
    updatedAt: T0,
    code,
    name,
    receiptLanguage: "bn",
    status: "active",
  };
}

export function userDoc(
  id: string,
  opts: {
    isOwner?: boolean;
    businessId?: string;
    access?: Array<{ godownId: string; role: GodownRole; consolidated?: boolean }>;
  } = {},
): User {
  return {
    _id: id,
    businessId: opts.businessId ?? BIZ,
    name: id,
    phone: "9830000000",
    isOwner: opts.isOwner ?? true,
    godownAccess: opts.access ?? [],
    language: "bn",
    digits: "bn",
    active: true,
    createdAt: T0,
  };
}

const base = (godownId: string, id: string, businessId = BIZ) => ({
  _id: id,
  businessId,
  godownId,
  rev: 1,
  createdAt: T0,
  createdBy: "U-OWNER",
  deviceId: "server",
  updatedAt: T0,
  updatedBy: "U-OWNER",
  status: "active" as const,
});

export interface LocalGodown {
  godown: Godown;
  /** variety ids by seed key */
  variety: Record<string, string>;
  farmer: string;
  mill: string;
  customer: string;
}

/** Create (or reset) a device database with a signed-in user and the given Golas. */
export async function setupDevice(
  name: string,
  opts: {
    user?: User;
    deviceCode?: string;
    deviceId?: string;
    godowns?: Array<{ id: string; code: string }>;
    seedMasters?: boolean;
  } = {},
): Promise<Record<string, LocalGodown>> {
  await deleteDatabase(name);
  selectDatabase(name);
  const d = db();
  await d.open();
  const deviceId = opts.deviceId ?? `D-${name}`;
  const user = opts.user ?? userDoc("U-OWNER");
  await setMeta(META.deviceId, deviceId);
  await setMeta(META.session, {
    user,
    deviceId,
    deviceCode: opts.deviceCode ?? "A",
    loggedInAt: T0,
  });
  const out: Record<string, LocalGodown> = {};
  for (const g of opts.godowns ?? []) {
    const godown = godownDoc(g.id, g.code, g.code, user.businessId);
    await d.godowns.put(godown);
    await setMeta(godownSettingsKey(g.id), defaultGodownSettings(g.id, T0));
    const variety: Record<string, string> = {};
    if (opts.seedMasters !== false) {
      for (const key of SEED_VARIETY_KEYS_V2) {
        const v: Variety = {
          ...base(g.id, `${g.id}-V-${key}`, user.businessId),
          name: "",
          systemKey: key,
          product: "PADDY",
          normalizedKey: `${key.toLowerCase()}|`,
          verified: true,
        };
        await d.varieties.put(v);
        variety[key] = v._id;
      }
      for (const code of EXPENSE_CATEGORY_CODES_V2) {
        const c: ExpenseCategory = {
          ...base(g.id, `${g.id}-C-${code}`, user.businessId),
          code,
          isSystem: true,
          enabled: true,
        };
        await d.expenseCategories.put(c);
      }
      for (const [suffix, roles, nm] of [
        ["FARMER", ["FARMER"], "Ramesh"],
        ["MILL", ["MILL"], "Durga Mill"],
        ["CUSTOMER", ["CUSTOMER"], "Gopal Traders"],
      ] as const) {
        const p: Party = {
          ...base(g.id, `${g.id}-P-${suffix}`, user.businessId),
          name: nm,
          searchKey: buildSearchKey(nm),
          roles: [...roles],
        };
        await d.parties.put(p);
      }
    }
    out[g.id] = {
      godown,
      variety,
      farmer: `${g.id}-P-FARMER`,
      mill: `${g.id}-P-MILL`,
      customer: `${g.id}-P-CUSTOMER`,
    };
  }
  return out;
}

export function useClock(iso: string | null): void {
  setClockForTests(iso ? () => new Date(iso) : null);
}

export const TODAY = todayIST();
export const QTL = 100_000n;
export const RS = 100n;

export function manualWeight(g: bigint) {
  return { mode: "MANUAL" as const, totalG: g.toString(), netG: g.toString() };
}

export function purchaseDraft(
  partyId: string,
  varietyId: string,
  g: bigint,
  rate: bigint,
  date = TODAY,
): DraftOf<"PURCHASE"> {
  return {
    type: "PURCHASE",
    transactionDate: date,
    partyId,
    varietyId,
    storeAt: "WAREHOUSE",
    weight: manualWeight(g),
    ratePaisePerQtl: rate.toString(),
    amountPaise: "0",
    roundOffPaise: "0",
    totalPaise: "0",
  };
}

export function saleDraft(
  partyId: string,
  varietyId: string,
  g: bigint,
  rate: bigint,
  date = TODAY,
): DraftOf<"SALE"> {
  return {
    type: "SALE",
    transactionDate: date,
    partyId,
    product: "PADDY",
    varietyId,
    source: "WAREHOUSE",
    weight: manualWeight(g),
    ratePaisePerQtl: rate.toString(),
    amountPaise: "0",
    roundOffPaise: "0",
    totalPaise: "0",
    saleStatus: "CONFIRMED",
    deliveryStatus: "PENDING",
    deliveryLog: [],
  };
}

export function paymentDraft(
  direction: "IN" | "OUT",
  amountPaise: bigint,
  source: DraftOf<"PAYMENT">["source"],
  extra: Partial<DraftOf<"PAYMENT">> = {},
  date = TODAY,
): DraftOf<"PAYMENT"> {
  return {
    type: "PAYMENT",
    direction,
    amountPaise: amountPaise.toString(),
    paymentDate: date,
    mode: "CASH",
    source,
    isInitial: false,
    ...extra,
  };
}

export function expenseDraft(
  amountPaise: bigint,
  date = TODAY,
  extra: Partial<DraftOf<"EXPENSE">> = {},
): DraftOf<"EXPENSE"> {
  return {
    type: "EXPENSE",
    title: "loading labour",
    categoryCode: "LABOUR",
    amountPaise: amountPaise.toString(),
    expenseDate: date,
    ...extra,
  };
}

export type { DocDraft };

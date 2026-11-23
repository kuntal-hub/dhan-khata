/**
 * Client-side test helpers: fake IndexedDB device databases seeded with a session, godowns,
 * varieties, parties and categories — plus voucher draft builders.
 */
import "fake-indexeddb/auto";
import { setClockForTests } from "@/client/clock";
import { deleteDatabase, db, selectDatabase } from "@/client/db/dexie";
import { META, godownSettingsKey, setMeta } from "@/client/db/meta";
import type { VoucherDraft } from "@/client/repo";
import { todayIST } from "@/domain/dates";
import { SEED_VARIETY_KEYS, SYSTEM_EXPENSE_CODES } from "@/domain/posting/accounts";
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
import { line } from "./factory";

export const T0 = "2026-11-23T04:30:00.000Z";

export function godownDoc(id: string, code: string, name = code): Godown {
  return {
    _id: id,
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
    access?: Array<{ godownId: string; role: GodownRole; consolidated?: boolean }>;
  } = {},
): User {
  return {
    _id: id,
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

const base = (godownId: string, id: string) => ({
  _id: id,
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
}

/** Create (or reset) a device database with a signed-in user and the given godowns. */
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
    const godown = godownDoc(g.id, g.code);
    await d.godowns.put(godown);
    await setMeta(godownSettingsKey(g.id), defaultGodownSettings(g.id, T0));
    const variety: Record<string, string> = {};
    if (opts.seedMasters !== false) {
      for (const key of SEED_VARIETY_KEYS) {
        const v: Variety = { ...base(g.id, `${g.id}-V-${key}`), name: "", systemKey: key };
        await d.varieties.put(v);
        variety[key] = v._id;
      }
      for (const code of SYSTEM_EXPENSE_CODES) {
        const c: ExpenseCategory = {
          ...base(g.id, `${g.id}-C-${code}`),
          code,
          isSystem: true,
          enabled: true,
        };
        await d.expenseCategories.put(c);
      }
      for (const [suffix, roles, nm] of [
        ["FARMER", ["farmer"], "Ramesh"],
        ["MILL", ["mill"], "Durga Mill"],
      ] as const) {
        const p: Party = {
          ...base(g.id, `${g.id}-P-${suffix}`),
          name: nm,
          searchKey: buildSearchKey(nm),
          roles: [...roles],
        };
        await d.parties.put(p);
      }
    }
    out[g.id] = { godown, variety, farmer: `${g.id}-P-FARMER`, mill: `${g.id}-P-MILL` };
  }
  return out;
}

export function useClock(iso: string | null): void {
  setClockForTests(iso ? () => new Date(iso) : null);
}

export const TODAY = todayIST();

export function purchaseDraft(
  partyId: string,
  varietyId: string,
  grossG: bigint,
  rate: bigint,
  date = TODAY,
): VoucherDraft {
  return {
    type: "PURCHASE",
    date,
    partyId,
    storeAt: "STORE",
    lines: [line(varietyId, grossG, rate)],
    charges: [],
    roundToRupee: true,
    roundOffPaise: "0",
    totalPaise: "0",
  } as VoucherDraft;
}

export function saleDraft(
  partyId: string,
  varietyId: string,
  grossG: bigint,
  rate: bigint,
  date = TODAY,
): VoucherDraft {
  return {
    type: "SALE",
    date,
    partyId,
    vehicleNumber: "WB12AB3456",
    source: "STORE",
    lines: [line(varietyId, grossG, rate)],
    charges: [],
    roundToRupee: true,
    roundOffPaise: "0",
    totalPaise: "0",
    duePaise: "0",
    settlementStatus: "PENDING",
  } as VoucherDraft;
}

export function paymentDraft(partyId: string, amountPaise: bigint, date = TODAY): VoucherDraft {
  return {
    type: "PAYMENT",
    date,
    partyId,
    amountPaise: amountPaise.toString(),
    mode: "CASH",
    purpose: "BILL",
  } as VoucherDraft;
}

export function expenseDraft(amountPaise: bigint, date = TODAY): VoucherDraft {
  return {
    type: "EXPENSE",
    date,
    categoryCode: "LABOUR",
    amountPaise: amountPaise.toString(),
    mode: "CASH",
    description: "loading labour",
  } as VoucherDraft;
}

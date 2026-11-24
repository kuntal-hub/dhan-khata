/**
 * The device database (Dexie / IndexedDB): the UI's source of truth (spec §3.4, §8.6).
 * Writes go ONLY through `src/client/repo` (one transaction: data + derived + outbox + audit).
 *
 * Several named databases can coexist (tests simulate several devices in one process);
 * `db()` returns the currently selected one.
 */
import Dexie, { type Table } from "dexie";
import type {
  BankAccount,
  DayStatus,
  ExpenseCategory,
  Godown,
  LedgerLine,
  OutboxOp,
  Party,
  Place,
  Reminder,
  StockMove,
  Transfer,
  Variety,
  Vehicle,
  Voucher,
} from "@/domain/schemas";
import { applyVersions } from "./migrations";

export const DEFAULT_DB_NAME = "dhan-khata";

export interface MetaRow {
  key: string;
  value: unknown;
}

/** Per-day aggregates for fast dashboards. Rebuildable from ledger lines + stock moves. */
export interface DailyAggRow {
  godownId: string;
  date: string;
  /** account → Σdebit / Σcredit (paise, decimal strings) for the day. */
  accounts: Record<string, { dr: string; cr: string }>;
  /** `${varietyId}|${location}` → Σ signed qty (g) and value (paise) for the day. */
  stock: Record<string, { qtyG: string; valuePaise: string }>;
}

export type OutboxRow = OutboxOp & { seq?: number; godownId: string | null };

export interface AuditLocalRow {
  id?: number;
  at: string;
  godownId: string | null;
  userId: string;
  deviceId: string;
  entity: string;
  entityId: string;
  action: "create" | "edit" | "void" | "resolve" | "pull-purge" | "unlock";
  rev?: number;
  reason?: string;
}

export interface ClientErrorRow {
  id?: number;
  at: string;
  route: string;
  message: string;
  stack?: string;
}

export class DhanKhataDB extends Dexie {
  godowns!: Table<Godown, string>;
  parties!: Table<Party, string>;
  varieties!: Table<Variety, string>;
  bankAccounts!: Table<BankAccount, string>;
  vehicles!: Table<Vehicle, string>;
  places!: Table<Place, string>;
  expenseCategories!: Table<ExpenseCategory, string>;
  vouchers!: Table<Voucher, string>;
  ledgerLines!: Table<LedgerLine, string>;
  stockMoves!: Table<StockMove, string>;
  dailyAgg!: Table<DailyAggRow, [string, string]>;
  reminders!: Table<Reminder & { godownId: string }, string>;
  dayStatus!: Table<DayStatus, string>;
  transfers!: Table<Transfer, string>;
  outbox!: Table<OutboxRow, number>;
  meta!: Table<MetaRow, string>;
  auditLocal!: Table<AuditLocalRow, number>;
  clientErrors!: Table<ClientErrorRow, number>;

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name);
    applyVersions(this);
  }
}

const instances = new Map<string, DhanKhataDB>();
let currentName = DEFAULT_DB_NAME;

/** The currently selected device database. */
export function db(): DhanKhataDB {
  let inst = instances.get(currentName);
  if (!inst) {
    inst = new DhanKhataDB(currentName);
    instances.set(currentName, inst);
  }
  return inst;
}

export function currentDbName(): string {
  return currentName;
}

/** Switch the active database (tests: one database per simulated device). */
export function selectDatabase(name: string): DhanKhataDB {
  currentName = name;
  return db();
}

/** Close and delete a database (tests / owner-confirmed reset only). */
export async function deleteDatabase(name: string): Promise<void> {
  const inst = instances.get(name);
  if (inst) {
    inst.close();
    instances.delete(name);
  }
  await Dexie.delete(name);
}

/** Every business table (used by transactions that touch data + derived + outbox). */
export function writeTables(d: DhanKhataDB = db()) {
  return [
    d.godowns,
    d.parties,
    d.varieties,
    d.bankAccounts,
    d.vehicles,
    d.places,
    d.expenseCategories,
    d.vouchers,
    d.ledgerLines,
    d.stockMoves,
    d.dailyAgg,
    d.reminders,
    d.dayStatus,
    d.transfers,
    d.outbox,
    d.meta,
    d.auditLocal,
  ];
}

export class DbOpenError extends Error {
  constructor(
    public readonly kind: "version" | "upgrade" | "other",
    cause: unknown,
  ) {
    super(`DB_OPEN_${kind.toUpperCase()}`, { cause });
    this.name = "DbOpenError";
  }
}

function errName(e: unknown): string {
  if (typeof e !== "object" || e === null) return "";
  const err = e as { name?: string; inner?: { name?: string } };
  return err.inner?.name ?? err.name ?? "";
}

/**
 * Open the database. Version/upgrade failures are surfaced as `DbOpenError` so the app can show
 * the recovery screen (export local data BEFORE any reset), never silently wiping data.
 */
export async function openDb(): Promise<DhanKhataDB> {
  const d = db();
  try {
    if (!d.isOpen()) await d.open();
    return d;
  } catch (e) {
    throw classifyOpenError(e);
  }
}

export function classifyOpenError(e: unknown): DbOpenError {
  const n = errName(e);
  if (n === "VersionError") return new DbOpenError("version", e);
  if (n === "UpgradeError") return new DbOpenError("upgrade", e);
  return new DbOpenError("other", e);
}

/**
 * Read every object store of a database with raw IndexedDB (works even when Dexie can't open it
 * because of a version problem). Used by the recovery screen's "export local data".
 */
export function exportRawDatabase(name: string = currentName): Promise<Record<string, unknown[]>> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const idb = req.result;
      const names = Array.from(idb.objectStoreNames);
      const out: Record<string, unknown[]> = {};
      if (names.length === 0) {
        idb.close();
        resolve(out);
        return;
      }
      const tx = idb.transaction(names, "readonly");
      for (const n of names) {
        const r = tx.objectStore(n).getAll();
        r.onsuccess = () => {
          out[n] = r.result as unknown[];
        };
      }
      tx.oncomplete = () => {
        idb.close();
        resolve(out);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

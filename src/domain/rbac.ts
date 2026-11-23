/**
 * Role-based access, per godown (spec §2). Shared by the client (to hide/deny actions) and the
 * server (which is the only place it is trusted). Pure: no I/O.
 *
 * - The owner has every godown and every permission.
 * - `godownAccess` grants one role per godown; no entry = no access at all (not even read).
 */
import { diffDays } from "./dates";
import type { GodownRole } from "./schemas/system";
import type { VoucherType } from "./schemas/vouchers";

export interface AccessUser {
  isOwner: boolean;
  active?: boolean;
  godownAccess: ReadonlyArray<{ godownId: string; role: GodownRole; consolidated?: boolean }>;
}

export type EffectiveRole = "owner" | GodownRole;

export type Action =
  | "read"
  | "voucher.create"
  | "voucher.edit"
  | "voucher.void"
  | "master.create"
  | "master.edit"
  | "settings.write"
  | "day.unlock"
  | "reports.profit"
  | "godown.create"
  | "godown.archive"
  | "users.manage";

/** [CONFIRM] #8/#17: the `entry` role may edit its own entries for 30 minutes, until synced. */
export const ENTRY_EDIT_WINDOW_MINUTES = 30;

/** Voucher types the `entry` role may create on its own (spec §2). */
export const ENTRY_CREATE_TYPES: ReadonlySet<VoucherType> = new Set([
  "PURCHASE",
  "LOAD",
  "EXPENSE",
]);

/** Owner-only voucher types (go-live balances and the manual journal). */
export const OWNER_ONLY_TYPES: ReadonlySet<VoucherType> = new Set(["OPENING", "JOURNAL"]);

export function roleIn(user: AccessUser, godownId: string): EffectiveRole | null {
  if (user.active === false) return null;
  if (user.isOwner) return "owner";
  return user.godownAccess.find((a) => a.godownId === godownId)?.role ?? null;
}

/** Godowns the user can see. The owner sees every godown in `allGodownIds`. */
export function accessibleGodownIds(user: AccessUser, allGodownIds: readonly string[]): string[] {
  if (user.active === false) return [];
  if (user.isOwner) return [...allGodownIds];
  const granted = new Set(user.godownAccess.map((a) => a.godownId));
  return allGodownIds.filter((g) => granted.has(g));
}

/** Read-only "All godowns" mode: owner, or `consolidated` on ≥ 2 godowns (spec §1.4 rule 4). */
export function canConsolidate(user: AccessUser): boolean {
  if (user.active === false) return false;
  if (user.isOwner) return true;
  return user.godownAccess.filter((a) => a.consolidated).length >= 2;
}

export interface ActionContext {
  voucherType?: VoucherType;
  /** The voucher belongs to a linked group (e.g. purchase + paid-now payment, load → sale). */
  grouped?: boolean;
}

export function can(
  user: AccessUser,
  godownId: string,
  action: Action,
  ctx: ActionContext = {},
): boolean {
  const role = roleIn(user, godownId);
  if (role === null) return false;
  if (role === "owner") return true;
  if (action === "read") return true;
  if (role === "viewer") return false;

  const type = ctx.voucherType;
  if (type && OWNER_ONLY_TYPES.has(type)) return false;

  switch (action) {
    case "voucher.create":
      if (role === "manager") return true;
      // entry: its own entry types, plus vouchers created as part of a linked group.
      return type !== undefined && (ENTRY_CREATE_TYPES.has(type) || ctx.grouped === true);
    case "voucher.edit":
    case "voucher.void":
      // entry may only touch its own recent, unsynced entries: see `entryMayChange`.
      return true;
    case "master.create":
      return true;
    case "master.edit":
      return role === "manager";
    default:
      // settings, day unlock, profit reports, godowns, users: owner only.
      return false;
  }
}

/** The `entry` role's edit window (spec §2): own entry, within 30 minutes, and not yet synced. */
export function entryMayChange(
  doc: { createdBy: string; createdAt: string; serverSeq?: number },
  userId: string,
  nowIso: string,
  opts: { requireUnsynced: boolean },
): boolean {
  if (doc.createdBy !== userId) return false;
  if (opts.requireUnsynced && doc.serverSeq !== undefined) return false;
  const ageMs = Date.parse(nowIso) - Date.parse(doc.createdAt);
  return Number.isFinite(ageMs) && ageMs <= ENTRY_EDIT_WINDOW_MINUTES * 60_000;
}

export interface DayLockInput {
  date: string;
  today: string;
  lockAfterDays: number;
  dayClosed: boolean;
}

/**
 * A business day is locked when it has been closed (DAY_CLOSE) or is older than the godown's
 * `lockAfterDays`. Only the owner may write to a locked day (spec §2 / §9.10).
 */
export function isDayLocked({ date, today, lockAfterDays, dayClosed }: DayLockInput): boolean {
  if (dayClosed) return true;
  return diffDays(date, today) > lockAfterDays;
}

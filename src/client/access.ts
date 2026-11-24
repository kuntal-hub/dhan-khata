/**
 * What the `entry` role may SEE (spec §2, [CONFIRM] #8): its own entries and today's dashboard.
 * The write rules live in `domain/rbac` (`can`, `entryMayChange`) and are enforced by the repo
 * and the server; this module only decides which screens and vouchers the UI shows. Pure and
 * light (safe for the Home route).
 *
 * The device still holds the godown's data (dashboard totals, balances and pickers are computed
 * from it), so this is a UI restriction for trusted field staff, not a security boundary
 * between users of the same godown. Godown isolation stays server-enforced.
 */
import type { EffectiveRole } from "@/domain/rbac";

/** Screens an `entry` user may open. Everything else shows "not for your role". */
export const ENTRY_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/purchase",
  "/purchase/new",
  "/purchase/edit",
  "/purchase/view",
  "/load",
  "/load/new",
  "/load/edit",
  "/load/view",
  "/expense",
  "/expense/new",
  "/expense/edit",
  // Generic view (expense) and the linked vouchers an entry creates with its own entries:
  // the paid-now payment of a purchase, the sale/purchase pair of a load.
  "/voucher/view",
  "/payment/view",
  "/sale/view",
  "/print/voucher",
  "/more",
  "/settings",
  "/sync",
]);

function normalize(path: string): string {
  const p = path.split(/[?#]/)[0] ?? "/";
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p || "/";
}

/** May this role open `path` (with or without a query string)? */
export function mayOpenPath(role: EffectiveRole | null, path: string): boolean {
  if (role !== "entry") return true;
  return ENTRY_PATHS.has(normalize(path));
}

/** The `entry` role sees only vouchers it created itself. */
export function mayViewVoucher(
  role: EffectiveRole | null,
  userId: string | null,
  v: { createdBy: string },
): boolean {
  if (role !== "entry") return true;
  return userId !== null && v.createdBy === userId;
}

/** Keep only what the role may see (lists, today's entries). */
export function visibleVouchers<T extends { createdBy: string }>(
  role: EffectiveRole | null,
  userId: string | null,
  list: readonly T[],
): T[] {
  return role === "entry" ? list.filter((v) => mayViewVoucher(role, userId, v)) : [...list];
}

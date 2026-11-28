/**
 * Vehicle owners of the purchase vehicle fare (DECISIONS D56): who counts as "the same person".
 * Pure; shared by the duplicate check (one Gola) and the cross-Gola owner list (read-only).
 *
 * Two entries are the same owner when their names match (case, extra spaces ignored) and their
 * mobiles don't contradict each other (equal, or one of them has none). Two people with the same
 * name and different mobiles are different owners.
 */
import { normalizePhone } from "./phone";

export interface OwnerIdentity {
  name: string;
  phone?: string;
}

/** Lower-case, trimmed, single-spaced name. */
export function normalizeOwnerName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function phoneOf(p: string | undefined): string | undefined {
  if (!p?.trim()) return undefined;
  return normalizePhone(p) ?? p.trim();
}

export function isSameOwner(a: OwnerIdentity, b: OwnerIdentity): boolean {
  if (normalizeOwnerName(a.name) !== normalizeOwnerName(b.name)) return false;
  const pa = phoneOf(a.phone);
  const pb = phoneOf(b.phone);
  return !pa || !pb || pa === pb;
}

/** The first entry in `list` that is the same owner as `who` (skipping `exceptId`). */
export function findSameOwner<T extends OwnerIdentity & { _id: string }>(
  list: readonly T[],
  who: OwnerIdentity,
  exceptId?: string,
): T | undefined {
  return list.find((x) => x._id !== exceptId && isSameOwner(x, who));
}

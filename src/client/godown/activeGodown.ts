/**
 * Active godown (spec §1.4 rule 3): always one active godown, remembered per device in `meta`,
 * switchable instantly offline. Only godowns the signed-in user can access are offered.
 */
import { accessibleGodownIds } from "@/domain/rbac";
import type { Godown } from "@/domain/schemas";
import { db } from "../db/dexie";
import { META, getMeta, getSession, setMeta } from "../db/meta";

function sortGodowns(list: Godown[]): Godown[] {
  return [...list].sort((a, b) =>
    a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1,
  );
}

/** Godowns on this device the current user may access (active first, then archived). */
export async function accessibleLocalGodowns(): Promise<Godown[]> {
  const session = await getSession();
  if (!session) return [];
  const all = await db().godowns.toArray();
  const ids = new Set(
    accessibleGodownIds(
      session.user,
      all.map((g) => g._id),
    ),
  );
  return sortGodowns(all.filter((g) => ids.has(g._id)));
}

/** The remembered active godown if still accessible, else the first active one (persisted). */
export async function restoreActiveGodown(): Promise<string | null> {
  const list = await accessibleLocalGodowns();
  const saved = await getMeta<string>(META.activeGodownId);
  if (saved && list.some((g) => g._id === saved)) return saved;
  const first = list.find((g) => g.status === "active") ?? list[0];
  if (first) await setMeta(META.activeGodownId, first._id);
  return first?._id ?? null;
}

export async function persistActiveGodown(godownId: string): Promise<void> {
  await setMeta(META.activeGodownId, godownId);
}

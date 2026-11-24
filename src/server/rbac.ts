/**
 * Server-side authorization. The pure rules live in `src/domain/rbac.ts` (shared with the
 * client, which only uses them for convenience); the server is the only place they are trusted.
 */
import type { Db } from "mongodb";
import { accessibleGodownIds, can, canConsolidate, roleIn, type AccessUser } from "@/domain/rbac";
import { cols } from "./db";

export { can, canConsolidate, roleIn, accessibleGodownIds };

/**
 * Gola ids this user may access: the owner gets every Gola OF HIS BUSINESS (archived included);
 * never another business's Golas (§2.4).
 */
export async function godownIdsFor(
  db: Db,
  user: AccessUser & { businessId: string },
): Promise<string[]> {
  if (user.active === false) return [];
  if (user.isOwner) {
    const all = await cols(db)
      .godowns.find({ businessId: user.businessId }, { projection: { _id: 1 } })
      .toArray();
    return all.map((g) => g._id).sort();
  }
  const ids = user.godownAccess.map((a) => a.godownId);
  if (ids.length === 0) return [];
  const existing = await cols(db)
    .godowns.find({ _id: { $in: ids }, businessId: user.businessId }, { projection: { _id: 1 } })
    .toArray();
  return existing.map((g) => g._id).sort();
}

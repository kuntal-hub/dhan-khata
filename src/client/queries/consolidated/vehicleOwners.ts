/**
 * Vehicle owners across the owner's Golas (DECISIONS D56). Read-only, like the rest of
 * `consolidated`: it lists owners saved in OTHER Golas so the purchase form can bring one in with
 * one tap (the copy is written by `importVehicleOwner` into the active Gola only), and shows one
 * owner's fare totals side by side per Gola. Books are never mixed: each Gola keeps its own party.
 */
import {
  findSameOwner,
  isSameOwner,
  normalizeOwnerName,
  type OwnerIdentity,
} from "@/domain/vehicleOwner";
import type { Party } from "@/domain/schemas";
import { db } from "../../db/dexie";
import { vehicleOwnerSummaries, type OwnerSummary } from "../fares";

export interface OtherGolaOwner {
  godownId: string;
  party: Party;
}

/**
 * Owners (role TRANSPORTER) of the other Golas in `godownIds` that this Gola doesn't have yet,
 * one per person (the same person saved in two other Golas is listed once).
 */
export async function ownersFromOtherGolas(
  godownId: string,
  godownIds: readonly string[],
): Promise<OtherGolaOwner[]> {
  const here = (await db().parties.where("godownId").equals(godownId).toArray()).filter(
    (p) => p.status === "active" && p.roles.includes("TRANSPORTER"),
  );
  const out: OtherGolaOwner[] = [];
  for (const g of godownIds) {
    if (g === godownId) continue;
    const theirs = (await db().parties.where("godownId").equals(g).toArray()).filter(
      (p) => p.status === "active" && p.roles.includes("TRANSPORTER"),
    );
    for (const party of theirs) {
      if (findSameOwner(here, party)) continue;
      if (out.some((o) => isSameOwner(o.party, party))) continue;
      out.push({ godownId: g, party });
    }
  }
  return out.sort((a, b) =>
    normalizeOwnerName(a.party.name).localeCompare(normalizeOwnerName(b.party.name)),
  );
}

/** The same owner's fare totals in every Gola of `godownIds` where he is saved. */
export async function ownerAcrossGolas(
  who: OwnerIdentity,
  godownIds: readonly string[],
): Promise<Array<{ godownId: string; summary: OwnerSummary }>> {
  const out: Array<{ godownId: string; summary: OwnerSummary }> = [];
  for (const g of godownIds) {
    const summary = (await vehicleOwnerSummaries(g)).find((s) => isSameOwner(s.party, who));
    if (summary) out.push({ godownId: g, summary });
  }
  return out;
}

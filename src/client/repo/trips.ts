/**
 * Vehicle trips (requirement_v2 §12.7). A trip is one income bill (customer, VEHICLE_TRIP) plus one
 * bill per cost (driver, diesel, other: VEHICLE_COST `trip:cost`). Saving a new trip writes the
 * trip, the advance received and each cost "paid now" in ONE op group. Later collections and cost
 * payments use `payBill(..., { sourceId })`. A cost that already has payments can't be removed.
 */
import { vehicleCostSourceId } from "@/domain/v2/payments";
import type { Doc, DocOf } from "@/domain/schemas";
import { db } from "../db/dexie";
import { RepoError } from "./context";
import {
  newId,
  paymentsOfSource,
  saveDocs,
  type DocDraft,
  type DraftOf,
  type SaveItem,
} from "./docs";
import type { PaymentPart } from "./payments";

type Trip = DocOf<"TRIP">;

export interface TripPayments {
  /** Advance received from the customer now (IN). */
  advance?: PaymentPart | null;
  /** Costs paid now, by cost id (OUT). */
  costs?: Record<string, PaymentPart>;
}

export async function saveTrip(
  godownId: string,
  draft: DraftOf<"TRIP">,
  pays: TripPayments = {},
  opts: { id?: string; reason?: string } = {},
): Promise<Doc[]> {
  if (opts.id) {
    const existing = await db().vouchers.get(opts.id);
    if (!existing || existing.type !== "TRIP") throw new RepoError("NOT_FOUND", opts.id);
    const kept = new Set(draft.costs.map((c) => c.id));
    const paid = await paymentsOfSource(existing._id);
    for (const p of paid) {
      if (p.type !== "PAYMENT" || p.source.type !== "VEHICLE_COST") continue;
      const costId = p.source.id!.split(":")[1]!;
      if (!kept.has(costId)) throw new RepoError("LINKED_PAYMENTS", costId);
    }
    return saveDocs(godownId, [{ id: opts.id, draft }], opts.reason ? { reason: opts.reason } : {});
  }
  const id = draft._id ?? newId();
  const trip = { ...draft, _id: id } as Trip;
  const items: SaveItem[] = [{ draft: trip as unknown as DocDraft }];
  if (pays.advance && BigInt(pays.advance.amountPaise) > 0n) {
    if (!draft.customerPartyId) throw new RepoError("PARTY_REQUIRED");
    items.push({
      draft: {
        ...pays.advance,
        type: "PAYMENT",
        direction: "IN",
        partyId: draft.customerPartyId,
        source: { type: "VEHICLE_TRIP", id },
        isInitial: true,
      } as DocDraft,
    });
  }
  for (const c of draft.costs) {
    const part = pays.costs?.[c.id];
    if (!part || BigInt(part.amountPaise) <= 0n) continue;
    if (BigInt(part.amountPaise) > BigInt(c.amountPaise)) {
      throw new RepoError("OVERPAYMENT", c.id);
    }
    items.push({
      draft: {
        ...part,
        type: "PAYMENT",
        direction: "OUT",
        ...(c.partyId ? { partyId: c.partyId } : {}),
        source: { type: "VEHICLE_COST", id: vehicleCostSourceId(trip, c.id) },
        isInitial: true,
      } as DocDraft,
    });
  }
  return saveDocs(godownId, items);
}

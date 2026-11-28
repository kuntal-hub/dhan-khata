/**
 * Purchase vehicle fare (DECISIONS D56).
 *  - Vehicle owners are parties with role TRANSPORTER, one list per Gola, never duplicated
 *    (`findSameOwner`: same name, mobiles not contradicting). An owner saved in another Gola is
 *    brought in with one tap (`importVehicleOwner`: a copy in this Gola, books stay separate).
 *  - The fare lives on the purchase (`vehicleFare`); paying it now is a VEHICLE_FARE payment in the
 *    purchase's op group (`farePaymentItem`); paying later goes across the owner's open fares,
 *    oldest first (`payVehicleOwner`), never more than he is owed.
 */
import { findSameOwner, type OwnerIdentity } from "@/domain/vehicleOwner";
import { todayIST } from "@/domain/dates";
import { allocateFifo, billState, billsOf } from "@/domain/v2/payments";
import type { Doc, Party, Payment, VehicleFare } from "@/domain/schemas";
import { db, writeTables } from "../db/dexie";
import { RepoError, writeContext, type WriteCtx } from "./context";
import type { DocDraft, SaveItem } from "./docs";
import { upsertMasterInTx } from "./masters";
import { emitLocalWrite } from "./notify";
import { payParty, type PaymentPart } from "./payments";

export interface OwnerInput {
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
}

async function activeParties(godownId: string): Promise<Party[]> {
  return (await db().parties.where("godownId").equals(godownId).toArray()).filter(
    (p) => p.status === "active",
  );
}

/** The party as master input (bookkeeping and derived fields left to the write path). */
function asInput(p: Party): Record<string, unknown> {
  const { serverSeq: _s, searchKey: _k, ...rest } = p as Party & { serverSeq?: number };
  return rest;
}

async function withRole(ctx: WriteCtx, p: Party): Promise<Party> {
  if (p.roles.includes("TRANSPORTER")) return p;
  return upsertMasterInTx(ctx, "party", {
    ...asInput(p),
    roles: [...p.roles, "TRANSPORTER"],
  } as never);
}

async function inTx<T>(godownId: string, fn: (ctx: WriteCtx) => Promise<T>): Promise<T> {
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () =>
    fn(await writeContext(godownId)),
  );
  emitLocalWrite();
  return out;
}

/**
 * Add a vehicle owner, or edit one (`id`). Refuses a second entry for the same person in this
 * Gola with DUPLICATE_PARTY (detail = the existing party's id, so the screen can offer it).
 */
export async function saveVehicleOwner(
  godownId: string,
  input: OwnerInput,
  id?: string,
): Promise<Party> {
  const name = input.name.trim();
  if (!name) throw new RepoError("VALIDATION_FAILED", "name");
  const phone = input.phone?.trim() || undefined;
  return inTx(godownId, async (ctx) => {
    const parties = await activeParties(godownId);
    const dup = findSameOwner(parties, { name, ...(phone ? { phone } : {}) }, id);
    if (dup) throw new RepoError("DUPLICATE_PARTY", dup._id);
    const existing = id ? parties.find((p) => p._id === id) : undefined;
    if (id && !existing) throw new RepoError("NOT_FOUND", id);
    const base = existing ? asInput(existing) : { roles: ["TRANSPORTER"] };
    // The form edits name, mobile and address (notes only when given); other fields stay.
    const { phone: _p, address: _a, ...rest } = base as Record<string, unknown>;
    if (input.notes !== undefined) delete rest.notes;
    const roles = (rest.roles as Party["roles"] | undefined) ?? [];
    return upsertMasterInTx(ctx, "party", {
      ...rest,
      name,
      roles: roles.includes("TRANSPORTER") ? roles : [...roles, "TRANSPORTER"],
      ...(phone ? { phone } : {}),
      ...(input.address?.trim() ? { address: input.address.trim() } : {}),
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    } as never);
  });
}

/** Use an existing party of this Gola as a vehicle owner (adds the role when missing). */
export async function adoptVehicleOwner(godownId: string, partyId: string): Promise<Party> {
  return inTx(godownId, async (ctx) => {
    const p = await db().parties.get(partyId);
    if (!p || p.godownId !== godownId || p.status !== "active")
      throw new RepoError("NOT_FOUND", partyId);
    return withRole(ctx, p);
  });
}

/**
 * Bring an owner saved in another Gola into this one (one tap): the same person already here is
 * reused, otherwise a copy (name, mobile, address) is created. Nothing is shared between books.
 */
export async function importVehicleOwner(
  godownId: string,
  from: OwnerIdentity & { address?: string },
): Promise<Party> {
  return inTx(godownId, async (ctx) => {
    const here = findSameOwner(await activeParties(godownId), from);
    if (here) return withRole(ctx, here);
    return upsertMasterInTx(ctx, "party", {
      name: from.name.trim(),
      roles: ["TRANSPORTER"],
      ...(from.phone ? { phone: from.phone } : {}),
      ...(from.address ? { address: from.address } : {}),
    } as never);
  });
}

/**
 * The "fare paid now" payment of a new purchase (saved in the purchase's op group). Never before
 * the purchase's date and never more than the fare.
 */
export function farePaymentItem(
  purchaseId: string,
  purchaseDate: string,
  fare: VehicleFare,
  part: PaymentPart,
): SaveItem {
  if (part.paymentDate < purchaseDate) throw new RepoError("PAYMENT_BEFORE_DEAL", purchaseDate);
  const amount = BigInt(part.amountPaise);
  if (amount > BigInt(fare.amountPaise))
    throw new RepoError("OVERPAYMENT", (amount - BigInt(fare.amountPaise)).toString());
  const bill = billsOf({
    _id: purchaseId,
    type: "PURCHASE",
    status: "active",
    totalPaise: fare.amountPaise,
    transactionDate: purchaseDate,
    partyId: "",
    vehicleFare: fare,
  } as unknown as Doc)[1]!;
  return {
    draft: {
      ...part,
      type: "PAYMENT",
      direction: bill.direction,
      partyId: fare.ownerPartyId,
      source: { type: bill.sourceType, id: bill.sourceId },
      isInitial: true,
    } as DocDraft,
  };
}

/**
 * Pay a vehicle owner across his open fares in this Gola, oldest first. Only fares dated on or
 * before the payment date take part; more than he is owed is refused (OVERPAYMENT, detail = the
 * extra). One payment record per fare, one group.
 */
export async function payVehicleOwner(
  godownId: string,
  partyId: string,
  part: PaymentPart,
): Promise<Doc[]> {
  const docs = (
    await db().vouchers.where("[godownId+type]").equals([godownId, "PURCHASE"]).toArray()
  )
    .filter((d) => d.status === "active" && d.type === "PURCHASE")
    .filter((d) => d.type === "PURCHASE" && d.vehicleFare?.ownerPartyId === partyId);
  const today = todayIST();
  const open = [];
  const byId = new Map<string, Doc>();
  for (const doc of docs) {
    const fareBill = billsOf(doc).find((b) => b.sourceType === "VEHICLE_FARE");
    if (!fareBill || fareBill.date > part.paymentDate) continue;
    const pays = (
      await db().vouchers.where("source.id").equals(fareBill.sourceId).toArray()
    ).filter((p): p is Payment => p.type === "PAYMENT" && p.status === "active");
    const st = billState(fareBill, pays, today);
    if (st.duePaise > 0n) {
      open.push(st);
      byId.set(fareBill.sourceId, doc);
    }
  }
  const { allocations, advancePaise } = allocateFifo(BigInt(part.amountPaise), open);
  if (advancePaise > 0n) throw new RepoError("OVERPAYMENT", advancePaise.toString());
  return payParty(
    godownId,
    partyId,
    "OUT",
    part,
    allocations.map((a) => ({
      source: byId.get(a.sourceId)!,
      sourceId: a.sourceId,
      amountPaise: a.amountPaise,
    })),
  );
}

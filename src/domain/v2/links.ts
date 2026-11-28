/**
 * Cross-document rules (shared by the local repo and the server), checked after Gola scoping:
 *  - a payment settles exactly one source of the right type, party and direction (§7.2; the
 *    direction comes from `direction.ts`, never from the UI);
 *  - a mill return / conversion / final settlement belongs to its dispatch (same mill, variety;
 *    a settlement also copies the dispatch rate) (§12.8);
 *  - linked loads point at loads.
 * `get` resolves referenced documents (prefetched by the caller).
 */
import { DomainError } from "../errors";
import { sourceDocId } from "../scope";
import { assertPaymentDirection } from "./direction";
import { billsOf, vehicleFareSourceId } from "./payments";
import type { Doc, DocOf } from "./schemas";

export type DocGetter = (id: string) => Doc | undefined;

const fail = (
  detail: string,
  code: ConstructorParameters<typeof DomainError>[0] = "SOURCE_MISMATCH",
): never => {
  throw new DomainError(code, detail);
};

function need<T extends Doc["type"]>(get: DocGetter, id: string, type: T): DocOf<T> {
  const d = get(id);
  if (!d || d.type !== type) return fail(`${type}:${id}`, "INVALID_REFERENCE");
  return d as DocOf<T>;
}

/** Throws a DomainError when `d` breaks a cross-document rule. Void documents are not checked. */
export function validateLinks(d: Doc, get: DocGetter): void {
  if (d.status === "void") return;
  switch (d.type) {
    case "PAYMENT":
      return validatePaymentSource(d, get);
    case "MILL_RETURN": {
      const di = need(get, d.dispatchId, "MILL_DISPATCH");
      if (di.millPartyId !== d.millPartyId) fail("millPartyId");
      if (d.product === "PADDY" && d.varietyId !== di.varietyId) fail("varietyId");
      return;
    }
    case "MILL_SETTLEMENT": {
      const di = need(get, d.dispatchId, "MILL_DISPATCH");
      if (di.status !== "active") fail(`dispatch:${d.dispatchId}`, "INVALID_REFERENCE");
      if (di.millPartyId !== d.millPartyId || di.varietyId !== d.varietyId) fail("dispatch");
      if (di.ratePaisePerQtl !== d.dispatchRatePaisePerQtl) fail("dispatchRatePaisePerQtl");
      return;
    }
    case "CONVERSION": {
      const di = need(get, d.dispatchId, "MILL_DISPATCH");
      if (di.millPartyId !== d.millPartyId || di.varietyId !== d.varietyId) fail("dispatch");
      for (const o of d.outputs) {
        const r = need(get, o.returnId, "MILL_RETURN");
        if (r.status !== "active" || r.dispatchId !== d.dispatchId) fail(`return:${o.returnId}`);
        if (r.product !== o.product || r.weight.netG !== o.qtyG) fail(`return:${o.returnId}`);
        if (o.product === "OTHER" && r.otherProductName !== o.name) fail(`return:${o.returnId}`);
        if ((o.valuePaise ?? undefined) !== (r.totalValuePaise ?? undefined))
          fail(`value:${o.returnId}`);
      }
      return;
    }
    case "SALE": {
      // Legacy consignment sales (v2.0) only; nothing new sets `consignmentDispatchId`.
      if (d.consignmentDispatchId) {
        const di = need(get, d.consignmentDispatchId, "MILL_DISPATCH");
        if (d.sourceMillId !== di.millPartyId || d.partyId !== di.millPartyId) fail("mill");
        if (d.varietyId !== di.varietyId) fail("varietyId");
      }
      if (d.linkedLoadId) need(get, d.linkedLoadId, "LOAD");
      return;
    }
    case "PURCHASE":
    case "MILL_DISPATCH":
      if (d.linkedLoadId) need(get, d.linkedLoadId, "LOAD");
      return;
    case "LOAD":
      if (d.link) need(get, d.link.id, d.link.type);
      return;
    default:
      return;
  }
}

function validatePaymentSource(p: DocOf<"PAYMENT">, get: DocGetter): void {
  const { type, id } = p.source;
  // The direction always comes from the source type (v2.1 direction map).
  assertPaymentDirection(type, p.direction);
  if (id === null) {
    if (type !== "PARTY_ADVANCE" && type !== "SECOND_PARTY" && type !== "MILL_REFUND")
      fail("source.id");
    return;
  }
  if (type === "PARTY_ADVANCE") fail("source.id");
  const src = get(sourceDocId(id));
  if (!src || src.status !== "active") return fail(`source:${id}`, "INVALID_REFERENCE");
  if (type === "MILL_REFUND") {
    // A refund may name the dispatch the mill overpaid; it must be that dispatch's mill.
    if (src.type !== "MILL_DISPATCH" || src._id !== id) return fail(`source:${type}:${id}`);
    if (p.partyId !== src.millPartyId) fail("partyId");
    return;
  }
  const bill = billsOf(src).find((b) => b.sourceType === type && b.sourceId === id);
  if (!bill) return fail(`source:${type}:${id}`);
  if ((bill.partyId ?? undefined) !== (p.partyId ?? undefined)) fail("partyId");
  if (bill.direction !== p.direction) fail("direction", "PAYMENT_DIRECTION_MISMATCH");
}

/**
 * v2.1 final-settlement guard (shared by the device and the server). Writing `d` requires that
 * the returned dispatch has NO active MILL_SETTLEMENT (other than `exceptId`), else
 * `ALREADY_LINKED`: one settlement per dispatch; a settled dispatch takes no new return or
 * conversion and keeps its mill, variety, rate and weight (reverse the settlement first).
 */
export function settlementGuard(
  d: Doc,
  existing?: Doc,
): { dispatchId: string; exceptId?: string } | null {
  if (d.status !== "active") return null;
  switch (d.type) {
    case "MILL_SETTLEMENT":
      return { dispatchId: d.dispatchId, exceptId: d._id };
    case "MILL_RETURN":
    case "CONVERSION":
      return { dispatchId: d.dispatchId };
    case "MILL_DISPATCH": {
      if (!existing || existing.type !== "MILL_DISPATCH") return null;
      const changed =
        existing.millPartyId !== d.millPartyId ||
        existing.varietyId !== d.varietyId ||
        existing.ratePaisePerQtl !== d.ratePaisePerQtl ||
        existing.weight.netG !== d.weight.netG;
      return changed ? { dispatchId: d._id } : null;
    }
    default:
      return null;
  }
}

/**
 * Vehicle-fare guard for a purchase edit (device and server): when the edit removes the fare or
 * changes its vehicle owner, returns the fare's payment source id. The caller refuses the edit
 * with LINKED_PAYMENTS if that source has active payments (they'd settle someone else's fare).
 */
export function fareBillChanged(existing: Doc, next: Doc): string | null {
  if (existing.type !== "PURCHASE" || !existing.vehicleFare) return null;
  const fare = next.type === "PURCHASE" ? next.vehicleFare : undefined;
  if (fare && fare.ownerPartyId === existing.vehicleFare.ownerPartyId) return null;
  return vehicleFareSourceId(existing._id);
}

/** Document ids a document needs resolved for `validateLinks`. */
export function linkedDocIds(d: Doc): string[] {
  switch (d.type) {
    case "PAYMENT":
      return d.source.id ? [sourceDocId(d.source.id)] : [];
    case "MILL_RETURN":
    case "MILL_SETTLEMENT":
      return [d.dispatchId];
    case "CONVERSION":
      return [d.dispatchId, ...d.outputs.map((o) => o.returnId)];
    case "SALE":
      return [d.consignmentDispatchId, d.linkedLoadId].filter((x): x is string => !!x);
    case "PURCHASE":
    case "MILL_DISPATCH":
      return d.linkedLoadId ? [d.linkedLoadId] : [];
    case "LOAD":
      return d.link ? [d.link.id] : [];
    default:
      return [];
  }
}

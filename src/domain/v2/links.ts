/**
 * Cross-document rules (shared by the local repo and the server), checked after Gola scoping:
 *  - a payment settles exactly one source of the right type, party and direction (§7.2);
 *  - a mill return / conversion belongs to its dispatch (same mill, variety; conversion only for
 *    MILLING dispatches) (§12.8);
 *  - a consignment settlement sale belongs to a CONSIGNMENT dispatch of the same mill (§12.8E);
 *  - linked loads point at loads.
 * `get` resolves referenced documents (prefetched by the caller).
 */
import { DomainError } from "../errors";
import { sourceDocId } from "../scope";
import { billsOf } from "./payments";
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
    case "CONVERSION": {
      const di = need(get, d.dispatchId, "MILL_DISPATCH");
      if (di.dispatchType !== "MILLING") fail("dispatchType", "DISPATCH_TYPE_MISMATCH");
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
      if (d.consignmentDispatchId) {
        const di = need(get, d.consignmentDispatchId, "MILL_DISPATCH");
        if (di.dispatchType !== "CONSIGNMENT") fail("dispatchType", "DISPATCH_TYPE_MISMATCH");
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
  if (id === null) {
    if (type !== "PARTY_ADVANCE" && type !== "SECOND_PARTY") fail("source.id");
    return;
  }
  if (type === "PARTY_ADVANCE") fail("source.id");
  const src = get(sourceDocId(id));
  if (!src || src.status !== "active") return fail(`source:${id}`, "INVALID_REFERENCE");
  const bill = billsOf(src).find((b) => b.sourceType === type && b.sourceId === id);
  if (!bill) return fail(`source:${type}:${id}`);
  if ((bill.partyId ?? undefined) !== (p.partyId ?? undefined)) fail("partyId");
  if (bill.direction !== p.direction) fail("direction");
}

/** Document ids a document needs resolved for `validateLinks`. */
export function linkedDocIds(d: Doc): string[] {
  switch (d.type) {
    case "PAYMENT":
      return d.source.id ? [sourceDocId(d.source.id)] : [];
    case "MILL_RETURN":
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

/**
 * Gola scoping (requirement_v2 §2.4): a document may only reference parties, bank accounts,
 * vehicles, varieties, categories and documents of the SAME Gola. Checked on client and server.
 */
import { DomainError } from "./errors";
import type { Doc } from "./v2/schemas";

export type RefKind =
  "party" | "bankAccount" | "vehicle" | "variety" | "expenseCategory" | "place" | "voucher";

export interface Ref {
  kind: RefKind;
  /** Document id; for expenseCategory this is the category code. */
  id: string;
}

/** Resolve the Gola a referenced record belongs to (undefined = not found). */
export type GodownLookup = (ref: Ref) => string | undefined;

/** The document id behind a payment source id (`tripId:costId`, `openingId:partyId`). */
export function sourceDocId(id: string): string {
  const i = id.indexOf(":");
  return i === -1 ? id : id.slice(0, i);
}

/** Every cross-record reference a document makes. */
export function collectRefs(d: Doc): Ref[] {
  const refs: Ref[] = [];
  const add = (kind: RefKind, id: string | undefined | null) => {
    if (id) refs.push({ kind, id });
  };
  // groupId is a grouping key, not a reference.
  switch (d.type) {
    case "PURCHASE":
      add("party", d.partyId);
      add("variety", d.varietyId);
      add("voucher", d.linkedLoadId);
      break;
    case "SALE":
      add("party", d.partyId);
      add("variety", d.varietyId);
      add("party", d.sourceMillId);
      add("voucher", d.linkedLoadId);
      add("voucher", d.consignmentDispatchId);
      break;
    case "PAYMENT":
      add("party", d.partyId);
      add("bankAccount", d.bankAccountId);
      if (d.source.id) add("voucher", sourceDocId(d.source.id));
      break;
    case "EXPENSE":
      add("expenseCategory", d.categoryCode);
      add("party", d.partyId);
      add("vehicle", d.vehicleId);
      add("voucher", d.linkedTripId);
      break;
    case "LOAD":
      add("party", d.fromPartyId);
      add("party", d.destinationMillId);
      add("party", d.secondPartyId);
      add("variety", d.varietyId);
      add("voucher", d.link?.id);
      break;
    case "MILL_DISPATCH":
      add("party", d.millPartyId);
      add("variety", d.varietyId);
      add("voucher", d.linkedLoadId);
      break;
    case "MILL_RETURN":
      add("voucher", d.dispatchId);
      add("party", d.millPartyId);
      add("variety", d.varietyId);
      break;
    case "CONVERSION":
      add("voucher", d.dispatchId);
      add("party", d.millPartyId);
      add("variety", d.varietyId);
      d.outputs.forEach((o) => {
        add("voucher", o.returnId);
        add("variety", o.varietyId);
      });
      break;
    case "TRIP":
      add("party", d.customerPartyId);
      add("vehicle", d.vehicleId);
      add("voucher", d.linkedSaleId);
      add("voucher", d.linkedLoadId);
      d.costs.forEach((c) => add("party", c.partyId));
      break;
    case "SECOND_PARTY":
      add("party", d.partyId);
      break;
    case "STOCK_ADJUST":
      d.lines.forEach((l) => {
        add("variety", l.varietyId);
        add("party", l.millPartyId);
      });
      break;
    case "CONTRA":
      add("bankAccount", d.bankAccountId);
      add("bankAccount", d.toBankAccountId);
      break;
    case "OPENING":
      d.items.forEach((it) => {
        if (it.kind === "BANK") add("bankAccount", it.refId);
        if (it.kind === "PARTY") add("party", it.refId);
        add("variety", it.varietyId);
        add("party", it.millPartyId);
      });
      break;
    case "DAY_CLOSE":
      break;
  }
  return refs;
}

export type ScopeCheck =
  { ok: true } | { ok: false; code: "CROSS_GODOWN_REFERENCE" | "INVALID_REFERENCE"; ref: Ref };

/** Every reference must exist and belong to `doc.godownId`. */
export function checkSameGodown(d: Doc, lookup: GodownLookup): ScopeCheck {
  return checkRefs(d.godownId, collectRefs(d), lookup);
}

export function assertSameGodown(d: Doc, lookup: GodownLookup): void {
  const r = checkSameGodown(d, lookup);
  if (!r.ok) throw new DomainError(r.code, `${r.ref.kind}:${r.ref.id}`);
}

/** Same-Gola references made by master records (e.g. a vehicle's owner/driver party). */
export function collectMasterRefs(entity: string, doc: Record<string, unknown>): Ref[] {
  const refs: Ref[] = [];
  const add = (kind: RefKind, id: unknown) => {
    if (typeof id === "string" && id.length > 0) refs.push({ kind, id });
  };
  if (entity === "vehicle") {
    add("party", doc.ownerPartyId);
    add("party", doc.driverPartyId);
  }
  return refs;
}

export function checkRefs(
  godownId: string,
  refs: readonly Ref[],
  lookup: GodownLookup,
): ScopeCheck {
  for (const ref of refs) {
    const g = lookup(ref);
    if (g === undefined) return { ok: false, code: "INVALID_REFERENCE", ref };
    if (g !== godownId) return { ok: false, code: "CROSS_GODOWN_REFERENCE", ref };
  }
  return { ok: true };
}

/** `godownId` is immutable: an edit may never move a record to another Gola. */
export function assertGodownUnchanged(
  before: { godownId: string },
  after: { godownId: string },
): void {
  if (before.godownId !== after.godownId) throw new DomainError("GODOWN_IMMUTABLE");
}

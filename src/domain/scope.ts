/**
 * Godown scoping (spec §1.4): a voucher may only reference parties, bank accounts, vehicles,
 * varieties, categories, places and vouchers of the SAME godown. Checked on client and server.
 */
import { DomainError } from "./errors";
import type { Voucher } from "./schemas/vouchers";

export type RefKind =
  "party" | "bankAccount" | "vehicle" | "variety" | "expenseCategory" | "place" | "voucher";

export interface Ref {
  kind: RefKind;
  /** Document id; for expenseCategory this is the category code. */
  id: string;
}

/** Resolve the godown a referenced record belongs to (undefined = not found). */
export type GodownLookup = (ref: Ref) => string | undefined;

/** Every cross-record reference a voucher makes. */
export function collectRefs(v: Voucher): Ref[] {
  const refs: Ref[] = [];
  const add = (kind: RefKind, id: string | undefined) => {
    if (id) refs.push({ kind, id });
  };
  // Note: groupId is a grouping key, not a document reference.
  switch (v.type) {
    case "PURCHASE":
      add("party", v.partyId);
      v.lines.forEach((l) => add("variety", l.varietyId));
      add("bankAccount", v.paidNow?.bankAccountId);
      add("voucher", v.loadId);
      break;
    case "SALE":
      add("party", v.partyId);
      add("party", v.millPartyId);
      add("vehicle", v.vehicleId);
      v.lines.forEach((l) => add("variety", l.varietyId));
      add("party", v.loading?.labourPartyId);
      add("party", v.delivery?.transporterPartyId);
      add("bankAccount", v.vehicleAdvance?.bankAccountId);
      add("bankAccount", v.advanceReceived?.bankAccountId);
      add("voucher", v.loadId);
      break;
    case "LOAD":
      add("place", v.loadPlaceId);
      add("party", v.fromPartyId);
      add("party", v.toMillPartyId);
      add("party", v.secondPartyId);
      add("variety", v.varietyId);
      add("voucher", v.linkedPurchaseId);
      add("voucher", v.linkedSaleId);
      break;
    case "PAYMENT":
    case "RECEIPT":
      add("party", v.partyId);
      add("bankAccount", v.ourBankAccountId);
      v.allocations?.forEach((a) => add("voucher", a.voucherId));
      break;
    case "EXPENSE":
      add("expenseCategory", v.categoryCode);
      add("bankAccount", v.bankAccountId);
      add("party", v.payeePartyId);
      add("voucher", v.loadId);
      add("vehicle", v.vehicleId);
      break;
    case "TRIP":
      add("vehicle", v.vehicleId);
      add("party", v.driverPartyId);
      add("party", v.hirerPartyId);
      add("bankAccount", v.advanceBankAccountId);
      add("voucher", v.ownTradeLoadId);
      v.expenses.forEach((e) => {
        add("bankAccount", e.bankAccountId);
        add("party", e.creditPartyId);
      });
      break;
    case "CONTRA":
      add("bankAccount", v.bankAccountId);
      add("bankAccount", v.toBankAccountId);
      add("party", v.partyId);
      add("voucher", v.receiptVoucherId);
      break;
    case "STOCK_ADJUST":
      v.lines.forEach((l) => add("variety", l.varietyId));
      break;
    case "MILL_SETTLEMENT":
      add("voucher", v.saleId);
      add("party", v.partyId);
      break;
    case "OPENING":
      v.items.forEach((it) => {
        if (it.kind === "BANK") add("bankAccount", it.refId);
        if (it.kind === "PARTY") add("party", it.refId);
        add("variety", it.varietyId);
      });
      break;
    case "JOURNAL":
      v.lines.forEach((l) => {
        add("party", l.partyId);
        if (l.account.startsWith("PARTY:")) add("party", l.account.slice(6));
        if (l.account.startsWith("BANK:")) add("bankAccount", l.account.slice(5));
      });
      break;
    case "DAY_CLOSE":
      break;
  }
  return refs;
}

export type ScopeCheck =
  { ok: true } | { ok: false; code: "CROSS_GODOWN_REFERENCE" | "INVALID_REFERENCE"; ref: Ref };

/** Every reference must exist and belong to `voucher.godownId`. */
export function checkSameGodown(v: Voucher, lookup: GodownLookup): ScopeCheck {
  for (const ref of collectRefs(v)) {
    const g = lookup(ref);
    if (g === undefined) return { ok: false, code: "INVALID_REFERENCE", ref };
    if (g !== v.godownId) return { ok: false, code: "CROSS_GODOWN_REFERENCE", ref };
  }
  return { ok: true };
}

export function assertSameGodown(v: Voucher, lookup: GodownLookup): void {
  const r = checkSameGodown(v, lookup);
  if (!r.ok) throw new DomainError(r.code, `${r.ref.kind}:${r.ref.id}`);
}

/** Same-godown references made by master records (e.g. a vehicle's owner/driver party). */
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

/** `godownId` is immutable: an edit may never move a record to another godown. */
export function assertGodownUnchanged(
  before: { godownId: string },
  after: { godownId: string },
): void {
  if (before.godownId !== after.godownId) throw new DomainError("GODOWN_IMMUTABLE");
}

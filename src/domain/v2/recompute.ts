/**
 * Derived-field recomputation, verification (CALC_MISMATCH) and business rules for v2 documents.
 * Shared by the local write path and the server: the server never trusts client totals.
 */
import { DomainError, type DomainErrorCode } from "../errors";
import { amountForWeight } from "../money";
import { sumBig } from "../rounding";
import { FARMER_PAYMENT_CODE } from "./accounts";
import { assertPaymentDirection } from "./direction";
import { businessDate, type Doc, type WeightBlock } from "./schemas";
import { computeBill, recomputeWeight } from "./weightBlock";

/** Σ add − Σ deduct of v1 purchase charges (legacy data only). */
export function legacyChargesTotal(
  charges: ReadonlyArray<{ kind: "add" | "deduct"; amountPaise: string }> | undefined,
): bigint {
  return sumBig((charges ?? []).map((c) => (c.kind === "add" ? 1n : -1n) * BigInt(c.amountPaise)));
}

function weightOf(w: WeightBlock): WeightBlock {
  return recomputeWeight(w);
}

/** The document with every derived field recomputed from its inputs. */
export function recomputeDoc<D extends Doc>(d: D): D {
  const doc = d as Doc;
  switch (doc.type) {
    case "PURCHASE":
    case "SALE": {
      const weight = weightOf(doc.weight);
      const charges = doc.type === "PURCHASE" ? legacyChargesTotal(doc.legacyCharges) : 0n;
      const bill = computeBill(
        BigInt(weight.netG),
        BigInt(doc.ratePaisePerQtl),
        doc.roundToRupee,
        charges,
      );
      return {
        ...doc,
        weight,
        amountPaise: bill.amountPaise.toString(),
        roundOffPaise: bill.roundOffPaise.toString(),
        totalPaise: bill.totalPaise.toString(),
      } as D;
    }
    case "LOAD": {
      const weight = weightOf(doc.weight);
      const total = amountForWeight(BigInt(weight.netG), BigInt(doc.ratePaisePerQtl));
      return { ...doc, weight, totalPaise: total.toString() } as D;
    }
    case "MILL_DISPATCH": {
      const weight = weightOf(doc.weight);
      const total = amountForWeight(BigInt(weight.netG), BigInt(doc.ratePaisePerQtl));
      return { ...doc, weight, totalValuePaise: total.toString() } as D;
    }
    case "MILL_RETURN": {
      const weight = weightOf(doc.weight);
      const total =
        doc.ratePaisePerQtl !== undefined && doc.ratePaisePerQtl !== "0"
          ? amountForWeight(BigInt(weight.netG), BigInt(doc.ratePaisePerQtl)).toString()
          : doc.totalValuePaise;
      return {
        ...doc,
        weight,
        ...(total !== undefined ? { totalValuePaise: total } : {}),
        dedupeKey: returnDedupeKey(doc.dispatchId, doc.returnDate, doc.product, weight.netG),
      } as D;
    }
    case "CONVERSION": {
      const outputs = sumBig(doc.outputs.map((o) => BigInt(o.qtyG)));
      return { ...doc, lossG: (BigInt(doc.paddyConsumedG) - outputs).toString() } as D;
    }
    case "MILL_SETTLEMENT": {
      const s = settlementAmounts(doc);
      return {
        ...doc,
        billedPaise: s.billedPaise.toString(),
        finalValuePaise: s.finalValuePaise.toString(),
        adjustmentPaise: s.adjustmentPaise.toString(),
      } as D;
    }
    case "TRIP": {
      const total =
        doc.rateMode === "PER_QTL"
          ? amountForWeight(BigInt(doc.qtyG ?? "0"), BigInt(doc.ratePaise))
          : BigInt(doc.ratePaise);
      return { ...doc, totalIncomePaise: total.toString() } as D;
    }
    case "DAY_CLOSE": {
      const diff = BigInt(doc.actualClosingPaise) - BigInt(doc.expectedClosingPaise);
      return { ...doc, diffPaise: diff.toString() } as D;
    }
    default:
      return d;
  }
}

/**
 * Final-settlement money (v2.1 §12.8E). `billed` is what the dispatch charged for the paddy the
 * settlement closes (accepted + shortfall, at the dispatch rate); `final` is what the mill accepts
 * to pay for it. The difference adjusts the dispatch's receivable.
 */
export function settlementAmounts(s: {
  acceptedG: string;
  shortfallG: string;
  dispatchRatePaisePerQtl: string;
  finalRatePaisePerQtl: string;
  deductionPaise: string;
}): { billedPaise: bigint; finalValuePaise: bigint; adjustmentPaise: bigint } {
  const accepted = BigInt(s.acceptedG);
  const billed = amountForWeight(
    accepted + BigInt(s.shortfallG),
    BigInt(s.dispatchRatePaisePerQtl),
  );
  const finalValue =
    amountForWeight(accepted, BigInt(s.finalRatePaisePerQtl)) - BigInt(s.deductionPaise);
  return { billedPaise: billed, finalValuePaise: finalValue, adjustmentPaise: billed - finalValue };
}

/** Same dispatch + date + product + quantity identifies a possible duplicate return (§12.8C). */
export function returnDedupeKey(
  dispatchId: string,
  returnDate: string,
  product: string,
  netG: string,
): string {
  return `${dispatchId}|${returnDate}|${product}|${netG}`;
}

/** Paths whose stored value differs from the recomputed one (empty = consistent). */
export function verifyDoc(d: Doc): string[] {
  let r: Doc;
  try {
    r = recomputeDoc(d);
  } catch {
    return ["*"];
  }
  const out: string[] = [];
  const cmp = (path: string, a: unknown, b: unknown) => {
    if (a !== b) out.push(path);
  };
  const a = d as Record<string, unknown>;
  const b = r as Record<string, unknown>;
  for (const k of [
    "amountPaise",
    "roundOffPaise",
    "totalPaise",
    "totalValuePaise",
    "totalIncomePaise",
    "lossG",
    "diffPaise",
    "dedupeKey",
    "billedPaise",
    "finalValuePaise",
    "adjustmentPaise",
  ]) {
    if (k === "amountPaise" && d.type !== "PURCHASE" && d.type !== "SALE") continue;
    cmp(k, a[k], b[k]);
  }
  if ("weight" in d && "weight" in r) {
    cmp("weight.totalG", d.weight.totalG, r.weight.totalG);
    cmp("weight.netG", d.weight.netG, r.weight.netG);
  }
  return out;
}

/** Business rules that don't need other records. Throws DomainError with a code. */
export function validateDocRules(d: Doc, today: string): void {
  const fail = (code: DomainErrorCode, detail?: string): never => {
    throw new DomainError(code, detail);
  };
  if (businessDate(d) > today) fail("FUTURE_DATE");
  if (d.entryDate > today) fail("FUTURE_DATE", "entryDate");

  switch (d.type) {
    case "PAYMENT": {
      if (d.mode === "CASH" && d.bankAccountId) fail("VALIDATION_FAILED", "bankAccountId");
      if (d.mode !== "CASH" && !d.bankAccountId) fail("BANK_ACCOUNT_REQUIRED");
      // The direction comes from the source type, never from the screen (v2.1).
      assertPaymentDirection(d.source.type, d.direction);
      const onAccount =
        d.source.type === "PARTY_ADVANCE" ||
        d.source.type === "SECOND_PARTY" ||
        d.source.type === "MILL_REFUND";
      if (d.source.id === null && !onAccount) fail("SOURCE_MISMATCH");
      if (onAccount && !d.partyId) fail("PARTY_REQUIRED");
      break;
    }
    case "MILL_SETTLEMENT":
      if (BigInt(d.acceptedG) + BigInt(d.shortfallG) <= 0n) fail("VALIDATION_FAILED", "acceptedG");
      if (BigInt(d.finalValuePaise) < 0n) fail("VALIDATION_FAILED", "deductionPaise");
      if (BigInt(d.shortfallG) > 0n && !d.shortfallReason)
        fail("VALIDATION_FAILED", "shortfallReason");
      break;
    case "EXPENSE":
      if (d.categoryCode === FARMER_PAYMENT_CODE) fail("CATEGORY_IS_PAYMENT");
      break;
    case "PURCHASE":
      if (d.vehicleFare) {
        // The fare comes out of the farmer's money: never more than the purchase, never the
        // farmer himself, and not on an inter-Gola transfer (no farmer, no vehicle).
        if (d.interGola) fail("VALIDATION_FAILED", "vehicleFare");
        if (d.vehicleFare.ownerPartyId === d.partyId)
          fail("VALIDATION_FAILED", "vehicleFare.ownerPartyId");
        if (BigInt(d.vehicleFare.amountPaise) > BigInt(d.totalPaise))
          fail("FARE_EXCEEDS_PURCHASE", "vehicleFare.amountPaise");
      }
      break;
    case "SALE":
      if (d.source === "MILL" && !d.sourceMillId) fail("MILL_REQUIRED");
      if (d.product === "RICE" && d.source !== "WAREHOUSE") fail("VALIDATION_FAILED", "source");
      if (d.consignmentDispatchId && d.source !== "MILL") fail("VALIDATION_FAILED", "source");
      break;
    case "MILL_RETURN":
      if (d.product === "PADDY" && !d.varietyId) fail("VALIDATION_FAILED", "varietyId");
      if (d.product === "OTHER" && !d.otherProductName)
        fail("VALIDATION_FAILED", "otherProductName");
      break;
    case "CONVERSION":
      for (const o of d.outputs) {
        if (o.product === "OTHER" && !o.name) fail("VALIDATION_FAILED", "outputs.name");
      }
      break;
    case "STOCK_ADJUST":
      for (const l of d.lines) {
        if (l.location === "MILL" && !l.millPartyId) fail("MILL_REQUIRED");
        if (l.product === "OTHER" && !l.otherProductName)
          fail("VALIDATION_FAILED", "otherProductName");
      }
      break;
    case "CONTRA":
      if (
        (d.kind === "DEPOSIT" || d.kind === "WITHDRAW" || d.kind === "TRANSFER") &&
        !d.bankAccountId
      )
        fail("BANK_ACCOUNT_REQUIRED");
      if (d.kind === "TRANSFER" && (!d.toBankAccountId || d.toBankAccountId === d.bankAccountId))
        fail("VALIDATION_FAILED", "toBankAccountId");
      break;
    case "DAY_CLOSE":
      if (BigInt(d.diffPaise) !== 0n && !d.notes?.trim()) fail("NOTE_REQUIRED");
      break;
    case "TRIP":
      if (d.rateMode === "PER_QTL" && (d.qtyG === undefined || d.qtyG === "0"))
        fail("VALIDATION_FAILED", "qtyG");
      break;
    default:
      break;
  }
}

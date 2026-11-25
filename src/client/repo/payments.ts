/**
 * Bills and their payments (requirement_v2 §7.2) on top of `saveDocs`:
 *  - save a bill (purchase, sale, expense, dispatch, trip…) with its INITIAL payment in one op group;
 *  - add a payment to a bill; more than the due only with the owner's confirmation, then the extra
 *    becomes a PARTY_ADVANCE payment (two records, one groupId, never double-counted);
 *  - payments are edited / reversed like any document (audited, books recalculate).
 */
import { v7 as uuidv7 } from "uuid";
import { DomainError } from "@/domain/errors";
import { billState, billsOf, splitOverpayment } from "@/domain/v2/payments";
import type { Doc, Payment } from "@/domain/schemas";
import { db } from "../db/dexie";
import { todayIST } from "@/domain/dates";
import { RepoError } from "./context";
import { newId, saveDocs, type DocDraft, type DraftOf } from "./docs";

export type PaymentPart = Pick<
  DraftOf<"PAYMENT">,
  | "amountPaise"
  | "paymentDate"
  | "mode"
  | "bankAccountId"
  | "reference"
  | "personName"
  | "vehicleNumber"
  | "notes"
>;

/** Active payments of a source document (for due calculations). */
async function activePaymentsOf(sourceId: string): Promise<Payment[]> {
  const d = db();
  const rows = [
    ...(await d.vouchers.where("source.id").equals(sourceId).toArray()),
    ...(await d.vouchers.where("source.id").startsWith(`${sourceId}:`).toArray()),
  ];
  return rows.filter((p): p is Payment => p.type === "PAYMENT" && p.status === "active");
}

/** The remaining due of a document's main bill (bill total − active payments). */
export async function dueOf(doc: Doc): Promise<bigint> {
  const bill = billsOf(doc)[0];
  if (!bill) return 0n;
  return billState(bill, await activePaymentsOf(doc._id), todayIST()).duePaise;
}

/**
 * Save a bill (create or edit) and, on create, its initial payment (amount > 0) in ONE
 * transaction. The payment's direction and party come from the bill.
 */
export async function saveBillWithInitialPayment(
  godownId: string,
  bill: DocDraft,
  initial: PaymentPart | null,
  opts: { id?: string; reason?: string } = {},
): Promise<{ bill: Doc; payment?: Doc }> {
  if (opts.id) {
    const [saved] = await saveDocs(
      godownId,
      [{ draft: bill, id: opts.id }],
      opts.reason ? { reason: opts.reason } : {},
    );
    return { bill: saved! };
  }
  const id = bill._id ?? newId();
  const items = [{ draft: { ...bill, _id: id } as DocDraft }];
  if (initial && BigInt(initial.amountPaise || "0") > 0n) {
    const probe = billsOf({ ...(bill as object), _id: id, status: "active" } as unknown as Doc)[0];
    if (!probe) throw new RepoError("SOURCE_MISMATCH");
    items.push({
      draft: {
        ...initial,
        type: "PAYMENT",
        direction: probe.direction,
        ...(probe.partyId ? { partyId: probe.partyId } : {}),
        source: { type: probe.sourceType, id: probe.sourceId },
        isInitial: true,
      } as DocDraft,
    });
  }
  const saved = await saveDocs(godownId, items);
  return { bill: saved[0]!, ...(saved[1] ? { payment: saved[1] } : {}) };
}

/**
 * Pay (or collect) against a bill. If the amount is more than the due, `extraAsAdvance` must be
 * true (the owner confirmed) and the extra is saved as a PARTY_ADVANCE payment with the same
 * groupId; otherwise OVERPAYMENT.
 */
export async function payBill(
  godownId: string,
  source: Doc,
  part: PaymentPart,
  opts: { sourceId?: string; extraAsAdvance?: boolean } = {},
): Promise<Doc[]> {
  const bills = billsOf(source);
  const bill = opts.sourceId ? bills.find((b) => b.sourceId === opts.sourceId) : bills[0];
  if (!bill) throw new RepoError("SOURCE_MISMATCH");
  const due = billState(bill, await activePaymentsOf(source._id), todayIST()).duePaise;
  const amount = BigInt(part.amountPaise);
  const { billPaise, advancePaise } = splitOverpayment(amount, due);
  if (advancePaise > 0n && !opts.extraAsAdvance) {
    throw new RepoError("OVERPAYMENT", advancePaise.toString());
  }
  if (advancePaise > 0n && !bill.partyId) throw new RepoError("PARTY_REQUIRED");
  const base = {
    ...part,
    type: "PAYMENT" as const,
    direction: bill.direction,
    ...(bill.partyId ? { partyId: bill.partyId } : {}),
    isInitial: false,
  };
  const items: Array<{ draft: DocDraft }> = [];
  if (billPaise > 0n) {
    items.push({
      draft: {
        ...base,
        amountPaise: billPaise.toString(),
        source: { type: bill.sourceType, id: bill.sourceId },
      } as DocDraft,
    });
  }
  if (advancePaise > 0n) {
    items.push({
      draft: {
        ...base,
        amountPaise: advancePaise.toString(),
        source: { type: "PARTY_ADVANCE", id: null },
      } as DocDraft,
    });
  }
  if (items.length === 0) throw new DomainError("VALIDATION_FAILED", "amount");
  return saveDocs(godownId, items, items.length > 1 ? { groupId: uuidv7() } : {});
}

/**
 * Party-level money with no bill: an advance given (OUT) or received (IN), or second-party money
 * given / received on account (§12.8A, `sourceType` SECOND_PARTY).
 */
export async function payAdvance(
  godownId: string,
  partyId: string,
  direction: "IN" | "OUT",
  part: PaymentPart,
  sourceType: "PARTY_ADVANCE" | "SECOND_PARTY" = "PARTY_ADVANCE",
): Promise<Doc> {
  const [p] = await saveDocs(godownId, [
    {
      draft: {
        ...part,
        type: "PAYMENT",
        direction,
        partyId,
        source: { type: sourceType, id: null },
        isInitial: false,
      } as DocDraft,
    },
  ]);
  return p!;
}

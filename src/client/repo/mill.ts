/**
 * Mill writes beyond a plain bill (requirement_v2 §12.8):
 *  - a mill return, with the money received from the mill at that time as an IN payment linked to
 *    the return (one op group; DECISIONS D10), and the possible-duplicate check;
 *  - the consignment settlement: a CONFIRMED sale to the mill (source MILL, linked to the dispatch,
 *    DECISIONS D5) and the advances already received against the dispatch moved onto that sale
 *    (same money, same date and party: the books don't change, the sale shows them as received).
 * Dispatches use `saveBillWithInitialPayment`; conversions use `saveDoc`.
 */
import { returnDedupeKey } from "@/domain/v2/recompute";
import { computeBill } from "@/domain/v2/weightBlock";
import type { Doc, DocOf, Payment, WeightBlock } from "@/domain/schemas";
import { db, writeTables } from "../db/dexie";
import { RepoError, writeContext } from "./context";
import {
  editInTx,
  loadForChange,
  newId,
  paymentsOfSource,
  saveDocs,
  voidWithDependentsInTx,
  type DocDraft,
  type DraftOf,
  type SaveItem,
} from "./docs";
import { emitLocalWrite } from "./notify";
import type { PaymentPart } from "./payments";

/** "Same dispatch + date + product + quantity within 10 minutes" (§12.8C). */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export async function findDuplicateReturn(
  godownId: string,
  r: { dispatchId: string; returnDate: string; product: string; netG: string },
  excludeId?: string,
  now = Date.now(),
): Promise<DocOf<"MILL_RETURN"> | undefined> {
  const key = returnDedupeKey(r.dispatchId, r.returnDate, r.product, r.netG);
  const rows = await db().vouchers.where("dispatchId").equals(r.dispatchId).toArray();
  return rows.find(
    (x): x is DocOf<"MILL_RETURN"> =>
      x.type === "MILL_RETURN" &&
      x.godownId === godownId &&
      x.status === "active" &&
      x._id !== excludeId &&
      x.dedupeKey === key &&
      now - Date.parse(x.createdAt) <= DUPLICATE_WINDOW_MS,
  );
}

/**
 * Save a mill return (create or edit). On create, `received` (amount > 0) is saved with it as an
 * IN payment from the mill, linked to the return.
 */
export async function saveMillReturn(
  godownId: string,
  draft: DraftOf<"MILL_RETURN">,
  received: PaymentPart | null,
  opts: { id?: string; reason?: string } = {},
): Promise<Doc[]> {
  if (opts.id) {
    return saveDocs(godownId, [{ draft, id: opts.id }], opts.reason ? { reason: opts.reason } : {});
  }
  const id = draft._id ?? newId();
  const items: SaveItem[] = [{ draft: { ...draft, _id: id } }];
  if (received && BigInt(received.amountPaise || "0") > 0n) {
    items.push({
      draft: {
        ...received,
        type: "PAYMENT",
        direction: "IN",
        partyId: draft.millPartyId,
        source: { type: "MILL_RETURN", id },
        isInitial: true,
      } as DocDraft,
    });
  }
  return saveDocs(godownId, items);
}

export interface SettleInput {
  dispatchId: string;
  date: string;
  /** Quantity the mill accepted (the sale's weight). */
  weight: WeightBlock;
  /** Final price per quintal. */
  ratePaisePerQtl: string;
  roundToRupee?: boolean;
  dueDate?: string;
  notes?: string;
}

/**
 * Settle (part of) a CONSIGNMENT dispatch: one CONFIRMED sale to the mill from the mill's stock,
 * linked to the dispatch. Active advances received against the dispatch move onto the sale, oldest
 * first, as long as they fit in the sale total (the rest stays as an advance on the dispatch).
 */
export async function settleConsignment(
  godownId: string,
  input: SettleInput,
): Promise<{ sale: DocOf<"SALE">; moved: number }> {
  const d = db();
  const dispatch = await d.vouchers.get(input.dispatchId);
  if (!dispatch || dispatch.type !== "MILL_DISPATCH" || dispatch.godownId !== godownId) {
    throw new RepoError("INVALID_REFERENCE", input.dispatchId);
  }
  if (dispatch.status !== "active") throw new RepoError("VOUCHER_VOID");
  if (dispatch.dispatchType !== "CONSIGNMENT") throw new RepoError("DISPATCH_TYPE_MISMATCH");
  const saleId = newId();
  const bill = computeBill(
    BigInt(input.weight.netG),
    BigInt(input.ratePaisePerQtl),
    input.roundToRupee ?? false,
  );
  const sale: DraftOf<"SALE"> = {
    type: "SALE",
    _id: saleId,
    transactionDate: input.date,
    partyId: dispatch.millPartyId,
    product: "PADDY",
    varietyId: dispatch.varietyId,
    source: "MILL",
    sourceMillId: dispatch.millPartyId,
    weight: input.weight,
    ratePaisePerQtl: input.ratePaisePerQtl,
    amountPaise: "0",
    ...(input.roundToRupee ? { roundToRupee: true } : {}),
    roundOffPaise: "0",
    totalPaise: "0",
    saleStatus: "CONFIRMED",
    deliveryStatus: "DELIVERED",
    deliveryLog: [{ status: "DELIVERED", at: new Date().toISOString() }],
    consignmentDispatchId: dispatch._id,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
  };
  const advances = ((await d.vouchers.where("source.id").equals(dispatch._id).toArray()) as Doc[])
    .filter(
      (p): p is Payment => p.type === "PAYMENT" && p.status === "active" && p.direction === "IN",
    )
    .sort((a, b) =>
      a.paymentDate === b.paymentDate
        ? a.createdAt < b.createdAt
          ? -1
          : 1
        : a.paymentDate < b.paymentDate
          ? -1
          : 1,
    );
  const items: SaveItem[] = [{ draft: sale }];
  let room = bill.totalPaise;
  for (const p of advances) {
    const amt = BigInt(p.amountPaise);
    if (amt > room) break;
    room -= amt;
    const { _id: _drop, ...rest } = p;
    items.push({
      id: p._id,
      draft: { ...rest, source: { type: "SALE", id: saleId }, isInitial: false } as DocDraft,
    });
  }
  const saved = await saveDocs(godownId, items);
  return { sale: saved[0] as DocOf<"SALE">, moved: items.length - 1 };
}

/**
 * Reverse a settlement sale: the money received from the mill goes back to the dispatch as an
 * advance (never voided: it was really received), then the sale is voided. One op group.
 */
export async function voidSettlement(
  godownId: string,
  saleId: string,
  reason: string,
): Promise<Doc[]> {
  if (!reason.trim()) throw new RepoError("NOTE_REQUIRED");
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const sale = await loadForChange(ctx, saleId, "voucher.void");
    if (sale.type !== "SALE" || !sale.consignmentDispatchId) throw new RepoError("TYPE_IMMUTABLE");
    const dispatch = await d.vouchers.get(sale.consignmentDispatchId);
    if (!dispatch || dispatch.status !== "active") throw new RepoError("VOUCHER_VOID");
    const done: Doc[] = [];
    for (const p of await paymentsOfSource(sale._id)) {
      if (p.type !== "PAYMENT" || p.direction !== "IN") {
        throw new RepoError("LINKED_PAYMENTS", "1");
      }
      const { _id: _drop, ...rest } = p;
      done.push(
        await editInTx(ctx, p, {
          ...rest,
          source: { type: "MILL_DISPATCH", id: dispatch._id },
        } as DocDraft),
      );
    }
    done.push(...(await voidWithDependentsInTx(ctx, sale, reason.trim(), false)));
    return done;
  });
  emitLocalWrite();
  return out;
}

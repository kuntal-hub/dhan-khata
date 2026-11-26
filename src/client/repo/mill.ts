/**
 * Mill writes beyond a plain bill (requirement_v2.1 §12.8). The mill PAYS us for the paddy:
 *  - a mill return is a CREDIT to the mill (its receivable goes down); it never carries money;
 *  - the final settlement (accepted weight, final rate, cut) adjusts the dispatch's receivable
 *    through one MILL_SETTLEMENT record (never a sale);
 *  - a refund to a mill that paid too much is an explicit OUT payment (source MILL_REFUND).
 * Dispatches use `saveBillWithInitialPayment` (collection = IN); conversions use `saveDoc`.
 */
import { directionFor } from "@/domain/v2/direction";
import { returnDedupeKey, settlementAmounts } from "@/domain/v2/recompute";
import type { Doc, DocOf } from "@/domain/schemas";
import { db } from "../db/dexie";
import { RepoError } from "./context";
import { saveDocs, type DocDraft, type DraftOf } from "./docs";
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

/** Save a mill return (create or edit). A return is a credit, never cash (v2.1). */
export async function saveMillReturn(
  godownId: string,
  draft: DraftOf<"MILL_RETURN">,
  opts: { id?: string; reason?: string } = {},
): Promise<Doc> {
  const [saved] = await saveDocs(
    godownId,
    [{ draft, ...(opts.id ? { id: opts.id } : {}) }],
    opts.reason ? { reason: opts.reason } : {},
  );
  return saved!;
}

export interface SettlementInput {
  dispatchId: string;
  date: string;
  acceptedG: string;
  finalRatePaisePerQtl: string;
  deductionPaise: string;
  shortfallG: string;
  shortfallReason?: DocOf<"MILL_SETTLEMENT">["shortfallReason"];
  notes?: string;
}

/** The settlement draft for a dispatch (amounts filled in; the save recomputes and verifies). */
export function settlementDraft(
  dispatch: DocOf<"MILL_DISPATCH">,
  input: SettlementInput,
): DraftOf<"MILL_SETTLEMENT"> {
  const base = {
    acceptedG: input.acceptedG,
    shortfallG: input.shortfallG,
    dispatchRatePaisePerQtl: dispatch.ratePaisePerQtl,
    finalRatePaisePerQtl: input.finalRatePaisePerQtl,
    deductionPaise: input.deductionPaise,
  };
  const a = settlementAmounts(base);
  return {
    type: "MILL_SETTLEMENT",
    dispatchId: dispatch._id,
    millPartyId: dispatch.millPartyId,
    varietyId: dispatch.varietyId,
    transactionDate: input.date,
    ...base,
    ...(BigInt(input.shortfallG) > 0n && input.shortfallReason
      ? { shortfallReason: input.shortfallReason }
      : {}),
    billedPaise: a.billedPaise.toString(),
    finalValuePaise: a.finalValuePaise.toString(),
    adjustmentPaise: a.adjustmentPaise.toString(),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
  };
}

/**
 * Save the final settlement of a dispatch (create, or edit with `id`). One active settlement per
 * dispatch (ALREADY_LINKED otherwise; enforced again by the write path and the server).
 */
export async function saveMillSettlement(
  godownId: string,
  input: SettlementInput,
  opts: { id?: string; reason?: string } = {},
): Promise<DocOf<"MILL_SETTLEMENT">> {
  const dispatch = await db().vouchers.get(input.dispatchId);
  if (!dispatch || dispatch.type !== "MILL_DISPATCH" || dispatch.godownId !== godownId) {
    throw new RepoError("INVALID_REFERENCE", input.dispatchId);
  }
  if (dispatch.status !== "active") throw new RepoError("VOUCHER_VOID");
  const [saved] = await saveDocs(
    godownId,
    [{ draft: settlementDraft(dispatch, input), ...(opts.id ? { id: opts.id } : {}) }],
    opts.reason ? { reason: opts.reason } : {},
  );
  return saved as DocOf<"MILL_SETTLEMENT">;
}

/**
 * "টাকা ফেরত দিলাম / Refund to mill": money we give back to a mill that paid more than it owed.
 * An OUT payment (source MILL_REFUND), optionally naming the dispatch it was overpaid on.
 */
export async function saveMillRefund(
  godownId: string,
  millPartyId: string,
  part: PaymentPart,
  dispatchId: string | null = null,
): Promise<Doc> {
  const [p] = await saveDocs(godownId, [
    {
      draft: {
        ...part,
        type: "PAYMENT",
        direction: directionFor("MILL_REFUND"),
        partyId: millPartyId,
        source: { type: "MILL_REFUND", id: dispatchId },
        isInitial: false,
      } as DocDraft,
    },
  ]);
  return p!;
}

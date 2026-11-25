/**
 * Sales writes beyond the plain bill + collections (requirement_v2 §12.3):
 *  - delivery tracking (PENDING → LOADED → IN_TRANSIT → DELIVERED, each step time-stamped);
 *  - confirming an ORDER (stock leaves only then, exactly once);
 *  - inter-Gola transfer (owner): a SALE in the sending Gola and a PURCHASE in the receiving Gola,
 *    written in ONE Dexie transaction and ONE op group (the server applies both or neither).
 *    Each side stays in its own books; the other Gola appears as a party with role GOLA.
 */
import { v7 as uuidv7 } from "uuid";
import { normalizedVarietyKey } from "@/domain/legacy/migrateV1";
import type { Doc, DocOf, Party, Variety, WeightBlock } from "@/domain/schemas";
import { db, writeTables } from "../db/dexie";
import { RepoError, writeContext, type WriteCtx } from "./context";
import { createInTx, editInTx, loadForChange, voidWithDependentsInTx, type DraftOf } from "./docs";
import { upsertMasterInTx } from "./masters";
import { emitLocalWrite } from "./notify";

type Sale = DocOf<"SALE">;
export type DeliveryStatus = Sale["deliveryStatus"];

async function editSale(
  godownId: string,
  saleId: string,
  change: (s: Sale, ctx: WriteCtx) => Partial<Sale>,
): Promise<Sale> {
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const existing = await loadForChange(ctx, saleId, "voucher.edit");
    if (existing.type !== "SALE") throw new RepoError("TYPE_IMMUTABLE");
    const next = { ...existing, ...change(existing, ctx) };
    return editInTx(ctx, existing, next as unknown as DraftOf<"SALE">);
  });
  emitLocalWrite();
  return out as Sale;
}

/** Move a sale to a delivery status; every step is kept with its time (timeline). */
export function setDeliveryStatus(
  godownId: string,
  saleId: string,
  status: DeliveryStatus,
  note?: string,
): Promise<Sale> {
  return editSale(godownId, saleId, (s, ctx) => ({
    deliveryStatus: status,
    deliveryLog: [
      ...s.deliveryLog,
      { status, at: ctx.nowIso, ...(note?.trim() ? { note: note.trim().slice(0, 200) } : {}) },
    ],
  }));
}

/** Confirm an ORDER: from now on the sale moves stock and is owed by the buyer. */
export function confirmSaleOrder(godownId: string, saleId: string): Promise<Sale> {
  return editSale(godownId, saleId, (s) => {
    if (s.saleStatus === "CONFIRMED") throw new RepoError("VALIDATION_FAILED", "saleStatus");
    return { saleStatus: "CONFIRMED" };
  });
}

// ── Inter-Gola transfer ──────────────────────────────────────────────────────────────────────

export interface TransferInput {
  fromGodownId: string;
  toGodownId: string;
  date: string;
  /** Variety in the sending Gola; matched (or created) in the receiving Gola. */
  varietyId: string;
  weight: WeightBlock;
  ratePaisePerQtl: string;
  vehicleNumber?: string;
  notes?: string;
}

/** The party that stands for Gola `other` in Gola `ctx` (created on first use). */
async function golaParty(ctx: WriteCtx, otherGodownId: string): Promise<Party> {
  const d = db();
  const found = await d.parties
    .where("godownId")
    .equals(ctx.godown._id)
    .filter((p) => p.status === "active" && p.linkedGodownId === otherGodownId)
    .first();
  if (found) return found;
  const other = await d.godowns.get(otherGodownId);
  if (!other) throw new RepoError("GODOWN_NOT_FOUND");
  return upsertMasterInTx(ctx, "party", {
    name: other.name,
    roles: ["GOLA"],
    linkedGodownId: otherGodownId,
  });
}

/** The same variety in the receiving Gola (seed key or normalized name + company), else a copy. */
async function matchingVariety(ctx: WriteCtx, source: Variety): Promise<Variety> {
  const d = db();
  const list = await d.varieties.where("godownId").equals(ctx.godown._id).toArray();
  const active = list.filter((v) => v.status === "active" && v.product === source.product);
  const bySeed = source.systemKey
    ? active.find((v) => v.systemKey === source.systemKey && !v.renamed)
    : undefined;
  const key = normalizedVarietyKey(source.name || source.systemKey || "", source.company);
  const found = bySeed ?? active.find((v) => v.normalizedKey === key);
  if (found) return found;
  return upsertMasterInTx(ctx, "variety", {
    name: source.name,
    ...(source.nameAlt ? { nameAlt: source.nameAlt } : {}),
    ...(source.systemKey ? { systemKey: source.systemKey } : {}),
    ...(source.renamed ? { renamed: true } : {}),
    ...(source.company ? { company: source.company } : {}),
    ...(source.companyOther ? { companyOther: source.companyOther } : {}),
    product: source.product,
    normalizedKey: key,
    verified: source.verified,
  });
}

/**
 * Owner only: send paddy from one Gola to another at a stated rate. Returns [sale, purchase].
 * Both carry the same groupId and `interGola` (counter Gola, side, paired).
 */
export async function saveInterGolaTransfer(input: TransferInput): Promise<[Sale, Doc]> {
  if (input.fromGodownId === input.toGodownId) throw new RepoError("TRANSFER_SAME_GODOWN");
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const from = await writeContext(input.fromGodownId);
    if (from.role !== "owner") throw new RepoError("FORBIDDEN");
    // One op group across both Golas: the server applies the pair in one transaction.
    const to: WriteCtx = { ...(await writeContext(input.toGodownId)), opGroup: from.opGroup };
    if (to.role !== "owner") throw new RepoError("FORBIDDEN");
    const variety = await d.varieties.get(input.varietyId);
    if (!variety || variety.godownId !== input.fromGodownId) {
      throw new RepoError("CROSS_GODOWN_REFERENCE", input.varietyId);
    }
    const buyerInFrom = await golaParty(from, input.toGodownId);
    const sellerInTo = await golaParty(to, input.fromGodownId);
    const toVariety = await matchingVariety(to, variety);
    const groupId = uuidv7();
    const common = {
      transactionDate: input.date,
      weight: input.weight,
      ratePaisePerQtl: input.ratePaisePerQtl,
      amountPaise: "0",
      roundOffPaise: "0",
      totalPaise: "0",
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    };
    const sale = await createInTx(
      from,
      {
        type: "SALE",
        ...common,
        partyId: buyerInFrom._id,
        product: "PADDY",
        varietyId: variety._id,
        source: "WAREHOUSE",
        saleStatus: "CONFIRMED",
        deliveryStatus: "DELIVERED",
        deliveryLog: [{ status: "DELIVERED", at: from.nowIso }],
        ...(input.vehicleNumber?.trim() ? { vehicleNumber: input.vehicleNumber.trim() } : {}),
        interGola: { counterGodownId: input.toGodownId, side: "SEND", paired: true },
      } as DraftOf<"SALE">,
      { groupId },
    );
    const purchase = await createInTx(
      to,
      {
        type: "PURCHASE",
        ...common,
        partyId: sellerInTo._id,
        varietyId: toVariety._id,
        storeAt: "WAREHOUSE",
        interGola: { counterGodownId: input.fromGodownId, side: "RECEIVE", paired: true },
      } as DraftOf<"PURCHASE">,
      { groupId },
    );
    return [sale as Sale, purchase] as [Sale, Doc];
  });
  emitLocalWrite();
  return out;
}

/** The other half of an inter-Gola pair (same groupId, counter Gola). */
export async function pairedTransferDoc(doc: Doc): Promise<Doc | undefined> {
  const ig = (doc as { interGola?: { counterGodownId: string } }).interGola;
  if (!ig || !doc.groupId) return undefined;
  return db()
    .vouchers.where("[godownId+groupId]")
    .equals([ig.counterGodownId, doc.groupId])
    .filter((x) => x.type === "SALE" || x.type === "PURCHASE")
    .first();
}

/**
 * Reverse an inter-Gola transfer: both halves are voided together (one op group). Blocked while
 * either side has active payments (settle or reverse them first).
 */
export async function voidInterGolaTransfer(
  godownId: string,
  docId: string,
  reason: string,
): Promise<Doc[]> {
  if (!reason.trim()) throw new RepoError("NOTE_REQUIRED");
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const a = await writeContext(godownId);
    const first = await loadForChange(a, docId, "voucher.void");
    const other = await pairedTransferDoc(first);
    const done = await voidWithDependentsInTx(a, first, reason.trim(), false);
    if (other && other.status === "active") {
      const b: WriteCtx = { ...(await writeContext(other.godownId)), opGroup: a.opGroup };
      const second = await loadForChange(b, other._id, "voucher.void");
      done.push(...(await voidWithDependentsInTx(b, second, reason.trim(), false)));
    }
    return done;
  });
  emitLocalWrite();
  return out;
}

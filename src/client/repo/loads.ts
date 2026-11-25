/**
 * Daily Load Khata writes (requirement_v2 §12.5). A load is a REGISTER entry: no money or stock by
 * itself. It links 1:1 to the sale or mill dispatch that moves the stock and money:
 *  - link an existing record, or create the sale / dispatch from the load (prefilled; the link is
 *    written in the same op group as the new record);
 *  - one load ↔ at most one record and vice versa (checked here and by the server);
 *  - editing a linked load's quantity can update the linked record too (never a second deduction).
 * Both sides carry the link (`load.link`, `record.linkedLoadId`) and always change together.
 */
import type { Doc, DocOf } from "@/domain/schemas";
import { db } from "../db/dexie";
import { RepoError } from "./context";
import { saveDocs, type DocDraft, type DraftOf, type SaveItem } from "./docs";

type Load = DocOf<"LOAD">;
export type LoadLinkType = "SALE" | "MILL_DISPATCH";
export interface LoadLink {
  type: LoadLinkType;
  id: string;
}

function editDraft<D extends Doc>(doc: D, patch: Record<string, unknown>, drop: string[] = []) {
  const { _id: _ignored, ...rest } = doc as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest, ...patch };
  for (const k of drop) delete out[k];
  return out as unknown as DocDraft;
}

/** The record a load is linked to, when that record is still active. */
export async function activeLinkOf(load: Load): Promise<Doc | undefined> {
  if (!load.link) return undefined;
  const t = await db().vouchers.get(load.link.id);
  return t && t.status === "active" ? t : undefined;
}

/** Throws ALREADY_LINKED unless `load` and the target may be linked to each other. */
async function assertFree(load: Load, target: Doc | undefined, targetId: string): Promise<void> {
  if (load.status !== "active") throw new RepoError("VOUCHER_VOID");
  const current = await activeLinkOf(load);
  if (current && current._id !== targetId) throw new RepoError("ALREADY_LINKED", load._id);
  // Another active load already points at this record?
  const others = await db()
    .vouchers.where("[godownId+type]")
    .equals([load.godownId, "LOAD"])
    .filter(
      (x) =>
        x.type === "LOAD" && x.status === "active" && x._id !== load._id && x.link?.id === targetId,
    )
    .count();
  if (others > 0) throw new RepoError("ALREADY_LINKED", targetId);
  if (target) {
    if (target.status !== "active") throw new RepoError("VOUCHER_VOID");
    const linked = (target as { linkedLoadId?: string }).linkedLoadId;
    if (linked && linked !== load._id) {
      const other = await db().vouchers.get(linked);
      if (other && other.status === "active") throw new RepoError("ALREADY_LINKED", targetId);
    }
  }
}

/**
 * The extra save item that links `load` to a record being CREATED in the same transaction
 * (pass it to `saveBillWithInitialPayment(..., { extra })` with `linkedLoadId` on the record).
 */
export async function linkFromLoadItem(
  godownId: string,
  loadId: string,
  link: LoadLink,
): Promise<SaveItem> {
  const load = await db().vouchers.get(loadId);
  if (!load || load.type !== "LOAD" || load.godownId !== godownId) {
    throw new RepoError("INVALID_REFERENCE", loadId);
  }
  await assertFree(load, undefined, link.id);
  return { id: load._id, draft: editDraft(load, { link }) };
}

/** Link an existing load to an existing sale / dispatch (both edited, one op group). */
export async function linkLoad(godownId: string, loadId: string, link: LoadLink): Promise<Doc[]> {
  const d = db();
  const [load, target] = await Promise.all([d.vouchers.get(loadId), d.vouchers.get(link.id)]);
  if (!load || load.type !== "LOAD" || load.godownId !== godownId) {
    throw new RepoError("INVALID_REFERENCE", loadId);
  }
  if (!target || target.type !== link.type || target.godownId !== godownId) {
    throw new RepoError("INVALID_REFERENCE", link.id);
  }
  await assertFree(load, target, link.id);
  return saveDocs(godownId, [
    { id: target._id, draft: editDraft(target, { linkedLoadId: load._id }) },
    { id: load._id, draft: editDraft(load, { link }) },
  ]);
}

/** Remove the link on both sides. */
export async function unlinkLoad(godownId: string, loadId: string): Promise<Doc[]> {
  const d = db();
  const load = await d.vouchers.get(loadId);
  if (!load || load.type !== "LOAD" || load.godownId !== godownId || !load.link) {
    throw new RepoError("INVALID_REFERENCE", loadId);
  }
  const target = await activeLinkOf(load);
  const items: SaveItem[] = [];
  if (target && (target as { linkedLoadId?: string }).linkedLoadId === load._id) {
    items.push({ id: target._id, draft: editDraft(target, {}, ["linkedLoadId"]) });
  }
  items.push({ id: load._id, draft: editDraft(load, {}, ["link"]) });
  return saveDocs(godownId, items);
}

/**
 * Save a load (create or edit). When editing a linked load with `updateLinked`, the linked record
 * gets the same weight (and, for a sale, the same rate) in the same op group: the stock still
 * moves only once, through that record.
 */
export async function saveLoad(
  godownId: string,
  draft: DraftOf<"LOAD">,
  opts: { id?: string; reason?: string; updateLinked?: boolean } = {},
): Promise<Doc[]> {
  if (!opts.id) {
    const { link: _never, ...rest } = draft;
    return saveDocs(godownId, [{ draft: rest as DocDraft }]);
  }
  const existing = await db().vouchers.get(opts.id);
  if (!existing || existing.type !== "LOAD") throw new RepoError("NOT_FOUND", opts.id);
  // The link only changes through link / unlink.
  const next = { ...draft, ...(existing.link ? { link: existing.link } : {}) } as DocDraft;
  if (!existing.link) delete (next as { link?: unknown }).link;
  const items: SaveItem[] = [{ id: existing._id, draft: next }];
  if (opts.updateLinked) {
    const target = await activeLinkOf(existing);
    if (target?.type === "SALE") {
      items.unshift({
        id: target._id,
        draft: editDraft(target, { weight: draft.weight, ratePaisePerQtl: draft.ratePaisePerQtl }),
      });
    } else if (target?.type === "MILL_DISPATCH") {
      items.unshift({ id: target._id, draft: editDraft(target, { weight: draft.weight }) });
    }
  }
  return saveDocs(godownId, items, opts.reason ? { reason: opts.reason } : {});
}

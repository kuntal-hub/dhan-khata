/**
 * Merge duplicate varieties (requirement_v2 §12.2): every active document of the Gola that uses
 * the dropped variety is re-pointed to the kept one (new revisions, books re-derived), and the
 * dropped variety is voided — all in ONE transaction (one op group).
 */
import type { Doc, Variety } from "@/domain/schemas";
import { db, writeTables } from "../db/dexie";
import { RepoError, writeContext } from "./context";
import { editInTx, type DocDraft } from "./docs";
import { upsertMasterInTx, type MasterInput } from "./masters";
import { emitLocalWrite } from "./notify";

/** The document with every `varietyId` equal to `from` replaced by `to` (null if none). */
function repoint(d: Doc, from: string, to: string): Doc | null {
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === "varietyId" && x === from) {
          out[k] = to;
          changed = true;
        } else out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  const next = walk(d) as Doc;
  return changed ? next : null;
}
export async function mergeVarieties(
  godownId: string,
  keepId: string,
  dropId: string,
): Promise<number> {
  if (keepId === dropId) throw new RepoError("VALIDATION_FAILED", "same");
  const d = db();
  const n = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const keep = await d.varieties.get(keepId);
    const drop = await d.varieties.get(dropId);
    if (!keep || !drop || keep.godownId !== godownId || drop.godownId !== godownId) {
      throw new RepoError("NOT_FOUND");
    }
    const docs = await d.vouchers
      .where("godownId")
      .equals(godownId)
      .filter((x) => x.status === "active")
      .toArray();
    let count = 0;
    for (const doc of docs) {
      const next = repoint(doc, dropId, keepId);
      if (!next) continue;
      await editInTx(ctx, doc, next as unknown as DocDraft, "merge");
      count++;
    }
    const { serverSeq: _s, ...rest } = drop as Variety & { serverSeq?: number };
    await upsertMasterInTx(ctx, "variety", { ...(rest as MasterInput<"variety">), status: "void" });
    return count;
  });
  emitLocalWrite();
  return n;
}

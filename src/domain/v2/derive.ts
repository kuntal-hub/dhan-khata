/**
 * Storage-agnostic derivation of a document's ledger lines and stock moves, shared by the local
 * write path (Dexie) and the server (Mongo). Each side implements `DerivedStore` for its database.
 *
 * Cost of goods depends on the stock position BEFORE a document in canonical order (`ordOfDoc` =
 * business date | createdAt | _id, the same order as `replayDocs`). When a document is written,
 * edited or voided, every later document that moves the same stock position is re-posted, so the
 * stored rows always equal a full replay.
 */
import {
  normalizeKey,
  postDoc,
  stockKeyId,
  type PostingContextV2,
  type PostingResultV2,
  type StockKeyV2,
  type StockPosition,
} from "./post";
import { ordOfDoc, toLedgerDocsV2, toMoveDocsV2 } from "./replay";
import type { Doc, LedgerLineV2, StockMoveV2 } from "./schemas";

export interface Derived {
  lines: LedgerLineV2[];
  moves: StockMoveV2[];
}

export const EMPTY_DERIVED: Derived = { lines: [], moves: [] };

export interface DerivedStore {
  /** Σ of stored moves for `key` in the Gola with `ord` < the given ord (excluding one document). */
  positionBefore(
    godownId: string,
    ord: string,
    key: StockKeyV2,
    excludeDocId: string,
  ): Promise<StockPosition>;
  /** Documents that have stored moves on any of `keys` with `ord` > the given ord. */
  docsAfter(
    godownId: string,
    ord: string,
    keys: readonly StockKeyV2[],
  ): Promise<Array<{ docId: string; ord: string }>>;
  getDoc(id: string): Promise<Doc | undefined>;
  readDerived(docId: string): Promise<Derived>;
  /** Replace a document's stored derived rows: delete `before`, insert `after`. */
  writeDerived(d: Doc, before: Derived, after: Derived): Promise<void>;
}

/** The position key of a stored move. */
export function moveKey(m: StockMoveV2): StockKeyV2 {
  return normalizeKey({
    product: m.product,
    location: m.location,
    ...(m.varietyId ? { varietyId: m.varietyId } : {}),
    ...(m.otherProductName ? { otherProductName: m.otherProductName } : {}),
    ...(m.millPartyId ? { millPartyId: m.millPartyId } : {}),
    ...(m.groupId ? { groupId: m.groupId } : {}),
  });
}

/** Does a stored move belong to position `k`? */
export function moveMatchesKey(m: StockMoveV2, k: StockKeyV2): boolean {
  return stockKeyId(moveKey(m)) === stockKeyId(k);
}

export function stockKeysOf(moves: readonly StockMoveV2[]): Map<string, StockKeyV2> {
  const out = new Map<string, StockKeyV2>();
  for (const m of moves) {
    const k = moveKey(m);
    out.set(stockKeyId(k), k);
  }
  return out;
}

/** Post `d` using stock positions read from the store (keys discovered by a dry run). */
export async function postWithStore(d: Doc, store: DerivedStore): Promise<PostingResultV2> {
  const ord = ordOfDoc(d);
  const positions = new Map<string, StockPosition>();
  for (let attempt = 0; attempt < 6; attempt++) {
    const missing = new Map<string, StockKeyV2>();
    const ctx: PostingContextV2 = {
      position: (k) => {
        const id = stockKeyId(k);
        const p = positions.get(id);
        if (p) return p;
        missing.set(id, k);
        return { qtyG: 0n, valuePaise: 0n };
      },
    };
    const result = postDoc(d, ctx);
    if (missing.size === 0) return result;
    for (const [id, k] of missing) {
      positions.set(id, await store.positionBefore(d.godownId, ord, k, d._id));
    }
  }
  throw new Error("postWithStore: stock keys did not converge");
}

export function serializeDerived(d: Doc, res: PostingResultV2): Derived {
  return { lines: toLedgerDocsV2(d, res.lines), moves: toMoveDocsV2(d, res.moves) };
}

function canonLine(l: LedgerLineV2): string {
  return [
    l._id,
    l.voucherRev,
    l.date,
    l.account,
    l.debitPaise,
    l.creditPaise,
    l.partyId ?? "",
    l.varietyId ?? "",
    l.vehicleId ?? "",
    l.fy,
  ].join("|");
}

function canonMove(m: StockMoveV2): string {
  return [
    m._id,
    m.voucherRev,
    m.date,
    stockKeyId(moveKey(m)),
    m.qtyG,
    m.valuePaise,
    m.bags ?? "",
    m.ord ?? "",
  ].join("|");
}

export function sameDerived(a: Derived, b: Derived): boolean {
  if (a.lines.length !== b.lines.length || a.moves.length !== b.moves.length) return false;
  const la = a.lines.map(canonLine).sort();
  const lb = b.lines.map(canonLine).sort();
  const ma = a.moves.map(canonMove).sort();
  const mb = b.moves.map(canonMove).sort();
  return la.every((x, i) => x === lb[i]) && ma.every((x, i) => x === mb[i]);
}

export interface ApplyResult {
  derived: Derived;
  /** Ids of OTHER documents whose stored rows changed (cost re-posted). */
  reposted: string[];
}

/**
 * Write `d`'s derived rows (none if void) and re-post every dependent later document.
 * `prev` is the stored version before this change (undefined for a create).
 */
export async function applyDocDerived(
  store: DerivedStore,
  d: Doc,
  prev?: Doc,
): Promise<ApplyResult> {
  const before = await store.readDerived(d._id);
  const after =
    d.status === "void" ? EMPTY_DERIVED : serializeDerived(d, await postWithStore(d, store));
  await store.writeDerived(d, before, after);
  const newOrd = ordOfDoc(d);
  const startOrd = prev && ordOfDoc(prev) < newOrd ? ordOfDoc(prev) : newOrd;
  const keys = new Map([...stockKeysOf(before.moves), ...stockKeysOf(after.moves)]);
  const reposted = await repostAfter(store, d.godownId, startOrd, keys, new Set([d._id]));
  return { derived: after, reposted };
}

/** Re-post (in canonical order) every document after `startOrd` that moves an affected position. */
export async function repostAfter(
  store: DerivedStore,
  godownId: string,
  startOrd: string,
  initialKeys: Map<string, StockKeyV2>,
  done: Set<string>,
): Promise<string[]> {
  const affected = new Map(initialKeys);
  const queue = new Map<string, string>();
  const enqueue = async (afterOrd: string, keys: StockKeyV2[]) => {
    if (keys.length === 0) return;
    for (const { docId, ord } of await store.docsAfter(godownId, afterOrd, keys)) {
      if (!done.has(docId)) queue.set(docId, ord);
    }
  };
  await enqueue(startOrd, [...affected.values()]);

  const changed: string[] = [];
  while (queue.size > 0) {
    let nextId = "";
    let nextOrd = "";
    for (const [id, ord] of queue) {
      if (nextId === "" || ord < nextOrd) {
        nextId = id;
        nextOrd = ord;
      }
    }
    queue.delete(nextId);
    if (done.has(nextId)) continue;
    done.add(nextId);

    const w = await store.getDoc(nextId);
    if (!w || w.status === "void" || w.godownId !== godownId) continue;
    const before = await store.readDerived(w._id);
    const after = serializeDerived(w, await postWithStore(w, store));
    if (sameDerived(before, after)) continue;
    await store.writeDerived(w, before, after);
    changed.push(w._id);

    const newKeys: StockKeyV2[] = [];
    for (const [s, k] of stockKeysOf(after.moves)) {
      if (!affected.has(s)) {
        affected.set(s, k);
        newKeys.push(k);
      }
    }
    await enqueue(ordOfDoc(w), newKeys);
  }
  return changed;
}

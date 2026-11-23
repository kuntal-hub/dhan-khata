/**
 * Storage-agnostic derivation of a voucher's ledger lines and stock moves, shared by the local
 * write path (Dexie) and the server (Mongo). Each side implements `DerivedStore` for its database.
 *
 * Cost of goods depends on the stock position BEFORE a voucher in canonical order
 * (`ordOf` = date | createdAt | _id, the same order as `replay`). When a voucher is written,
 * edited or voided, every later voucher that moves the same stock (variety + location, or the
 * same TRANSIT group) is re-posted, so stored lines always equal a full `replay`.
 */
import type { StockLocation } from "../schemas/common";
import type { LedgerLine, StockMove } from "../schemas/system";
import type { Voucher } from "../schemas/vouchers";
import { post, type PostingContext, type PostingResult, type StockPosition } from "./post";
import { toLedgerLineDocs, toStockMoveDocs } from "./replay";

export interface StockKey {
  varietyId: string;
  location: StockLocation;
  /** Only for TRANSIT: the voucher group whose specific cost applies. */
  groupId?: string;
}

export interface Derived {
  lines: LedgerLine[];
  moves: StockMove[];
}

export const EMPTY_DERIVED: Derived = { lines: [], moves: [] };

export interface DerivedStore {
  /** Σ of stored moves for `key` in the godown with `ord` < the given ord (excluding one voucher). */
  positionBefore(
    godownId: string,
    ord: string,
    key: StockKey,
    excludeVoucherId: string,
  ): Promise<StockPosition>;
  /** Vouchers that have stored moves on any of `keys` with `ord` > the given ord. */
  vouchersAfter(
    godownId: string,
    ord: string,
    keys: readonly StockKey[],
  ): Promise<Array<{ voucherId: string; ord: string }>>;
  getVoucher(id: string): Promise<Voucher | undefined>;
  readDerived(voucherId: string): Promise<Derived>;
  /** Replace a voucher's stored derived rows: delete `before`, insert `after`. */
  writeDerived(v: Voucher, before: Derived, after: Derived): Promise<void>;
}

/** Canonical posting order key; lexicographic order == `voucherOrder`. */
export function ordOf(v: Pick<Voucher, "date" | "createdAt" | "_id">): string {
  return `${v.date}|${v.createdAt}|${v._id}`;
}

export function stockKeyString(k: StockKey): string {
  return `${k.varietyId}|${k.location}|${k.location === "TRANSIT" ? (k.groupId ?? "") : ""}`;
}

function keyOf(varietyId: string, location: StockLocation, groupId?: string): StockKey {
  return location === "TRANSIT" && groupId
    ? { varietyId, location, groupId }
    : { varietyId, location };
}

export function stockKeysOf(moves: readonly StockMove[]): Map<string, StockKey> {
  const out = new Map<string, StockKey>();
  for (const m of moves) {
    const k = keyOf(m.varietyId, m.location, m.groupId);
    out.set(stockKeyString(k), k);
  }
  return out;
}

/** Post `v` using stock positions read from the store (keys discovered by a dry run). */
export async function postWithStore(v: Voucher, store: DerivedStore): Promise<PostingResult> {
  const ord = ordOf(v);
  const positions = new Map<string, StockPosition>();
  for (let attempt = 0; attempt < 5; attempt++) {
    const missing = new Map<string, StockKey>();
    const ctx: PostingContext = {
      position: (varietyId, location, groupId) => {
        const k = keyOf(varietyId, location, groupId);
        const s = stockKeyString(k);
        const p = positions.get(s);
        if (p) return p;
        missing.set(s, k);
        return { qtyG: 0n, valuePaise: 0n };
      },
    };
    const result = post(v, ctx);
    if (missing.size === 0) return result;
    for (const [s, k] of missing) {
      positions.set(s, await store.positionBefore(v.godownId, ord, k, v._id));
    }
  }
  throw new Error("postWithStore: stock keys did not converge");
}

/** Serialize a posting into stored docs (moves carry `ord`). */
export function serializeDerived(v: Voucher, res: PostingResult): Derived {
  const ord = ordOf(v);
  return {
    lines: toLedgerLineDocs(v, res.lines),
    moves: toStockMoveDocs(v, res.moves).map((m) => ({ ...m, ord })),
  };
}

function canonLine(l: LedgerLine): string {
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
    l.loadId ?? "",
    l.season ?? "",
    l.fy,
  ].join("|");
}

function canonMove(m: StockMove): string {
  return [
    m._id,
    m.voucherRev,
    m.date,
    m.location,
    m.varietyId,
    m.qtyG,
    m.valuePaise,
    m.groupId ?? "",
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
  /** Ids of OTHER vouchers whose stored lines/moves changed (cost of goods re-posted). */
  reposted: string[];
}

/**
 * Write `v`'s derived rows (none if void) and re-post every dependent later voucher.
 * `prev` is the stored version before this change (undefined for a create).
 */
export async function applyVoucherDerived(
  store: DerivedStore,
  v: Voucher,
  prev?: Voucher,
): Promise<ApplyResult> {
  const before = await store.readDerived(v._id);
  const after =
    v.status === "void" ? EMPTY_DERIVED : serializeDerived(v, await postWithStore(v, store));
  await store.writeDerived(v, before, after);

  const newOrd = ordOf(v);
  const startOrd = prev && ordOf(prev) < newOrd ? ordOf(prev) : newOrd;
  const keys = new Map([...stockKeysOf(before.moves), ...stockKeysOf(after.moves)]);
  const reposted = await repostAfter(store, v.godownId, startOrd, keys, new Set([v._id]));
  return { derived: after, reposted };
}

/** Re-post (in canonical order) every voucher after `startOrd` that moves any affected stock key. */
export async function repostAfter(
  store: DerivedStore,
  godownId: string,
  startOrd: string,
  initialKeys: Map<string, StockKey>,
  done: Set<string>,
): Promise<string[]> {
  const affected = new Map(initialKeys);
  const queue = new Map<string, string>(); // voucherId → ord
  const enqueue = async (afterOrd: string, keys: StockKey[]) => {
    if (keys.length === 0) return;
    for (const { voucherId, ord } of await store.vouchersAfter(godownId, afterOrd, keys)) {
      if (!done.has(voucherId)) queue.set(voucherId, ord);
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

    const w = await store.getVoucher(nextId);
    if (!w || w.status === "void" || w.godownId !== godownId) continue;
    const before = await store.readDerived(w._id);
    const after = serializeDerived(w, await postWithStore(w, store));
    if (sameDerived(before, after)) continue;
    await store.writeDerived(w, before, after);
    changed.push(w._id);

    const newKeys: StockKey[] = [];
    for (const [s, k] of stockKeysOf(after.moves)) {
      if (!affected.has(s)) {
        affected.set(s, k);
        newKeys.push(k);
      }
    }
    await enqueue(ordOf(w), newKeys);
  }
  return changed;
}

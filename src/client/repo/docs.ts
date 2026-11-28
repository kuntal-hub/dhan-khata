/**
 * The single local write path for v2 documents (requirement_v2 §5, §17). Every public function
 * runs ONE Dexie transaction:
 *   validate (Zod) → recomputeDoc → rules → same-Gola refs → cross-document links → day status →
 *   assign number → write revision → replace ledgerLines + stockMoves (+ dependent re-posts)
 *   → dailyAgg → outbox (one op group per transaction) → audit → commit.
 * If anything throws, nothing is written.
 *
 * Linked records: payments point at their source (`source.id`); returns/conversions/settlement
 * sales point at their dispatch; loads link 1:1 to a sale or dispatch. Voiding a source with
 * active payments is blocked (LINKED_PAYMENTS) unless the caller asks to void them together;
 * other dependents always block (ALREADY_LINKED).
 */
import { v7 as uuidv7 } from "uuid";
import { fyOf, seasonOf } from "@/domain/dates";
import { formatVoucherNumber } from "@/domain/numbering";
import { can } from "@/domain/rbac";
import { assertGodownUnchanged, checkSameGodown, collectRefs } from "@/domain/scope";
import { cashEffects } from "@/domain/v2/cashbook";
import { applyDocDerived } from "@/domain/v2/derive";
import { DUE_DATE_FIELD_TYPES, checkDueDate, isDueDateType } from "@/domain/v2/dueDate";
import { fareBillChanged, linkedDocIds, settlementGuard, validateLinks } from "@/domain/v2/links";
import { recomputeDoc, validateDocRules } from "@/domain/v2/recompute";
import { DocSchema, businessDate, type Doc, type DocType } from "@/domain/v2/schemas";
import { DomainError } from "@/domain/errors";
import { db, writeTables } from "../db/dexie";
import { nextVoucherSeq } from "../db/meta";
import {
  RepoError,
  auditLocal,
  buildLookup,
  enqueueOp,
  validationError,
  writeContext,
  type WriteCtx,
} from "./context";
import { dexieDerivedStore } from "./derivedStore";
import { emitLocalWrite } from "./notify";

type BookkeepingKeys =
  | "_id"
  | "businessId"
  | "godownId"
  | "rev"
  | "status"
  | "voidReason"
  | "entryDate"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "deviceId"
  | "serverSeq"
  | "number"
  | "fy"
  | "editReason";

/** A document without bookkeeping fields. `_id` may be pre-assigned to link records. */
export type DocDraft = Doc extends infer D
  ? D extends Doc
    ? Omit<D, BookkeepingKeys> & { _id?: string }
    : never
  : never;

export type DraftOf<T extends DocType> = Extract<DocDraft, { type: T }>;

export function newId(): string {
  return uuidv7();
}

const BOOKKEEPING = [
  "businessId",
  "godownId",
  "rev",
  "status",
  "voidReason",
  "entryDate",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "deviceId",
  "serverSeq",
  "number",
  "fy",
  "editReason",
];

function withoutBookkeeping(draft: Record<string, unknown>): Record<string, unknown> {
  const out = { ...draft };
  for (const k of BOOKKEEPING) delete out[k];
  return out;
}

function draftDate(draft: DocDraft): string {
  return businessDate(draft as unknown as Doc);
}

async function finalize(ctx: WriteCtx, raw: Record<string, unknown>): Promise<Doc> {
  const first = DocSchema.safeParse(raw);
  if (!first.success) throw validationError(first.error);
  let recomputed: Doc;
  try {
    recomputed = recomputeDoc(first.data);
  } catch (e) {
    if (e instanceof DomainError) throw new RepoError(e.code, e.detail);
    throw e;
  }
  const second = DocSchema.safeParse(recomputed);
  if (!second.success) throw validationError(second.error);
  const d = second.data;
  try {
    validateDocRules(d, ctx.today);
  } catch (e) {
    if (e instanceof DomainError) throw new RepoError(e.code, e.detail);
    throw e;
  }
  return d;
}

/** Same-Gola references, then cross-document links (payment source, dispatch, load). */
async function assertRefsAndLinks(d: Doc, extra?: ReadonlyMap<string, string>): Promise<void> {
  const lookup = await buildLookup(d.godownId, collectRefs(d), extra);
  const r = checkSameGodown(d, lookup);
  if (!r.ok) throw new RepoError(r.code, `${r.ref.kind}:${r.ref.id}`);
  const ids = linkedDocIds(d);
  const docs = new Map<string, Doc>();
  for (const id of ids) {
    const x = await db().vouchers.get(id);
    if (x) docs.set(id, x);
  }
  try {
    validateLinks(d, (id) => docs.get(id));
  } catch (e) {
    if (e instanceof DomainError) throw new RepoError(e.code, e.detail);
    throw e;
  }
}

/** One final settlement per dispatch; a settled dispatch is closed (`settlementGuard`). */
async function assertSettlementGuard(d: Doc, existing?: Doc): Promise<void> {
  const g = settlementGuard(d, existing);
  if (!g) return;
  const rows = await db().vouchers.where("dispatchId").equals(g.dispatchId).toArray();
  if (
    rows.some((x) => x.type === "MILL_SETTLEMENT" && x.status === "active" && x._id !== g.exceptId)
  ) {
    throw new RepoError("ALREADY_LINKED", `settlement:${g.dispatchId}`);
  }
}

async function assignNumber(ctx: WriteCtx, type: DocType): Promise<string> {
  for (;;) {
    const seq = await nextVoucherSeq(ctx.godown._id, type);
    const num = formatVoucherNumber(ctx.godown.code, ctx.deviceCode, type, seq);
    if ((await db().vouchers.where("number").equals(num).count()) === 0) return num;
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Same content, ignoring bookkeeping fields. */
export function sameDocContent(a: Doc, b: Doc): boolean {
  const norm = (d: Doc) =>
    JSON.stringify(sortKeys(withoutBookkeeping(d as unknown as Record<string, unknown>)));
  return norm(a) === norm(b);
}

// ── Day status (cashbook day close, §12.1B) ───────────────────────────────────────────────────

export function dayStatusId(godownId: string, date: string): string {
  return `${godownId}:${date}`;
}

async function activeDayCloses(godownId: string, date: string): Promise<Doc[]> {
  return db()
    .vouchers.where("[godownId+type]")
    .equals([godownId, "DAY_CLOSE"])
    .filter((v) => v.status === "active" && v.type === "DAY_CLOSE" && v.date === date)
    .toArray();
}

async function onDayCloseWritten(ctx: WriteCtx, d: Doc, created: boolean): Promise<void> {
  if (d.type !== "DAY_CLOSE") return;
  const godownId = ctx.godown._id;
  if (d.status === "active") {
    if (created && (await activeDayCloses(godownId, d.date)).some((x) => x._id !== d._id)) {
      throw new RepoError("DAY_ALREADY_CLOSED", d.date);
    }
    await db().dayStatus.put({
      _id: dayStatusId(godownId, d.date),
      godownId,
      date: d.date,
      closed: true,
      countedCashPaise: d.actualClosingPaise,
      expectedCashPaise: d.expectedClosingPaise,
      closedBy: ctx.userId,
      closedAt: ctx.nowIso,
    });
  } else if ((await activeDayCloses(godownId, d.date)).length === 0) {
    await db().dayStatus.put({
      _id: dayStatusId(godownId, d.date),
      godownId,
      date: d.date,
      closed: false,
    });
  }
}

/**
 * A cash entry dated on or before a closed day changes that day's expected closing: the closed
 * days from that date on show "পরে এন্ট্রি হয়েছে — আবার মেলান" (§7.1).
 */
async function flagRecheck(ctx: WriteCtx, dates: Iterable<string>): Promise<void> {
  const list = [...new Set(dates)].sort();
  if (list.length === 0) return;
  const from = list[0]!;
  const rows = await db()
    .dayStatus.where("[godownId+date]")
    .between([ctx.godown._id, from], [ctx.godown._id, "￿"])
    .toArray();
  for (const r of rows) {
    if (r.closed && !r.lateEntry) await db().dayStatus.update(r._id, { lateEntry: true });
  }
}

function cashDates(...docs: Array<Doc | undefined>): string[] {
  return docs
    .filter((d): d is Doc => !!d && d.type !== "DAY_CLOSE")
    .flatMap((d) => cashEffects({ ...d, status: "active" } as Doc).map((e) => e.date));
}

// ── Dependents ───────────────────────────────────────────────────────────────────────────────

/** Active payments settling `docId` (including VEHICLE_COST `docId:cost` and OPENING_DUE). */
export async function paymentsOfSource(docId: string): Promise<Doc[]> {
  const d = db();
  const exact = await d.vouchers.where("source.id").equals(docId).toArray();
  const nested = await d.vouchers.where("source.id").startsWith(`${docId}:`).toArray();
  return [...exact, ...nested].filter((p) => p.status === "active" && p.type === "PAYMENT");
}

/**
 * Active non-payment documents that depend on `doc` (returns, conversions, final settlement, and
 * legacy consignment sales).
 */
export async function dependentsOf(doc: Doc): Promise<Doc[]> {
  const d = db();
  const out: Doc[] = [];
  if (doc.type === "MILL_DISPATCH") {
    const rows = await d.vouchers.where("dispatchId").equals(doc._id).toArray();
    out.push(...rows.filter((x) => x.status === "active"));
    const sales = await d.vouchers
      .where("[godownId+type]")
      .equals([doc.godownId, "SALE"])
      .filter(
        (x) => x.status === "active" && x.type === "SALE" && x.consignmentDispatchId === doc._id,
      )
      .toArray();
    out.push(...sales);
  }
  if (doc.type === "MILL_RETURN") {
    const convs = await d.vouchers
      .where("dispatchId")
      .equals(doc.dispatchId)
      .filter(
        (x) =>
          x.status === "active" &&
          x.type === "CONVERSION" &&
          x.outputs.some((o) => o.returnId === doc._id),
      )
      .toArray();
    out.push(...convs);
  }
  return out;
}

// ── In-transaction primitives ────────────────────────────────────────────────────────────────

export interface CreateOpts {
  id?: string;
  groupId?: string;
  /** Ids created in the same transaction (same Gola), for reference checks. */
  extra?: ReadonlyMap<string, string>;
}

export async function createInTx(
  ctx: WriteCtx,
  draft: DocDraft,
  opts: CreateOpts = {},
): Promise<Doc> {
  const d = db();
  const godownId = ctx.godown._id;
  if (
    (draft as { godownId?: string }).godownId &&
    (draft as { godownId?: string }).godownId !== godownId
  ) {
    throw new RepoError("GODOWN_IMMUTABLE");
  }
  if (
    !can(ctx.session.user, godownId, "voucher.create", {
      voucherType: draft.type,
      grouped: !!opts.groupId,
    })
  ) {
    throw new RepoError("FORBIDDEN", draft.type);
  }
  const date = draftDate(draft);
  const season = (draft as { season?: string }).season ?? seasonOf(date, ctx.settings.seasonMap);
  const groupId = opts.groupId ?? draft.groupId;
  const raw: Record<string, unknown> = {
    ...withoutBookkeeping(draft as Record<string, unknown>),
    _id: opts.id ?? draft._id ?? uuidv7(),
    businessId: ctx.businessId,
    godownId,
    rev: 1,
    status: "active",
    entryDate: ctx.today,
    createdAt: ctx.nowIso,
    createdBy: ctx.userId,
    updatedAt: ctx.nowIso,
    updatedBy: ctx.userId,
    deviceId: ctx.deviceId,
    number: await assignNumber(ctx, draft.type),
    fy: fyOf(date),
    ...(season ? { season } : {}),
    ...(groupId ? { groupId } : {}),
  };
  // Only deals carry a due date (D54); it may be in the future but not before the deal.
  if (!isDueDateType(draft.type)) delete raw.dueDate;
  else if (typeof raw.dueDate === "string") {
    const c = checkDueDate(raw.dueDate, date, ctx.today);
    if (c.error) throw new RepoError(c.error, raw.dueDate);
  }
  const doc = await finalize(ctx, raw);
  await assertRefsAndLinks(doc, opts.extra);
  await assertSettlementGuard(doc);
  if (await d.vouchers.get(doc._id)) throw new RepoError("VALIDATION_FAILED", "duplicate id");
  await onDayCloseWritten(ctx, doc, true);
  await d.vouchers.add(doc);
  await applyDocDerived(dexieDerivedStore, doc);
  await flagRecheck(ctx, cashDates(doc));
  await enqueueOp(ctx, {
    entity: "voucher",
    entityId: doc._id,
    op: "upsert",
    baseRev: 0,
    payload: doc,
  });
  await auditLocal(ctx, { entity: "voucher", entityId: doc._id, action: "create", rev: 1 });
  return doc;
}

export async function loadForChange(
  ctx: WriteCtx,
  id: string,
  action: "voucher.edit" | "voucher.void",
): Promise<Doc> {
  const existing = await db().vouchers.get(id);
  if (!existing) throw new RepoError("NOT_FOUND", id);
  if (existing.godownId !== ctx.godown._id) throw new RepoError("GODOWN_IMMUTABLE");
  if (existing.status === "void") throw new RepoError("VOUCHER_VOID");
  if (action === "voucher.edit" && existing.type === "DAY_CLOSE")
    throw new RepoError("TYPE_IMMUTABLE");
  if (!can(ctx.session.user, ctx.godown._id, action, { voucherType: existing.type })) {
    throw new RepoError("FORBIDDEN", existing.type);
  }
  return existing;
}

async function prepareEdit(
  ctx: WriteCtx,
  existing: Doc,
  draft: DocDraft,
  reason?: string,
): Promise<Doc> {
  if (
    (draft as { godownId?: string }).godownId &&
    (draft as { godownId?: string }).godownId !== existing.godownId
  ) {
    throw new RepoError("GODOWN_IMMUTABLE");
  }
  if (draft.type !== existing.type) throw new RepoError("TYPE_IMMUTABLE");
  const date = draftDate(draft);
  const raw: Record<string, unknown> = {
    ...withoutBookkeeping(draft as Record<string, unknown>),
    _id: existing._id,
    businessId: existing.businessId,
    godownId: existing.godownId,
    rev: existing.rev + 1,
    status: "active",
    entryDate: existing.entryDate,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    updatedAt: ctx.nowIso,
    updatedBy: ctx.userId,
    deviceId: existing.deviceId,
    number: existing.number,
    fy: fyOf(date),
    ...(existing.serverSeq !== undefined ? { serverSeq: existing.serverSeq } : {}),
    ...(existing.groupId ? { groupId: existing.groupId } : {}),
    ...(reason?.trim() ? { editReason: reason.trim() } : {}),
  };
  if (!(draft as { season?: string }).season && existing.season) raw.season = existing.season;
  // A full edit never changes the due date: it has its own op (`setDueDate`, last writer wins),
  // and legacy due dates on other types stay untouched (D54).
  if (DUE_DATE_FIELD_TYPES.includes(existing.type)) {
    const keep = (existing as { dueDate?: string }).dueDate;
    if (keep) raw.dueDate = keep;
    else delete raw.dueDate;
  }
  const next = await finalize(ctx, raw);
  assertGodownUnchanged(existing, next);
  await assertRefsAndLinks(next);
  await assertSettlementGuard(next, existing);
  // A bill's party can't change under its payments (they'd settle someone else's bill).
  if ("partyId" in existing && "partyId" in next && existing.partyId !== next.partyId) {
    if ((await paymentsOfSource(existing._id)).length > 0) throw new RepoError("LINKED_PAYMENTS");
  }
  // Same for a purchase's vehicle fare: its owner can't change (or the fare go) under payments.
  const fareSource = fareBillChanged(existing, next);
  if (fareSource) {
    const paid = await db().vouchers.where("source.id").equals(fareSource).toArray();
    if (paid.some((p) => p.status === "active" && p.type === "PAYMENT"))
      throw new RepoError("LINKED_PAYMENTS", fareSource);
  }
  return next;
}

/** Edit unless nothing changed. Returns the stored document. */
export async function editInTx(
  ctx: WriteCtx,
  existing: Doc,
  draft: DocDraft,
  reason?: string,
): Promise<Doc> {
  const next = await prepareEdit(ctx, existing, draft, reason);
  if (sameDocContent(existing, next)) return existing;
  await db().vouchers.put(next);
  await applyDocDerived(dexieDerivedStore, next, existing);
  await flagRecheck(ctx, cashDates(existing, next));
  await enqueueOp(ctx, {
    entity: "voucher",
    entityId: next._id,
    op: "upsert",
    baseRev: existing.rev,
    payload: next,
  });
  await auditLocal(ctx, {
    entity: "voucher",
    entityId: next._id,
    action: "edit",
    rev: next.rev,
    ...(reason ? { reason } : {}),
  });
  return next;
}

export async function voidOneInTx(ctx: WriteCtx, existing: Doc, reason: string): Promise<Doc> {
  const next = DocSchema.parse({
    ...existing,
    rev: existing.rev + 1,
    status: "void",
    voidReason: reason,
    updatedAt: ctx.nowIso,
    updatedBy: ctx.userId,
  });
  await db().vouchers.put(next);
  await applyDocDerived(dexieDerivedStore, next, existing);
  await onDayCloseWritten(ctx, next, false);
  await flagRecheck(ctx, cashDates(existing));
  await enqueueOp(ctx, {
    entity: "voucher",
    entityId: next._id,
    op: "void",
    baseRev: existing.rev,
    payload: next,
  });
  await auditLocal(ctx, {
    entity: "voucher",
    entityId: next._id,
    action: "void",
    rev: next.rev,
    reason,
  });
  return next;
}

/** Void `existing`; its payments too when `withPayments` (else LINKED_PAYMENTS). */
export async function voidWithDependentsInTx(
  ctx: WriteCtx,
  existing: Doc,
  reason: string,
  withPayments: boolean,
): Promise<Doc[]> {
  const others = await dependentsOf(existing);
  if (others.length > 0) throw new RepoError("ALREADY_LINKED", String(others.length));
  const payments = existing.type === "PAYMENT" ? [] : await paymentsOfSource(existing._id);
  if (payments.length > 0 && !withPayments)
    throw new RepoError("LINKED_PAYMENTS", String(payments.length));
  const out: Doc[] = [];
  for (const p of payments) out.push(await voidOneInTx(ctx, p, reason));
  out.push(await voidOneInTx(ctx, existing, reason));
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────────────────────

export interface SaveItem {
  draft: DocDraft;
  /** Existing document to edit (omit to create; `draft._id` may pre-assign the new id). */
  id?: string;
}

/**
 * Create and/or edit several documents of ONE Gola in one transaction (e.g. a purchase and its
 * initial payment). Items may reference each other's pre-assigned ids. Returns the stored docs.
 */
export async function saveDocs(
  godownId: string,
  items: readonly SaveItem[],
  opts: { reason?: string; groupId?: string } = {},
): Promise<Doc[]> {
  if (items.length === 0) return [];
  const d = db();
  const saved = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const ids = items.map((it) => it.id ?? it.draft._id ?? uuidv7());
    const extra = new Map(ids.map((id) => [id, godownId] as const));
    const out: Doc[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (it.id) {
        const existing = await loadForChange(ctx, it.id, "voucher.edit");
        out.push(await editInTx(ctx, existing, it.draft, opts.reason));
      } else {
        out.push(
          await createInTx(ctx, it.draft, {
            id: ids[i]!,
            extra,
            ...(opts.groupId ? { groupId: opts.groupId } : {}),
          }),
        );
      }
    }
    return out;
  });
  emitLocalWrite();
  return saved;
}

/** Create or edit one document. */
export async function saveDoc(
  godownId: string,
  draft: DocDraft,
  opts: { id?: string; reason?: string } = {},
): Promise<Doc> {
  const [doc] = await saveDocs(godownId, [{ draft, ...(opts.id ? { id: opts.id } : {}) }], {
    ...(opts.reason ? { reason: opts.reason } : {}),
  });
  return doc!;
}

/**
 * Void (reverse) a document with a reason. A bill with active payments needs `withPayments`
 * (then they are voided together); other dependents (returns, conversions, settlement) block.
 */
export async function voidDoc(
  godownId: string,
  id: string,
  reason: string,
  opts: { withPayments?: boolean } = {},
): Promise<Doc[]> {
  if (!reason.trim()) throw new RepoError("NOTE_REQUIRED");
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const existing = await loadForChange(ctx, id, "voucher.void");
    return voidWithDependentsInTx(ctx, existing, reason.trim(), opts.withPayments === true);
  });
  emitLocalWrite();
  return out;
}

/**
 * Void several documents of one Gola in ONE transaction (e.g. the per-bill parts of one payment
 * made across several bills). Each follows the `voidDoc` rules without `withPayments`.
 */
export async function voidDocs(
  godownId: string,
  ids: readonly string[],
  reason: string,
): Promise<Doc[]> {
  if (!reason.trim()) throw new RepoError("NOTE_REQUIRED");
  if (ids.length === 0) return [];
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const done: Doc[] = [];
    for (const id of ids) {
      const existing = await loadForChange(ctx, id, "voucher.void");
      done.push(...(await voidWithDependentsInTx(ctx, existing, reason.trim(), false)));
    }
    return done;
  });
  emitLocalWrite();
  return out;
}

/**
 * The single local write path for vouchers (spec §12.2). Every function runs ONE Dexie
 * transaction:
 *   validate (Zod) → recomputeVoucher → rules → same-godown refs → day lock / role →
 *   assign number → write voucher rev → replace ledgerLines + stockMoves (+ dependent re-posts)
 *   → update dailyAgg → append outbox op → auditLocal → commit.
 * If anything throws, nothing is written.
 */
import { v7 as uuidv7 } from "uuid";
import { recomputeVoucher, validateVoucherRules } from "@/domain/calc/recompute";
import { fyOf, seasonOf } from "@/domain/dates";
import { formatVoucherNumber } from "@/domain/numbering";
import { applyVoucherDerived } from "@/domain/posting/derive";
import { can, entryMayChange } from "@/domain/rbac";
import { VoucherSchema, type Voucher } from "@/domain/schemas";
import { assertGodownUnchanged, checkSameGodown, collectRefs } from "@/domain/scope";
import { db, writeTables } from "../db/dexie";
import { nextVoucherSeq } from "../db/meta";
import {
  RepoError,
  assertDayOpen,
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
  | "godownId"
  | "rev"
  | "createdAt"
  | "createdBy"
  | "deviceId"
  | "updatedAt"
  | "updatedBy"
  | "serverSeq"
  | "status"
  | "voidReason"
  | "number"
  | "fy"
  | "editReason";

/** A voucher without bookkeeping fields. `_id` may be pre-assigned to link vouchers in a group. */
export type VoucherDraft = Voucher extends infer V
  ? V extends Voucher
    ? Omit<V, BookkeepingKeys> & { _id?: string }
    : never
  : never;

export function newId(): string {
  return uuidv7();
}

async function finalize(raw: Record<string, unknown>): Promise<Voucher> {
  const first = VoucherSchema.safeParse(raw);
  if (!first.success) throw validationError(first.error);
  const recomputed = recomputeVoucher(first.data);
  const second = VoucherSchema.safeParse(recomputed);
  if (!second.success) throw validationError(second.error);
  const v = second.data;
  const rules = validateVoucherRules(v);
  if (rules.length > 0) throw new RepoError(rules[0]!, undefined, rules);
  return v;
}

async function assertRefs(v: Voucher, extra?: ReadonlyMap<string, string>): Promise<void> {
  const lookup = await buildLookup(v.godownId, collectRefs(v), extra);
  const r = checkSameGodown(v, lookup);
  if (!r.ok) throw new RepoError(r.code, `${r.ref.kind}:${r.ref.id}`);
}

async function assignNumber(ctx: WriteCtx, type: Voucher["type"]): Promise<string> {
  // Defensive: skip any number already present on this device.
  for (;;) {
    const seq = await nextVoucherSeq(ctx.godown._id, type);
    const num = formatVoucherNumber(ctx.godown.code, ctx.deviceCode, type, seq);
    if ((await db().vouchers.where("number").equals(num).count()) === 0) return num;
  }
}

function withoutBookkeeping(draft: Record<string, unknown>): Record<string, unknown> {
  const out = { ...draft };
  for (const k of [
    "godownId",
    "rev",
    "createdAt",
    "createdBy",
    "deviceId",
    "updatedAt",
    "updatedBy",
    "serverSeq",
    "status",
    "voidReason",
    "number",
    "fy",
    "editReason",
  ]) {
    delete out[k];
  }
  return out;
}

function guardGodownField(godownId: string, draft: object): void {
  const g = (draft as { godownId?: unknown }).godownId;
  if (g !== undefined && g !== godownId) throw new RepoError("GODOWN_IMMUTABLE");
}

/** Create one voucher. */
export async function createVoucher(godownId: string, draft: VoucherDraft): Promise<Voucher> {
  const [v] = await createVoucherGroup(godownId, [draft], { forceGroup: false });
  return v!;
}

/**
 * Create several linked vouchers in ONE transaction with a shared `groupId`
 * (e.g. PURCHASE + paid-now PAYMENT; LOAD → PURCHASE + SALE).
 */
export async function createVoucherGroup(
  godownId: string,
  drafts: readonly VoucherDraft[],
  opts: { groupId?: string; forceGroup?: boolean } = {},
): Promise<Voucher[]> {
  if (drafts.length === 0) return [];
  const d = db();
  const created = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const grouped = opts.forceGroup ?? drafts.length > 1;
    const groupId = grouped ? (opts.groupId ?? drafts[0]!.groupId ?? uuidv7()) : drafts[0]!.groupId;
    const ids = drafts.map((dr) => dr._id ?? uuidv7());
    const extra = new Map(ids.map((id) => [id, godownId] as const));

    const out: Voucher[] = [];
    for (let i = 0; i < drafts.length; i++) {
      const draft = drafts[i]!;
      guardGodownField(godownId, draft);
      if (
        !can(ctx.session.user, godownId, "voucher.create", {
          voucherType: draft.type,
          grouped: groupId !== undefined,
        })
      ) {
        throw new RepoError("FORBIDDEN", draft.type);
      }
      await assertDayOpen(ctx, draft.date);
      const season = draft.season ?? seasonOf(draft.date, ctx.settings.seasonMap);
      const raw: Record<string, unknown> = {
        ...withoutBookkeeping(draft as Record<string, unknown>),
        _id: ids[i]!,
        godownId,
        rev: 1,
        createdAt: ctx.nowIso,
        createdBy: ctx.userId,
        deviceId: ctx.deviceId,
        updatedAt: ctx.nowIso,
        updatedBy: ctx.userId,
        status: "active",
        number: await assignNumber(ctx, draft.type),
        fy: fyOf(draft.date),
        ...(season ? { season } : {}),
        ...(groupId ? { groupId } : {}),
      };
      const v = await finalize(raw);
      await assertRefs(v, extra);
      if (await d.vouchers.get(v._id)) throw new RepoError("VALIDATION_FAILED", "duplicate id");
      await d.vouchers.add(v);
      await applyVoucherDerived(dexieDerivedStore, v);
      await enqueueOp(ctx, {
        entity: "voucher",
        entityId: v._id,
        op: "upsert",
        baseRev: 0,
        payload: v,
      });
      await auditLocal(ctx, { entity: "voucher", entityId: v._id, action: "create", rev: 1 });
      out.push(v);
    }
    return out;
  });
  emitLocalWrite();
  return created;
}

async function loadForChange(
  ctx: WriteCtx,
  godownId: string,
  id: string,
  action: "voucher.edit" | "voucher.void",
): Promise<Voucher> {
  const existing = await db().vouchers.get(id);
  if (!existing) throw new RepoError("NOT_FOUND", id);
  if (existing.godownId !== godownId) throw new RepoError("GODOWN_IMMUTABLE");
  if (existing.status === "void") throw new RepoError("VOUCHER_VOID");
  if (!can(ctx.session.user, godownId, action, { voucherType: existing.type })) {
    throw new RepoError("FORBIDDEN", existing.type);
  }
  if (
    ctx.role === "entry" &&
    !entryMayChange(existing, ctx.userId, ctx.nowIso, { requireUnsynced: true })
  ) {
    throw new RepoError("EDIT_WINDOW_EXPIRED");
  }
  await assertDayOpen(ctx, existing.date);
  return existing;
}

/** Edit a voucher: writes revision n+1 and replaces its derived rows. `godownId` never changes. */
export async function editVoucher(
  godownId: string,
  id: string,
  draft: VoucherDraft,
  reason?: string,
): Promise<Voucher> {
  const d = db();
  const v = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    guardGodownField(godownId, draft);
    const existing = await loadForChange(ctx, godownId, id, "voucher.edit");
    if (draft.type !== existing.type) throw new RepoError("TYPE_IMMUTABLE");
    await assertDayOpen(ctx, draft.date);
    const raw: Record<string, unknown> = {
      ...withoutBookkeeping(draft as Record<string, unknown>),
      _id: existing._id,
      godownId: existing.godownId,
      rev: existing.rev + 1,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      deviceId: existing.deviceId,
      updatedAt: ctx.nowIso,
      updatedBy: ctx.userId,
      status: "active",
      number: existing.number,
      fy: fyOf(draft.date),
      ...(existing.serverSeq !== undefined ? { serverSeq: existing.serverSeq } : {}),
      ...(existing.groupId ? { groupId: existing.groupId } : {}),
      ...(reason?.trim() ? { editReason: reason.trim() } : {}),
    };
    const next = await finalize(raw);
    assertGodownUnchanged(existing, next);
    await assertRefs(next);
    await d.vouchers.put(next);
    await applyVoucherDerived(dexieDerivedStore, next, existing);
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
  });
  emitLocalWrite();
  return v;
}

async function voidInTx(ctx: WriteCtx, godownId: string, id: string, reason: string) {
  const existing = await loadForChange(ctx, godownId, id, "voucher.void");
  const next = VoucherSchema.parse({
    ...existing,
    rev: existing.rev + 1,
    status: "void",
    voidReason: reason,
    updatedAt: ctx.nowIso,
    updatedBy: ctx.userId,
  });
  await db().vouchers.put(next);
  await applyVoucherDerived(dexieDerivedStore, next, existing);
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

/** Void a voucher (reverses its postings: a void voucher posts nothing). */
export async function voidVoucher(godownId: string, id: string, reason: string): Promise<Voucher> {
  if (!reason.trim()) throw new RepoError("NOTE_REQUIRED");
  const d = db();
  const v = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    return voidInTx(ctx, godownId, id, reason.trim());
  });
  emitLocalWrite();
  return v;
}

/** Void every active voucher of a group in this godown, together (all or nothing). */
export async function voidVoucherGroup(
  godownId: string,
  groupId: string,
  reason: string,
): Promise<Voucher[]> {
  if (!reason.trim()) throw new RepoError("NOTE_REQUIRED");
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const members = await d.vouchers
      .where("[godownId+groupId]")
      .equals([godownId, groupId])
      .filter((v) => v.status === "active")
      .toArray();
    const res: Voucher[] = [];
    for (const m of members) res.push(await voidInTx(ctx, godownId, m._id, reason.trim()));
    return res;
  });
  emitLocalWrite();
  return out;
}

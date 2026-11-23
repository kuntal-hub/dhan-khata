/**
 * The single local write path for vouchers (spec §12.2). Every public function runs ONE Dexie
 * transaction:
 *   validate (Zod) → recomputeVoucher → rules → same-godown refs → day lock / role →
 *   assign number → write voucher rev → replace ledgerLines + stockMoves (+ dependent re-posts)
 *   → update dailyAgg → append outbox op → auditLocal → commit.
 * If anything throws, nothing is written.
 *
 * Voucher groups: a primary voucher (LOAD, or PURCHASE / SALE) and its linked members
 * (paid-now PAYMENT; sale advance RECEIPT, vehicle-advance PAYMENT, loading EXPENSE; the load's
 * PURCHASE + SALE) share a `groupId`. Linked members are read-only: they change only through
 * their primary (`saveVoucherWithLinked`), and voiding the primary voids the whole group.
 */
import { v7 as uuidv7 } from "uuid";
import { recomputeVoucher, validateVoucherRules } from "@/domain/calc/recompute";
import { fyOf, seasonOf } from "@/domain/dates";
import { formatVoucherNumber } from "@/domain/numbering";
import { applyVoucherDerived } from "@/domain/posting/derive";
import { can, entryMayChange } from "@/domain/rbac";
import { VoucherSchema, type Voucher, type VoucherType } from "@/domain/schemas";
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
import { upsertReminderInTx, type ReminderInput } from "./reminders";

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

/** Void reason recorded on linked members removed by an edit of their primary (a code). */
export const LINKED_REMOVED = "LINKED_REMOVED";

export function newId(): string {
  return uuidv7();
}

const BOOKKEEPING = [
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
];

function withoutBookkeeping(draft: Record<string, unknown>): Record<string, unknown> {
  const out = { ...draft };
  for (const k of BOOKKEEPING) delete out[k];
  return out;
}

function guardGodownField(godownId: string, draft: object): void {
  const g = (draft as { godownId?: unknown }).godownId;
  if (g !== undefined && g !== godownId) throw new RepoError("GODOWN_IMMUTABLE");
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

/** Comparable content of a voucher (everything except bookkeeping and undefined values). */
function content(v: Voucher): string {
  const rest = withoutBookkeeping(v as unknown as Record<string, unknown>);
  return JSON.stringify(rest, (_k, val: unknown) => (val === undefined ? undefined : val));
}

export function sameVoucherContent(a: Voucher, b: Voucher): boolean {
  const norm = (v: Voucher) => JSON.parse(content(v)) as unknown;
  return JSON.stringify(sortKeys(norm(a))) === JSON.stringify(sortKeys(norm(b)));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

// ── Group roles ──────────────────────────────────────────────────────────────

const PRIORITY: Partial<Record<VoucherType, number>> = { LOAD: 3, PURCHASE: 2, SALE: 2 };

/** The primary voucher of a group (LOAD over PURCHASE/SALE over everything else). */
export function groupPrimary(members: readonly Voucher[]): Voucher | undefined {
  let best: Voucher | undefined;
  for (const m of members) {
    if (m.status !== "active") continue;
    if (!best || (PRIORITY[m.type] ?? 1) > (PRIORITY[best.type] ?? 1)) best = m;
  }
  return best;
}

async function groupMembers(godownId: string, groupId: string): Promise<Voucher[]> {
  return db()
    .vouchers.where("[godownId+groupId]")
    .equals([godownId, groupId])
    .filter((v) => v.status === "active")
    .toArray();
}

/** Is `v` a read-only linked member (it has a higher-priority primary in its group)? */
export async function isLinkedMember(v: Voucher): Promise<boolean> {
  if (!v.groupId) return false;
  const primary = groupPrimary(await groupMembers(v.godownId, v.groupId));
  return primary !== undefined && primary._id !== v._id;
}

// ── In-transaction primitives ────────────────────────────────────────────────

interface CreateOpts {
  id?: string;
  groupId?: string;
  /** Created as a linked member of a group (entry role may create these). */
  linked?: boolean;
  extra?: ReadonlyMap<string, string>;
}

async function createInTx(ctx: WriteCtx, draft: VoucherDraft, opts: CreateOpts): Promise<Voucher> {
  const d = db();
  const godownId = ctx.godown._id;
  guardGodownField(godownId, draft);
  if (
    !can(ctx.session.user, godownId, "voucher.create", {
      voucherType: draft.type,
      grouped: opts.linked === true,
    })
  ) {
    throw new RepoError("FORBIDDEN", draft.type);
  }
  await assertDayOpen(ctx, draft.date);
  const season = draft.season ?? seasonOf(draft.date, ctx.settings.seasonMap);
  const groupId = opts.groupId ?? draft.groupId;
  const raw: Record<string, unknown> = {
    ...withoutBookkeeping(draft as Record<string, unknown>),
    _id: opts.id ?? draft._id ?? uuidv7(),
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
  await assertRefs(v, opts.extra);
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
  return v;
}

async function loadForChange(
  ctx: WriteCtx,
  id: string,
  action: "voucher.edit" | "voucher.void",
  opts: { internal?: boolean } = {},
): Promise<Voucher> {
  const existing = await db().vouchers.get(id);
  if (!existing) throw new RepoError("NOT_FOUND", id);
  if (existing.godownId !== ctx.godown._id) throw new RepoError("GODOWN_IMMUTABLE");
  if (existing.status === "void") throw new RepoError("VOUCHER_VOID");
  if (!opts.internal && (await isLinkedMember(existing))) throw new RepoError("LINKED_READ_ONLY");
  if (!can(ctx.session.user, ctx.godown._id, action, { voucherType: existing.type })) {
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

/** Build revision n+1 from a draft (no writes). */
async function prepareEdit(
  ctx: WriteCtx,
  existing: Voucher,
  draft: VoucherDraft,
  reason?: string,
): Promise<Voucher> {
  guardGodownField(ctx.godown._id, draft);
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
  if (!draft.season && existing.season) raw.season = existing.season;
  const next = await finalize(raw);
  assertGodownUnchanged(existing, next);
  await assertRefs(next);
  return next;
}

async function writeEdit(ctx: WriteCtx, existing: Voucher, next: Voucher, reason?: string) {
  await db().vouchers.put(next);
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
}

/** Edit unless nothing changed. Returns the stored voucher. */
async function editInTx(
  ctx: WriteCtx,
  existing: Voucher,
  draft: VoucherDraft,
  reason?: string,
): Promise<Voucher> {
  const next = await prepareEdit(ctx, existing, draft, reason);
  if (sameVoucherContent(existing, next)) return existing;
  await writeEdit(ctx, existing, next, reason);
  return next;
}

async function voidOneInTx(ctx: WriteCtx, existing: Voucher, reason: string): Promise<Voucher> {
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
  await closeVoucherReminders(ctx, next._id);
  return next;
}

/** Settlements (MILL_SETTLEMENT) that point at a sale. */
async function settlementsOf(godownId: string, saleId: string): Promise<Voucher[]> {
  return db()
    .vouchers.where("[godownId+type+date]")
    .between([godownId, "MILL_SETTLEMENT", ""], [godownId, "MILL_SETTLEMENT", "￿"])
    .filter((v) => v.status === "active" && v.type === "MILL_SETTLEMENT" && v.saleId === saleId)
    .toArray();
}

/**
 * Void a voucher with everything that depends on it: a primary takes its group members; a sale
 * takes its mill settlements; a settlement puts its sale back to PENDING.
 */
async function voidCascadeInTx(ctx: WriteCtx, target: Voucher, reason: string): Promise<Voucher[]> {
  const out: Voucher[] = [];
  const members = target.groupId ? await groupMembers(ctx.godown._id, target.groupId) : [target];
  for (const m of members.length ? members : [target]) {
    if (m.type === "SALE") {
      for (const s of await settlementsOf(ctx.godown._id, m._id)) {
        out.push(await voidOneInTx(ctx, s, reason));
      }
    }
    const fresh = (await db().vouchers.get(m._id))!;
    if (fresh.status === "active") out.push(await voidOneInTx(ctx, fresh, reason));
  }
  if (target.type === "MILL_SETTLEMENT") {
    const sale = await db().vouchers.get(target.saleId);
    if (
      sale &&
      sale.status === "active" &&
      sale.type === "SALE" &&
      sale.settlementStatus === "SETTLED"
    ) {
      const rest = await settlementsOf(ctx.godown._id, sale._id);
      if (rest.length === 0) {
        await editInTx(ctx, sale, {
          ...(sale as VoucherDraft),
          settlementStatus: "PENDING",
        } as VoucherDraft);
      }
    }
  }
  return out;
}

async function closeVoucherReminders(ctx: WriteCtx, voucherId: string): Promise<void> {
  const rems = await db()
    .reminders.filter((r) => r.voucherId === voucherId)
    .toArray();
  for (const r of rems) {
    if (r.status === "done") continue;
    await upsertReminderInTx(ctx, {
      _id: r._id,
      kind: r.kind,
      ...(r.partyId ? { partyId: r.partyId } : {}),
      voucherId,
      dueDate: undefined,
      title: r.title,
    });
  }
}

/** A changed SALE keeps its mill settlement consistent (dispatched net + bill total). */
async function refreshSettlementsInTx(ctx: WriteCtx, sale: Voucher): Promise<void> {
  if (sale.type !== "SALE") return;
  let net = 0n;
  for (const l of sale.lines) net += BigInt(l.netG);
  for (const s of await settlementsOf(ctx.godown._id, sale._id)) {
    if (s.type !== "MILL_SETTLEMENT") continue;
    await editInTx(ctx, s, {
      ...(s as VoucherDraft),
      partyId: sale.partyId,
      dispatchedNetG: net.toString(),
      saleTotalPaise: sale.totalPaise,
    } as VoucherDraft);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Create one voucher. */
export async function createVoucher(godownId: string, draft: VoucherDraft): Promise<Voucher> {
  const [v] = await createVoucherGroup(godownId, [draft], { forceGroup: false });
  return v!;
}

/**
 * Create several linked vouchers in ONE transaction with a shared `groupId`.
 * The first draft is the primary; the rest are linked members.
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
      out.push(
        await createInTx(ctx, drafts[i]!, {
          id: ids[i]!,
          ...(groupId ? { groupId } : {}),
          linked: i > 0,
          extra,
        }),
      );
    }
    return out;
  });
  emitLocalWrite();
  return created;
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
    const existing = await loadForChange(ctx, id, "voucher.edit");
    const next = await prepareEdit(ctx, existing, draft, reason);
    await writeEdit(ctx, existing, next, reason);
    await refreshSettlementsInTx(ctx, next);
    return next;
  });
  emitLocalWrite();
  return v;
}

/** Void a voucher (and its group / dependent settlements). Returns the primary voided voucher. */
export async function voidVoucher(godownId: string, id: string, reason: string): Promise<Voucher> {
  if (!reason.trim()) throw new RepoError("NOTE_REQUIRED");
  const d = db();
  const v = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const existing = await loadForChange(ctx, id, "voucher.void");
    await voidCascadeInTx(ctx, existing, reason.trim());
    return (await d.vouchers.get(id))!;
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
    const members = await groupMembers(godownId, groupId);
    const primary = groupPrimary(members);
    if (!primary) return [];
    const checked = await loadForChange(ctx, primary._id, "voucher.void");
    return voidCascadeInTx(ctx, checked, reason.trim());
  });
  emitLocalWrite();
  return out;
}

export interface LinkedPlan {
  primary: VoucherDraft;
  /** Linked members built from the finalized primary (same group). */
  linked?: (primary: Voucher, ctx: WriteCtx) => Array<VoucherDraft | null>;
  /** Reminders to create/update/close with this save. */
  reminders?: (primary: Voucher) => ReminderInput[];
  /** Extra writes in the same transaction (e.g. last-used suggestions). */
  after?: (primary: Voucher, ctx: WriteCtx) => Promise<void>;
}

export interface SavedGroup {
  primary: Voucher;
  linked: Voucher[];
}

/**
 * Create or edit a primary voucher together with its linked members, in ONE transaction.
 * Linked members are matched by type: changed ones get a new revision, new ones are created,
 * and members no longer needed are voided (reason `LINKED_REMOVED`).
 */
export async function saveVoucherWithLinked(
  godownId: string,
  plan: LinkedPlan,
  opts: { id?: string; reason?: string } = {},
): Promise<SavedGroup> {
  const d = db();
  const saved = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const existing = opts.id ? await loadForChange(ctx, opts.id, "voucher.edit") : undefined;
    const groupId = existing?.groupId ?? plan.primary.groupId ?? uuidv7();
    const primaryDraft = { ...plan.primary, groupId } as VoucherDraft;
    const primary = existing
      ? await editInTx(ctx, existing, primaryDraft, opts.reason)
      : await createInTx(ctx, primaryDraft, { groupId });

    const drafts = (plan.linked?.(primary, ctx) ?? []).filter((x): x is VoucherDraft => x !== null);
    const members = existing
      ? (await groupMembers(godownId, groupId)).filter((m) => m._id !== primary._id)
      : [];
    const used = new Set<string>();
    const linked: Voucher[] = [];
    for (const ld of drafts) {
      const draft = { ...ld, groupId } as VoucherDraft;
      const match = members.find((m) => m.type === draft.type && !used.has(m._id));
      if (match) {
        used.add(match._id);
        const checked = await loadForChange(ctx, match._id, "voucher.edit", { internal: true });
        const v = await editInTx(ctx, checked, draft, opts.reason);
        linked.push(v);
        await refreshSettlementsInTx(ctx, v);
      } else {
        linked.push(await createInTx(ctx, draft, { groupId, linked: true }));
      }
    }
    for (const m of members) {
      if (used.has(m._id)) continue;
      const checked = await loadForChange(ctx, m._id, "voucher.edit", { internal: true });
      if (checked.type === "SALE") {
        for (const s of await settlementsOf(godownId, checked._id))
          await voidOneInTx(ctx, s, LINKED_REMOVED);
      }
      await voidOneInTx(ctx, checked, LINKED_REMOVED);
    }
    await refreshSettlementsInTx(ctx, primary);
    for (const r of plan.reminders?.(primary) ?? []) await upsertReminderInTx(ctx, r);
    await plan.after?.(primary, ctx);
    return { primary, linked };
  });
  emitLocalWrite();
  return saved;
}

/**
 * Mill settlement for a sale (spec §9.3): one active settlement per sale. Saving it marks the
 * sale SETTLED (a new sale revision, even when the sale is a load's linked member).
 */
export async function saveMillSettlement(
  godownId: string,
  saleId: string,
  draft: VoucherDraft,
  opts: { reason?: string } = {},
): Promise<Voucher> {
  if (draft.type !== "MILL_SETTLEMENT") throw new RepoError("TYPE_IMMUTABLE");
  const d = db();
  const v = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const sale = await d.vouchers.get(saleId);
    if (!sale || sale.godownId !== godownId || sale.type !== "SALE")
      throw new RepoError("NOT_FOUND", saleId);
    if (sale.status === "void") throw new RepoError("VOUCHER_VOID");
    let net = 0n;
    for (const l of sale.lines) net += BigInt(l.netG);
    const full = {
      ...draft,
      saleId,
      partyId: sale.partyId,
      dispatchedNetG: net.toString(),
      saleTotalPaise: sale.totalPaise,
    } as VoucherDraft;
    const [current] = await settlementsOf(godownId, saleId);
    let saved: Voucher;
    if (current) {
      const checked = await loadForChange(ctx, current._id, "voucher.edit");
      saved = await editInTx(ctx, checked, full, opts.reason);
    } else {
      saved = await createInTx(ctx, full, {});
    }
    if (sale.settlementStatus !== "SETTLED") {
      const checked = await loadForChange(ctx, sale._id, "voucher.edit", { internal: true });
      await editInTx(ctx, checked, {
        ...(checked as VoucherDraft),
        settlementStatus: "SETTLED",
      } as VoucherDraft);
    }
    return saved;
  });
  emitLocalWrite();
  return v;
}

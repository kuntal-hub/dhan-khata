/**
 * Apply one pushed outbox op (spec §12.3), in ONE Mongo transaction:
 *  1. idempotency (appliedOps) → `duplicate` with the stored result
 *  2. authZ per godown/role, archived godown, DAY_LOCKED (late-entry flag), GODOWN_IMMUTABLE,
 *     CROSS_GODOWN_REFERENCE
 *  3. Zod; recompute → CALC_MISMATCH on the voucher's own derived fields; business rules
 *  4. baseRev concurrency (§12.5): vouchers never auto-merge (conflict item; void beats edit);
 *     masters merge field by field, overlapping fields keep the server value (loser → conflicts)
 *  5. write doc + ledgerLines/stockMoves (recomputed HERE from the server's own stock position,
 *     dependent vouchers re-posted) + changelog/serverSeq + appliedOps + audit.
 * Rejections write nothing and are NOT recorded as applied (a retry re-evaluates them).
 */
import type { ClientSession, Collection, Db } from "mongodb";
import { recomputeVoucher, validateVoucherRules, verifyVoucher } from "@/domain/calc/recompute";
import { todayIST } from "@/domain/dates";
import type { DomainErrorCode } from "@/domain/errors";
import { applyVoucherDerived } from "@/domain/posting/derive";
import { can, entryMayChange, isDayLocked, roleIn, type EffectiveRole } from "@/domain/rbac";
import {
  PUSH_SCHEMAS,
  defaultGodownSettings,
  isMasterEntity,
  type GodownSettings,
  type PushOp,
  type PushOpResult,
  type Voucher,
} from "@/domain/schemas";
import {
  checkRefs,
  checkSameGodown,
  collectMasterRefs,
  collectRefs,
  type GodownLookup,
  type Ref,
} from "@/domain/scope";
import { audit, logChanges, type ChangeEntry } from "../changelog";
import { publicDoc } from "../convert";
import { cols, getMongoClient, type ServerMeta, type UserDoc } from "../db";
import { log } from "../http";
import { mongoDerivedStore, readVoucherDerived } from "./mongoStore";

export interface ApplyContext {
  db: Db;
  user: UserDoc;
  deviceId: string;
  /** Injectable "today" for tests (IST business date). */
  today?: string;
}

class Reject extends Error {
  constructor(
    public readonly code: DomainErrorCode | string,
    public readonly detail?: string,
  ) {
    super(code);
  }
}

class Conflict extends Error {
  constructor(public readonly result: PushOpResult) {
    super("conflict");
  }
}

type AnyDoc = Record<string, unknown> & { _id: string; godownId: string; rev: number };

function collectionFor(db: Db, entity: PushOp["entity"]): Collection<AnyDoc> {
  const k = cols(db);
  const map = {
    voucher: k.vouchers,
    party: k.parties,
    variety: k.varieties,
    bankAccount: k.bankAccounts,
    vehicle: k.vehicles,
    place: k.places,
    expenseCategory: k.expenseCategories,
    godownSettings: k.godownSettings,
    reminder: k.reminders,
  } as const;
  return map[entity] as unknown as Collection<AnyDoc>;
}

async function buildServerLookup(
  db: Db,
  godownId: string,
  refs: readonly Ref[],
  session: ClientSession,
): Promise<GodownLookup> {
  const k = cols(db);
  const found = new Map<string, string>();
  const key = (r: Ref) => `${r.kind}:${r.id}`;
  const byKind = new Map<Ref["kind"], string[]>();
  for (const r of refs) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.id]);
  for (const [kind, ids] of byKind) {
    if (kind === "expenseCategory") {
      const docs = await k.expenseCategories
        .find({ godownId, code: { $in: ids } }, { projection: { code: 1, godownId: 1 }, session })
        .toArray();
      for (const d of docs) found.set(`expenseCategory:${d.code}`, d.godownId);
      continue;
    }
    const coll: Collection<AnyDoc> = (
      {
        party: k.parties,
        bankAccount: k.bankAccounts,
        vehicle: k.vehicles,
        variety: k.varieties,
        place: k.places,
        voucher: k.vouchers,
      } as unknown as Record<string, Collection<AnyDoc>>
    )[kind]!;
    const docs = await coll
      .find({ _id: { $in: ids } }, { projection: { godownId: 1 }, session })
      .toArray();
    for (const d of docs) found.set(`${kind}:${d._id}`, d.godownId);
  }
  return (r) => found.get(key(r));
}

function rejected(op: PushOp, code: string, detail?: string): PushOpResult {
  return { opId: op.opId, result: "rejected", reason: code, ...(detail ? { detail } : {}) };
}

/** Apply a single op. Never throws for business rejections; throws on infrastructure errors. */
export async function applyOp(ctx: ApplyContext, op: PushOp): Promise<PushOpResult> {
  const k = cols(ctx.db);
  const prior = await k.appliedOps.findOne({ _id: op.opId });
  if (prior) return { ...prior.result, opId: op.opId, result: "duplicate" };

  const client = await getMongoClient();
  try {
    return await client.withSession((session) =>
      session.withTransaction(() => applyInTx(ctx, op, session)),
    );
  } catch (e) {
    if (e instanceof Reject) return rejected(op, e.code, e.detail);
    if (e instanceof Conflict) return e.result;
    throw e;
  }
}

async function applyInTx(
  ctx: ApplyContext,
  op: PushOp,
  session: ClientSession,
): Promise<PushOpResult> {
  const { db, user } = ctx;
  const k = cols(db);
  const prior = await k.appliedOps.findOne({ _id: op.opId }, { session });
  if (prior) return { ...prior.result, opId: op.opId, result: "duplicate" };

  const payload = (op.payload ?? {}) as Record<string, unknown>;
  if (payload._id !== op.entityId) throw new Reject("ID_MISMATCH");
  if (payload.godownId !== op.godownId) throw new Reject("GODOWN_MISMATCH");

  const godown = await k.godowns.findOne({ _id: op.godownId }, { session });
  if (!godown) throw new Reject("GODOWN_NOT_FOUND");
  const role = roleIn(user, op.godownId);
  if (!role) throw new Reject("FORBIDDEN");
  if (godown.status === "archived") throw new Reject("GODOWN_ARCHIVED");

  const coll = collectionFor(db, op.entity);
  const current = await coll.findOne({ _id: op.entityId }, { session });
  if (current && current.godownId !== op.godownId) throw new Reject("GODOWN_IMMUTABLE");

  const schema = PUSH_SCHEMAS[op.entity];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Reject("VALIDATION_FAILED", issue ? issue.path.join(".") : undefined);
  }

  if (op.entity === "voucher") {
    return applyVoucher(ctx, op, session, role, parsed.data as Voucher, current as Voucher | null);
  }
  return applyMaster(ctx, op, session, role, parsed.data as AnyDoc, current);
}

async function settingsOf(
  db: Db,
  godownId: string,
  session: ClientSession,
): Promise<GodownSettings> {
  return (
    (await cols(db).godownSettings.findOne({ _id: godownId }, { session })) ??
    defaultGodownSettings(godownId, new Date().toISOString())
  );
}

async function applyVoucher(
  ctx: ApplyContext,
  op: PushOp,
  session: ClientSession,
  role: EffectiveRole,
  incoming: Voucher,
  current: Voucher | null,
): Promise<PushOpResult> {
  const { db, user } = ctx;
  const k = cols(db);
  const g = op.godownId;
  const isVoid = op.op === "void";
  if (isVoid !== (incoming.status === "void")) throw new Reject("VALIDATION_FAILED", "status");

  // ── AuthZ ──
  if (!current) {
    if (op.baseRev !== 0) throw new Reject("NOT_FOUND");
    if (
      !can(user, g, "voucher.create", { voucherType: incoming.type, grouped: !!incoming.groupId })
    ) {
      throw new Reject("FORBIDDEN", incoming.type);
    }
  } else {
    if (current.type !== incoming.type) throw new Reject("TYPE_IMMUTABLE");
    if (!can(user, g, isVoid ? "voucher.void" : "voucher.edit", { voucherType: current.type })) {
      throw new Reject("FORBIDDEN", current.type);
    }
    if (
      role === "entry" &&
      !entryMayChange(current, user._id, incoming.updatedAt, { requireUnsynced: false })
    ) {
      throw new Reject("EDIT_WINDOW_EXPIRED");
    }
  }

  // ── Day lock (owner may write any day) ──
  let lateEntryDay: string | null = null;
  if (role !== "owner") {
    const settings = await settingsOf(db, g, session);
    const today = ctx.today ?? todayIST();
    for (const date of new Set([incoming.date, ...(current ? [current.date] : [])])) {
      const ds = await k.dayStatus.findOne({ _id: `${g}:${date}` }, { session });
      const lockArgs = { date, today, lockAfterDays: settings.lockAfterDays };
      if (!isDayLocked({ ...lockArgs, dayClosed: ds?.closed ?? false })) continue;
      // An offline-created voucher written BEFORE the day was closed is accepted and flagged.
      const late =
        !current &&
        ds?.closed === true &&
        ds.closedAt !== undefined &&
        incoming.createdAt < ds.closedAt &&
        !isDayLocked({ ...lockArgs, dayClosed: false });
      if (!late) throw new Reject("DAY_LOCKED", date);
      lateEntryDay = date;
    }
  }

  // ── Same-godown references ──
  const lookup = await buildServerLookup(db, g, collectRefs(incoming), session);
  const scope = checkSameGodown(incoming, lookup);
  if (!scope.ok) throw new Reject(scope.code, `${scope.ref.kind}:${scope.ref.id}`);

  // ── Recompute: the voucher's own derived fields must match exactly ──
  if (!isVoid) {
    const diffs = verifyVoucher(incoming);
    if (diffs.length > 0) {
      log({ level: "error", event: "CALC_MISMATCH", opId: op.opId, deviceId: ctx.deviceId, diffs });
      throw new Reject("CALC_MISMATCH", diffs.join(","));
    }
    const rules = validateVoucherRules(incoming);
    if (rules.length > 0) throw new Reject(rules[0]!);
  }

  // ── Concurrency ──
  let next: Voucher;
  if (!current) {
    if (incoming.rev !== 1) throw new Reject("VALIDATION_FAILED", "rev");
    next = incoming;
  } else if (current.status === "void") {
    if (isVoid) {
      // Already void (another device voided it too): nothing to change.
      return appliedNoop(ctx, op, session, current);
    }
    throw await conflictOf(db, op, current, session, "VOIDED");
  } else if (op.baseRev !== current.rev) {
    if (!isVoid) throw await conflictOf(db, op, current, session, "REV_CONFLICT");
    // Void beats edit: void the server's current version.
    next = {
      ...current,
      rev: current.rev + 1,
      status: "void",
      voidReason: incoming.voidReason,
      updatedAt: incoming.updatedAt,
      updatedBy: incoming.updatedBy,
    } as Voucher;
  } else {
    if (incoming.rev !== current.rev + 1) throw new Reject("VALIDATION_FAILED", "rev");
    if (incoming.number !== current.number || incoming.createdAt !== current.createdAt) {
      throw new Reject("VALIDATION_FAILED", "immutable");
    }
    next = incoming;
  }
  if (!isVoid) next = recomputeVoucher(next);

  // ── Write ──
  const { serverSeq: _drop, ...clean } = next as Voucher & { serverSeq?: number };
  const store = mongoDerivedStore(db, session);
  await k.vouchers.replaceOne({ _id: next._id }, clean as Voucher, { upsert: true, session });
  const res = await applyVoucherDerived(store, clean as Voucher, current ?? undefined);

  const entries: ChangeEntry[] = [
    { godownId: g, entity: "voucher", entityId: next._id, rev: next.rev },
  ];
  for (const id of res.reposted) {
    const w = await k.vouchers.findOne({ _id: id }, { session });
    if (w) entries.push({ godownId: g, entity: "voucher", entityId: id, rev: w.rev });
  }
  if (lateEntryDay) {
    entries.push({ godownId: g, entity: "dayStatus", entityId: `${g}:${lateEntryDay}`, rev: 1 });
  }
  const seqs = await logChanges(db, session, entries);
  const serverSeq = seqs[0]!;
  await k.vouchers.updateOne({ _id: next._id }, { $set: { serverSeq } }, { session });
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.entity === "voucher") {
      await k.vouchers.updateOne(
        { _id: e.entityId },
        { $set: { serverSeq: seqs[i]! } },
        { session },
      );
    }
  }
  if (lateEntryDay) {
    await k.dayStatus.updateOne(
      { _id: `${g}:${lateEntryDay}` },
      { $set: { lateEntry: true } },
      { session },
    );
  }
  const result: PushOpResult = { opId: op.opId, result: "applied", serverSeq, rev: next.rev };
  await k.appliedOps.insertOne(
    { _id: op.opId, deviceId: ctx.deviceId, userId: user._id, appliedAt: new Date(), result },
    { session },
  );
  await audit(db, session, {
    userId: user._id,
    deviceId: ctx.deviceId,
    godownId: g,
    entity: "voucher",
    entityId: next._id,
    action: !current ? "create" : next.status === "void" ? "void" : "edit",
    opId: op.opId,
    rev: next.rev,
  });
  return {
    ...result,
    doc: { ...clean, serverSeq },
    lines: res.derived.lines,
    moves: res.derived.moves,
  };
}

async function conflictOf(
  db: Db,
  op: PushOp,
  current: Voucher,
  session: ClientSession,
  reason: string,
): Promise<Conflict> {
  const derived = (await readVoucherDerived(db, [current._id], session)).get(current._id)!;
  return new Conflict({
    opId: op.opId,
    result: "conflict",
    reason,
    rev: current.rev,
    ...(current.serverSeq !== undefined ? { serverSeq: current.serverSeq } : {}),
    doc: current,
    lines: derived.lines,
    moves: derived.moves,
  });
}

async function appliedNoop(
  ctx: ApplyContext,
  op: PushOp,
  session: ClientSession,
  current: Voucher,
): Promise<PushOpResult> {
  const result: PushOpResult = {
    opId: op.opId,
    result: "applied",
    rev: current.rev,
    ...(current.serverSeq !== undefined ? { serverSeq: current.serverSeq } : {}),
  };
  await cols(ctx.db).appliedOps.insertOne(
    { _id: op.opId, deviceId: ctx.deviceId, userId: ctx.user._id, appliedAt: new Date(), result },
    { session },
  );
  return { ...result, doc: current, lines: [], moves: [] };
}

const MASTER_BOOKKEEPING = new Set([
  "_id",
  "godownId",
  "rev",
  "createdAt",
  "createdBy",
  "deviceId",
  "updatedAt",
  "updatedBy",
  "serverSeq",
  "_m",
]);

function diffFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((f) => !MASTER_BOOKKEEPING.has(f))
    .filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
}

async function applyMaster(
  ctx: ApplyContext,
  op: PushOp,
  session: ClientSession,
  role: EffectiveRole,
  incoming: AnyDoc,
  current: AnyDoc | null,
): Promise<PushOpResult> {
  const { db, user } = ctx;
  const k = cols(db);
  const g = op.godownId;
  const entity = op.entity;
  if (op.op !== "upsert") throw new Reject("VALIDATION_FAILED", "op");

  // ── AuthZ ──
  if (entity === "godownSettings") {
    if (!can(user, g, "settings.write")) throw new Reject("FORBIDDEN", entity);
  } else if (!current) {
    if (!can(user, g, "master.create")) throw new Reject("FORBIDDEN", entity);
  } else {
    const mayEdit =
      can(user, g, "master.edit") ||
      (role === "entry" &&
        entryMayChange(
          current as unknown as { createdBy: string; createdAt: string },
          user._id,
          String(incoming.updatedAt),
          { requireUnsynced: false },
        ));
    if (!mayEdit) throw new Reject("FORBIDDEN", entity);
  }

  // ── References ──
  if (isMasterEntity(entity)) {
    const refs = collectMasterRefs(entity, incoming);
    const scope = checkRefs(g, refs, await buildServerLookup(db, g, refs, session));
    if (!scope.ok) throw new Reject(scope.code, `${scope.ref.kind}:${scope.ref.id}`);
  }
  if (entity === "expenseCategory") {
    if (current && current.code !== incoming.code) throw new Reject("VALIDATION_FAILED", "code");
    const clash = await k.expenseCategories.findOne(
      { godownId: g, code: incoming.code as string, _id: { $ne: incoming._id } },
      { session },
    );
    if (clash) throw new Reject("VALIDATION_FAILED", "code");
  }

  // ── Merge (field-level LWW; overlapping fields keep the server value) ──
  let next: AnyDoc;
  let conflictFields: string[] = [];
  const meta: ServerMeta = {
    fieldRev: { ...((current?._m as ServerMeta | undefined)?.fieldRev ?? {}) },
  };
  if (!current) {
    if (op.baseRev !== 0) throw new Reject("NOT_FOUND");
    next = { ...incoming, rev: 1 };
  } else {
    const cur = publicDoc(current) as AnyDoc;
    const rev = current.rev + 1;
    const fields = op.fields ?? diffFields(cur, incoming);
    const mine = op.baseRev === current.rev ? fields : [];
    if (op.baseRev !== current.rev) {
      for (const f of fields) {
        const serverChanged = (meta.fieldRev?.[f] ?? 1) > op.baseRev;
        if (serverChanged && JSON.stringify(cur[f]) !== JSON.stringify(incoming[f])) {
          conflictFields.push(f);
        } else mine.push(f);
      }
    }
    next = { ...cur, rev, updatedAt: incoming.updatedAt, updatedBy: incoming.updatedBy };
    for (const f of mine) {
      if (incoming[f] === undefined) delete next[f];
      else next[f] = incoming[f];
      meta.fieldRev![f] = rev;
    }
    const check = PUSH_SCHEMAS[entity].safeParse(next);
    if (!check.success) {
      // A merge that would be invalid: keep the server version whole, mine goes to conflicts.
      conflictFields = fields;
      next = { ...cur, rev, updatedAt: incoming.updatedAt, updatedBy: incoming.updatedBy };
    }
    if (conflictFields.length > 0) {
      await k.conflicts.insertMany(
        conflictFields.map((f) => ({
          _id: `${op.opId}:${f}`,
          at: new Date(),
          godownId: g,
          entity,
          entityId: incoming._id,
          field: f,
          mine: incoming[f],
          server: cur[f],
          opId: op.opId,
          userId: user._id,
          deviceId: ctx.deviceId,
          resolved: false,
        })),
        { session },
      );
    }
  }

  const { serverSeq: _drop, ...clean } = next;
  const [serverSeq] = await logChanges(db, session, [
    { godownId: g, entity, entityId: next._id, rev: next.rev },
  ]);
  const stored = { ...clean, serverSeq: serverSeq!, _m: meta } as AnyDoc;
  await collectionFor(db, entity).replaceOne({ _id: next._id }, stored, { upsert: true, session });
  const result: PushOpResult = {
    opId: op.opId,
    result: "applied",
    serverSeq: serverSeq!,
    rev: next.rev,
  };
  await k.appliedOps.insertOne(
    { _id: op.opId, deviceId: ctx.deviceId, userId: user._id, appliedAt: new Date(), result },
    { session },
  );
  await audit(db, session, {
    userId: user._id,
    deviceId: ctx.deviceId,
    godownId: g,
    entity,
    entityId: next._id,
    action: current ? "edit" : "create",
    opId: op.opId,
    rev: next.rev,
  });
  return {
    ...result,
    doc: publicDoc(stored),
    ...(conflictFields.length ? { conflictFields } : {}),
  };
}

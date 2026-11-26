/**
 * Apply pushed outbox ops (requirement_v2 §17, §2.4). An op GROUP (ops written in one local
 * transaction, e.g. a purchase and its initial payment) is applied in ONE Mongo transaction:
 * all ops or none, so the cashbook can never show half a transaction.
 *
 * Per op:
 *  1. idempotency (appliedOps) → `duplicate` with the stored result
 *  2. authZ: session user owns the business (`businessId`) and may write the Gola; archived Gola;
 *     GODOWN_IMMUTABLE; same-Gola references (CROSS_GODOWN_REFERENCE)
 *  3. Zod; recompute → CALC_MISMATCH on the document's own derived fields; business rules;
 *     cross-document links (payment source, dispatch, consignment, load); dependents on void
 *  4. baseRev concurrency: documents never auto-merge (conflict item; void beats edit);
 *     masters merge field by field (overlapping fields keep the server value → conflicts)
 *  5. write doc + ledgerLines/stockMoves (recomputed HERE from the server's own stock position,
 *     dependent documents re-posted) + changelog/serverSeq + appliedOps + audit.
 * Rejections write nothing and are NOT recorded as applied (a retry re-evaluates them).
 */
import type { ClientSession, Collection, Db } from "mongodb";
import { todayIST } from "@/domain/dates";
import { DomainError, type DomainErrorCode } from "@/domain/errors";
import { can, entryMayChange, isDayLocked, roleIn, type EffectiveRole } from "@/domain/rbac";
import {
  PUSH_SCHEMAS,
  defaultGodownSettings,
  isMasterEntity,
  type DayStatus,
  type Doc,
  type GodownSettings,
  type PushOp,
  type PushOpResult,
} from "@/domain/schemas";
import {
  checkRefs,
  checkSameGodown,
  collectMasterRefs,
  collectRefs,
  type GodownLookup,
  type Ref,
} from "@/domain/scope";
import { cashEffects } from "@/domain/v2/cashbook";
import { applyDocDerived } from "@/domain/v2/derive";
import {
  DUE_DATE_FIELD_TYPES,
  checkDueDate,
  dealDateOf,
  dueDateOf,
  isDueDateType,
} from "@/domain/v2/dueDate";
import { linkedDocIds, settlementGuard, validateLinks } from "@/domain/v2/links";
import { recomputeDoc, validateDocRules, verifyDoc } from "@/domain/v2/recompute";
import { audit, logChanges, type ChangeEntry } from "../changelog";
import { publicDoc } from "../convert";
import { cols, getMongoClient, type ServerMeta, type UserDoc } from "../db";
import { log } from "../http";
import { mongoDerivedStore, readDocDerived } from "./mongoStore";

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

/** Apply a single op (a group of one). */
export async function applyOp(ctx: ApplyContext, op: PushOp): Promise<PushOpResult> {
  const [r] = await applyGroup(ctx, [op]);
  return r!;
}

/**
 * Apply ops that belong together in ONE transaction. If any op is rejected or conflicts, the
 * transaction is aborted: that op gets its result and every other op `GROUP_FAILED`.
 * Never throws for business rejections; throws on infrastructure errors.
 */
export async function applyGroup(
  ctx: ApplyContext,
  ops: readonly PushOp[],
): Promise<PushOpResult[]> {
  const k = cols(ctx.db);
  const priors = await k.appliedOps.find({ _id: { $in: ops.map((o) => o.opId) } }).toArray();
  if (priors.length === ops.length) {
    const byId = new Map(priors.map((p) => [p._id, p] as const));
    return ops.map((op) => ({ ...byId.get(op.opId)!.result, opId: op.opId, result: "duplicate" }));
  }
  const client = await getMongoClient();
  let failedAt = -1;
  let failure: PushOpResult | null = null;
  try {
    return await client.withSession((session) =>
      session.withTransaction(async () => {
        const out: PushOpResult[] = [];
        for (let i = 0; i < ops.length; i++) {
          try {
            out.push(await applyInTx(ctx, ops[i]!, session));
          } catch (e) {
            failedAt = i;
            if (e instanceof Reject) failure = rejected(ops[i]!, e.code, e.detail);
            else if (e instanceof Conflict) failure = e.result;
            throw e;
          }
        }
        return out;
      }),
    );
  } catch (e) {
    if (failure && (e instanceof Reject || e instanceof Conflict)) {
      const f: PushOpResult = failure;
      return ops.map((op, i) =>
        i === failedAt ? f : { opId: op.opId, result: "rejected", reason: "GROUP_FAILED" },
      );
    }
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
  // Owner separation (§2.4): the Gola and the record must belong to the user's business.
  if (godown.businessId !== user.businessId) throw new Reject("FORBIDDEN", "business");
  if ("businessId" in payload && payload.businessId !== user.businessId) {
    throw new Reject("FORBIDDEN", "businessId");
  }
  const role = roleIn(user, op.godownId);
  if (!role) throw new Reject("FORBIDDEN");
  if (godown.status === "archived") throw new Reject("GODOWN_ARCHIVED");

  const coll = collectionFor(db, op.entity);
  const current = await coll.findOne({ _id: op.entityId }, { session });
  if (current && current.godownId !== op.godownId) throw new Reject("GODOWN_IMMUTABLE");
  if (current && "businessId" in current && current.businessId !== user.businessId) {
    throw new Reject("FORBIDDEN", "business");
  }

  const schema = PUSH_SCHEMAS[op.entity];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Reject("VALIDATION_FAILED", issue ? issue.path.join(".") : undefined);
  }

  if (op.entity === "voucher") {
    return applyDoc(ctx, op, session, role, parsed.data as Doc, current as Doc | null);
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

function asReject(e: unknown): never {
  if (e instanceof DomainError) throw new Reject(e.code, e.detail);
  throw e;
}

async function applyDoc(
  ctx: ApplyContext,
  op: PushOp,
  session: ClientSession,
  role: EffectiveRole,
  incoming: Doc,
  current: Doc | null,
): Promise<PushOpResult> {
  const { db, user } = ctx;
  const k = cols(db);
  const g = op.godownId;
  const isVoid = op.op === "void";
  const today = ctx.today ?? todayIST();
  if (op.op === "dueDate") return applyDueDate(ctx, op, session, role, incoming, current, today);
  if (isVoid !== (incoming.status === "void")) throw new Reject("VALIDATION_FAILED", "status");

  // ── AuthZ ──
  if (!current) {
    if (op.baseRev !== 0) throw new Reject("NOT_FOUND");
    if (!can(user, g, "voucher.create", { voucherType: incoming.type, grouped: !!op.opGroup })) {
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

  // ── Day lock (internal roles only; the owner may write any day) ──
  if (role !== "owner") {
    const settings = await settingsOf(db, g, session);
    const dates = new Set([
      businessDateOf(incoming),
      ...(current ? [businessDateOf(current)] : []),
    ]);
    for (const date of dates) {
      const ds = await k.dayStatus.findOne({ _id: `${g}:${date}` }, { session });
      if (
        isDayLocked({
          date,
          today,
          lockAfterDays: settings.lockAfterDays,
          dayClosed: ds?.closed ?? false,
        })
      ) {
        throw new Reject("DAY_LOCKED", date);
      }
    }
  }

  // ── Same-Gola references ──
  const lookup = await buildServerLookup(db, g, collectRefs(incoming), session);
  const scope = checkSameGodown(incoming, lookup);
  if (!scope.ok) throw new Reject(scope.code, `${scope.ref.kind}:${scope.ref.id}`);

  // ── Recompute: the document's own derived fields must match exactly; rules; links ──
  if (!isVoid) {
    const diffs = verifyDoc(incoming);
    if (diffs.length > 0) {
      log({ level: "error", event: "CALC_MISMATCH", opId: op.opId, deviceId: ctx.deviceId, diffs });
      throw new Reject("CALC_MISMATCH", diffs.join(","));
    }
    try {
      validateDocRules(incoming, today);
    } catch (e) {
      asReject(e);
    }
    const linked = new Map<string, Doc>();
    for (const id of linkedDocIds(incoming)) {
      const x = await k.vouchers.findOne({ _id: id, godownId: g }, { session });
      if (x) linked.set(id, x);
    }
    try {
      validateLinks(incoming, (id) => linked.get(id));
    } catch (e) {
      asReject(e);
    }
    await checkLoadLinkUnique(db, session, incoming);
    // v2.1: one final settlement per dispatch; a settled dispatch is closed.
    const guard = settlementGuard(incoming, current ?? undefined);
    if (guard) {
      const other = await k.vouchers.findOne(
        {
          godownId: g,
          type: "MILL_SETTLEMENT",
          status: "active",
          dispatchId: guard.dispatchId,
          ...(guard.exceptId ? { _id: { $ne: guard.exceptId } } : {}),
        },
        { session, projection: { _id: 1 } },
      );
      if (other) throw new Reject("ALREADY_LINKED", `settlement:${guard.dispatchId}`);
    }
    if (
      current &&
      "partyId" in current &&
      "partyId" in incoming &&
      current.partyId !== incoming.partyId
    ) {
      if (await hasActivePayments(db, session, current._id)) throw new Reject("LINKED_PAYMENTS");
    }
  } else if (current) {
    if (await hasActivePayments(db, session, current._id)) throw new Reject("LINKED_PAYMENTS");
    if (await hasDependents(db, session, current)) throw new Reject("ALREADY_LINKED");
  }

  // ── One day close per Gola and day ──
  if (!current && !isVoid && incoming.type === "DAY_CLOSE") {
    const other = await k.vouchers.findOne(
      { godownId: g, type: "DAY_CLOSE", date: incoming.date, status: "active" },
      { session },
    );
    if (other) throw new Reject("DAY_ALREADY_CLOSED", incoming.date);
  }

  // ── Concurrency ──
  let next: Doc;
  if (!current) {
    if (incoming.rev !== 1) throw new Reject("VALIDATION_FAILED", "rev");
    next = incoming;
  } else if (current.status === "void") {
    if (isVoid) return appliedNoop(ctx, op, session, current);
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
    } as Doc;
  } else {
    if (incoming.rev !== current.rev + 1) throw new Reject("VALIDATION_FAILED", "rev");
    if (
      incoming.number !== current.number ||
      incoming.createdAt !== current.createdAt ||
      incoming.entryDate !== current.entryDate
    ) {
      throw new Reject("VALIDATION_FAILED", "immutable");
    }
    next = keepDueDate(incoming, current);
  }
  if (!isVoid) next = recomputeDoc(next);

  // ── Write ──
  const { serverSeq: _drop, ...clean } = next as Doc & { serverSeq?: number };
  const store = mongoDerivedStore(db, session);
  await k.vouchers.replaceOne({ _id: next._id }, clean as Doc, { upsert: true, session });
  const res = await applyDocDerived(store, clean as Doc, current ?? undefined);

  const entries: ChangeEntry[] = [
    { godownId: g, entity: "voucher", entityId: next._id, rev: next.rev },
  ];
  for (const id of res.reposted) {
    const w = await k.vouchers.findOne({ _id: id }, { session });
    if (w) entries.push({ godownId: g, entity: "voucher", entityId: id, rev: w.rev });
  }
  const dayIds = new Set<string>();
  if (next.type === "DAY_CLOSE") dayIds.add(await publishDayStatus(ctx, session, clean as Doc));
  for (const id of await flagRecheck(db, session, g, cashDatesOf(current, next))) dayIds.add(id);
  for (const id of dayIds) entries.push({ godownId: g, entity: "dayStatus", entityId: id, rev: 1 });

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

/**
 * A full edit never changes the due date (D54): it has its own op, so a device that has not yet
 * pulled a newer due date can't put the old one back. Legacy due dates on other types stay too.
 */
function keepDueDate(incoming: Doc, current: Doc): Doc {
  if (!DUE_DATE_FIELD_TYPES.includes(current.type)) return incoming;
  const { dueDate: _mine, ...rest } = incoming as Doc & { dueDate?: string };
  const keep = (current as { dueDate?: string }).dueDate;
  return (keep ? { ...rest, dueDate: keep } : rest) as Doc;
}

/**
 * Due date change of a deal (D54): a field update, last writer wins. The revision, ledger lines
 * and stock moves are untouched, so no day lock applies (no cash effect). Audited "old→new".
 */
async function applyDueDate(
  ctx: ApplyContext,
  op: PushOp,
  session: ClientSession,
  role: EffectiveRole,
  incoming: Doc,
  current: Doc | null,
  today: string,
): Promise<PushOpResult> {
  const { db, user } = ctx;
  const k = cols(db);
  const g = op.godownId;
  if (!current) throw new Reject("NOT_FOUND");
  if (current.type !== incoming.type || !isDueDateType(current.type)) {
    throw new Reject("TYPE_IMMUTABLE", current.type);
  }
  if (!can(user, g, "voucher.edit", { voucherType: current.type })) {
    throw new Reject("FORBIDDEN", current.type);
  }
  if (
    role === "entry" &&
    !entryMayChange(current, user._id, op.createdAt, { requireUnsynced: false })
  ) {
    throw new Reject("EDIT_WINDOW_EXPIRED");
  }
  // A reversed deal reminds of nothing: acknowledge, change nothing.
  if (current.status === "void") return appliedNoop(ctx, op, session, current);
  const due = dueDateOf(incoming);
  const check = checkDueDate(due, dealDateOf(current)!, today);
  if (check.error) throw new Reject(check.error, due);
  const old = dueDateOf(current);
  const { serverSeq: _seq, dueDate: _old, ...base } = current as Doc & {
    serverSeq?: number;
    dueDate?: string;
  };
  const next = (due ? { ...base, dueDate: due } : base) as Doc;
  let serverSeq = current.serverSeq;
  if (old !== due) {
    await k.vouchers.replaceOne({ _id: next._id }, next, { session });
    [serverSeq] = await logChanges(db, session, [
      { godownId: g, entity: "voucher", entityId: next._id, rev: next.rev },
    ]);
    await k.vouchers.updateOne({ _id: next._id }, { $set: { serverSeq: serverSeq! } }, { session });
    await audit(db, session, {
      userId: user._id,
      deviceId: ctx.deviceId,
      godownId: g,
      entity: "voucher",
      entityId: next._id,
      action: "due_date",
      opId: op.opId,
      rev: next.rev,
      detail: `${old ?? ""}→${due ?? ""}`,
    });
  }
  const result: PushOpResult = {
    opId: op.opId,
    result: "applied",
    rev: next.rev,
    ...(serverSeq !== undefined ? { serverSeq } : {}),
  };
  await k.appliedOps.insertOne(
    { _id: op.opId, deviceId: ctx.deviceId, userId: user._id, appliedAt: new Date(), result },
    { session },
  );
  // No lines / moves: the device keeps its derived rows (nothing that posts changed).
  return { ...result, doc: { ...next, ...(serverSeq !== undefined ? { serverSeq } : {}) } };
}

function businessDateOf(d: Doc): string {
  switch (d.type) {
    case "EXPENSE":
      return d.expenseDate;
    case "MILL_DISPATCH":
      return d.dispatchDate;
    case "MILL_RETURN":
      return d.returnDate;
    case "CONVERSION":
      return d.conversionDate;
    case "PAYMENT":
      return d.paymentDate;
    case "DAY_CLOSE":
      return d.date;
    default:
      return d.transactionDate;
  }
}

function cashDatesOf(...docs: Array<Doc | null | undefined>): string[] {
  return docs
    .filter((d): d is Doc => !!d && d.type !== "DAY_CLOSE")
    .flatMap((d) => cashEffects({ ...d, status: "active" } as Doc).map((e) => e.date));
}

async function hasActivePayments(db: Db, session: ClientSession, docId: string): Promise<boolean> {
  const esc = docId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const p = await cols(db).vouchers.findOne(
    {
      type: "PAYMENT",
      status: "active",
      $or: [{ "source.id": docId }, { "source.id": { $regex: `^${esc}:` } }],
    },
    { session, projection: { _id: 1 } },
  );
  return p !== null;
}

async function hasDependents(db: Db, session: ClientSession, d: Doc): Promise<boolean> {
  const k = cols(db);
  if (d.type === "MILL_DISPATCH") {
    const x = await k.vouchers.findOne(
      {
        status: "active",
        $or: [{ dispatchId: d._id }, { type: "SALE", consignmentDispatchId: d._id }],
      },
      { session, projection: { _id: 1 } },
    );
    return x !== null;
  }
  if (d.type === "MILL_RETURN") {
    const x = await k.vouchers.findOne(
      { status: "active", type: "CONVERSION", "outputs.returnId": d._id },
      { session, projection: { _id: 1 } },
    );
    return x !== null;
  }
  return false;
}

/** A load links to at most one record, and a record to at most one load (§12.5). */
async function checkLoadLinkUnique(db: Db, session: ClientSession, d: Doc): Promise<void> {
  const k = cols(db);
  if (d.type === "LOAD" && d.link) {
    const other = await k.vouchers.findOne(
      {
        _id: { $ne: d._id },
        godownId: d.godownId,
        type: "LOAD",
        status: "active",
        "link.id": d.link.id,
      },
      { session, projection: { _id: 1 } },
    );
    if (other) throw new Reject("ALREADY_LINKED", d.link.id);
  }
  if ((d.type === "SALE" || d.type === "MILL_DISPATCH") && d.linkedLoadId) {
    const other = await k.vouchers.findOne(
      {
        _id: { $ne: d._id },
        godownId: d.godownId,
        type: { $in: ["SALE", "MILL_DISPATCH"] },
        status: "active",
        linkedLoadId: d.linkedLoadId,
      },
      { session, projection: { _id: 1 } },
    );
    if (other) throw new Reject("ALREADY_LINKED", d.linkedLoadId);
  }
}

/** A DAY_CLOSE locks (active) or reopens (void) its day; returns the dayStatus id. */
async function publishDayStatus(
  ctx: ApplyContext,
  session: ClientSession,
  d: Doc,
): Promise<string> {
  const k = cols(ctx.db);
  if (d.type !== "DAY_CLOSE") return "";
  const id = `${d.godownId}:${d.date}`;
  if (d.status === "active") {
    const doc: DayStatus = {
      _id: id,
      godownId: d.godownId,
      date: d.date,
      closed: true,
      countedCashPaise: d.actualClosingPaise,
      expectedCashPaise: d.expectedClosingPaise,
      closedBy: d.createdBy,
      closedAt: d.updatedAt,
    };
    await k.dayStatus.replaceOne({ _id: id }, doc, { upsert: true, session });
  } else {
    const still = await k.vouchers.findOne(
      { godownId: d.godownId, type: "DAY_CLOSE", date: d.date, status: "active" },
      { session },
    );
    if (!still) {
      await k.dayStatus.replaceOne(
        { _id: id },
        { godownId: d.godownId, date: d.date, closed: false },
        { upsert: true, session },
      );
    }
  }
  return id;
}

/** Closed days on/after a changed cash date get "re-check" (§7.1); returns the flagged ids. */
async function flagRecheck(
  db: Db,
  session: ClientSession,
  godownId: string,
  dates: string[],
): Promise<string[]> {
  if (dates.length === 0) return [];
  const from = [...dates].sort()[0]!;
  const k = cols(db);
  const rows = await k.dayStatus
    .find({ godownId, date: { $gte: from }, closed: true, lateEntry: { $ne: true } }, { session })
    .toArray();
  for (const r of rows)
    await k.dayStatus.updateOne({ _id: r._id }, { $set: { lateEntry: true } }, { session });
  return rows.map((r) => r._id);
}

async function conflictOf(
  db: Db,
  op: PushOp,
  current: Doc,
  session: ClientSession,
  reason: string,
): Promise<Conflict> {
  const derived = (await readDocDerived(db, [current._id], session)).get(current._id)!;
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
  current: Doc,
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
    // The merged document is validated against the entity's (strict) schema before it is stored,
    // so it must not carry `serverSeq` (re-assigned below) nor an `updatedBy` the entity lacks:
    // godown settings have neither field, and carrying them made every settings edit fail the
    // check and silently turn into a conflict.
    const { serverSeq: _curSeq, ...curBase } = cur;
    const stamp = {
      updatedAt: incoming.updatedAt,
      ...(incoming.updatedBy !== undefined ? { updatedBy: incoming.updatedBy } : {}),
    };
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
    next = { ...curBase, rev, ...stamp };
    for (const f of mine) {
      if (incoming[f] === undefined) delete next[f];
      else next[f] = incoming[f];
      meta.fieldRev![f] = rev;
    }
    const check = PUSH_SCHEMAS[entity].safeParse(next);
    if (!check.success) {
      // A merge that would be invalid: keep the server version whole, mine goes to conflicts.
      conflictFields = fields;
      next = { ...curBase, rev, ...stamp };
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

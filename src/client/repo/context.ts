/** Shared pieces of the local write path: who is writing, where, and the rule checks. */
import { v7 as uuidv7 } from "uuid";
import type { ZodError } from "zod";
import { todayIST } from "@/domain/dates";
import { DomainError, type DomainErrorCode } from "@/domain/errors";
import { isDayLocked, roleIn, type EffectiveRole } from "@/domain/rbac";
import { defaultGodownSettings, type Godown, type GodownSettings } from "@/domain/schemas";
import type { GodownLookup, Ref } from "@/domain/scope";
import { now } from "../clock";
import { db, type AuditLocalRow, type OutboxRow } from "../db/dexie";
import { getGodownSettings, getSession, type SessionMeta } from "../db/meta";

/** A write-path failure: one primary code plus (for validation) the Zod issues. */
export class RepoError extends DomainError {
  constructor(
    code: DomainErrorCode,
    detail?: string,
    public readonly codes: DomainErrorCode[] = [code],
    public readonly issues?: ZodError["issues"],
  ) {
    super(code, detail);
    this.name = "RepoError";
  }
}

export function validationError(err: ZodError): RepoError {
  const first = err.issues[0];
  return new RepoError(
    "VALIDATION_FAILED",
    first ? `${first.path.join(".")}: ${first.message}` : undefined,
    ["VALIDATION_FAILED"],
    err.issues,
  );
}

export interface WriteCtx {
  session: SessionMeta;
  userId: string;
  deviceId: string;
  deviceCode: string;
  godown: Godown;
  settings: GodownSettings;
  role: EffectiveRole;
  nowIso: string;
  today: string;
}

/** Resolve the writer and the godown; refuses unknown / archived / inaccessible godowns. */
export async function writeContext(godownId: string): Promise<WriteCtx> {
  if (!godownId) throw new RepoError("GODOWN_NOT_FOUND");
  const session = await getSession();
  if (!session) throw new RepoError("NOT_SIGNED_IN");
  const godown = await db().godowns.get(godownId);
  if (!godown) throw new RepoError("GODOWN_NOT_FOUND");
  if (godown.status === "archived") throw new RepoError("GODOWN_ARCHIVED");
  const role = roleIn(session.user, godownId);
  if (!role) throw new RepoError("FORBIDDEN");
  const d = now();
  const nowIso = d.toISOString();
  const settings = (await getGodownSettings(godownId)) ?? defaultGodownSettings(godownId, nowIso);
  return {
    session,
    userId: session.user._id,
    deviceId: session.deviceId,
    deviceCode: session.deviceCode,
    godown,
    settings,
    role,
    nowIso,
    today: todayIST(d),
  };
}

/** DAY_LOCKED unless the owner (closed day or older than lockAfterDays). */
export async function assertDayOpen(ctx: WriteCtx, date: string): Promise<void> {
  if (ctx.role === "owner") return;
  const ds = await db().dayStatus.get(`${ctx.godown._id}:${date}`);
  const locked = isDayLocked({
    date,
    today: ctx.today,
    lockAfterDays: ctx.settings.lockAfterDays,
    dayClosed: ds?.closed ?? false,
  });
  if (locked) throw new RepoError("DAY_LOCKED", date);
}

/**
 * Prefetch every referenced record and return a synchronous lookup (godownId of each ref).
 * `extra` resolves ids being created in the same transaction (voucher groups).
 */
export async function buildLookup(
  godownId: string,
  refs: readonly Ref[],
  extra: ReadonlyMap<string, string> = new Map(),
): Promise<GodownLookup> {
  const d = db();
  const found = new Map<string, string>();
  const k = (r: Ref) => `${r.kind}:${r.id}`;
  for (const r of refs) {
    if (found.has(k(r))) continue;
    let g: string | undefined;
    switch (r.kind) {
      case "party":
        g = (await d.parties.get(r.id))?.godownId;
        break;
      case "bankAccount":
        g = (await d.bankAccounts.get(r.id))?.godownId;
        break;
      case "vehicle":
        g = (await d.vehicles.get(r.id))?.godownId;
        break;
      case "variety":
        g = (await d.varieties.get(r.id))?.godownId;
        break;
      case "place":
        g = (await d.places.get(r.id))?.godownId;
        break;
      case "expenseCategory":
        g = (await d.expenseCategories.where("[godownId+code]").equals([godownId, r.id]).first())
          ?.godownId;
        break;
      case "voucher":
        g = extra.get(r.id) ?? (await d.vouchers.get(r.id))?.godownId;
        break;
    }
    if (g !== undefined) found.set(k(r), g);
  }
  return (ref) => found.get(k(ref));
}

/** Append an outbox op (inside the caller's transaction). */
export async function enqueueOp(
  ctx: WriteCtx,
  op: Pick<OutboxRow, "entity" | "entityId" | "op" | "baseRev" | "payload"> & {
    fields?: string[];
  },
): Promise<string> {
  const opId = uuidv7();
  const payload = stripServerFields(op.payload);
  await db().outbox.add({
    opId,
    godownId: ctx.godown._id,
    entity: op.entity,
    entityId: op.entityId,
    op: op.op,
    baseRev: op.baseRev,
    payload,
    createdAt: ctx.nowIso,
    attempts: 0,
    status: "pending",
    ...(op.fields ? { fields: op.fields } : {}),
  });
  return opId;
}

/** The server assigns `serverSeq`; never send the local copy. */
function stripServerFields(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const { serverSeq: _drop, ...rest } = payload as Record<string, unknown>;
  return rest;
}

export async function auditLocal(
  ctx: WriteCtx,
  row: Omit<AuditLocalRow, "id" | "at" | "godownId" | "userId" | "deviceId">,
): Promise<void> {
  await db().auditLocal.add({
    at: ctx.nowIso,
    godownId: ctx.godown._id,
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    ...row,
  });
}

/** Does this entity have ops waiting in the outbox (any status)? */
export async function hasPendingOps(entityId: string): Promise<boolean> {
  return (await db().outbox.where("entityId").equals(entityId).count()) > 0;
}

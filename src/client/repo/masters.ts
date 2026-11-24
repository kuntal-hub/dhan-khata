/**
 * Master-data upserts (party, variety, bank, vehicle, place, expense category) and godown
 * settings. Same transaction + outbox path as vouchers. Party `searchKey` is generated here.
 */
import { v7 as uuidv7 } from "uuid";
import { can, entryMayChange } from "@/domain/rbac";
import {
  GodownSettingsSchema,
  PUSH_SCHEMAS,
  normalizeVehicleNumber,
  type BankAccount,
  type ExpenseCategory,
  type GodownSettings,
  type MasterEntity,
  type Party,
  type Place,
  type Variety,
  type Vehicle,
} from "@/domain/schemas";
import { checkRefs, collectMasterRefs } from "@/domain/scope";
import { buildSearchKey } from "@/i18n/translit";
import { db, writeTables, type DhanKhataDB } from "../db/dexie";
import { godownSettingsKey, setMeta } from "../db/meta";
import {
  RepoError,
  auditLocal,
  buildLookup,
  enqueueOp,
  validationError,
  writeContext,
  type WriteCtx,
} from "./context";
import { emitLocalWrite } from "./notify";

export interface MasterDocs {
  party: Party;
  variety: Variety;
  bankAccount: BankAccount;
  vehicle: Vehicle;
  place: Place;
  expenseCategory: ExpenseCategory;
}

type BaseKeys =
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
  | "voidReason";

export type MasterInput<E extends MasterEntity> = Omit<MasterDocs[E], BaseKeys | "searchKey"> & {
  _id?: string;
  status?: "active" | "void";
};

export function masterTable(entity: MasterEntity, d: DhanKhataDB = db()) {
  switch (entity) {
    case "party":
      return d.parties;
    case "variety":
      return d.varieties;
    case "bankAccount":
      return d.bankAccounts;
    case "vehicle":
      return d.vehicles;
    case "place":
      return d.places;
    case "expenseCategory":
      return d.expenseCategories;
  }
}

const BOOKKEEPING = new Set([
  "_id",
  "godownId",
  "rev",
  "createdAt",
  "createdBy",
  "deviceId",
  "updatedAt",
  "updatedBy",
  "serverSeq",
]);

/** Field names whose values differ (used for field-level merge on the server). */
export function changedFields(before: object, after: object): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((k) => !BOOKKEEPING.has(k))
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
}

function normalize<E extends MasterEntity>(entity: E, input: Record<string, unknown>) {
  const out = { ...input };
  if (entity === "party") {
    out.searchKey = buildSearchKey(
      out.name as string | undefined,
      out.nameAlt as string | undefined,
      out.village as string | undefined,
      out.phone as string | undefined,
    );
  }
  if (entity === "vehicle" && typeof out.number === "string") {
    out.number = normalizeVehicleNumber(out.number);
  }
  if (entity === "expenseCategory" && !out.code) {
    out.code = `U_${uuidv7().replace(/-/g, "").slice(-10).toUpperCase()}`;
  }
  return out;
}

/** Create or update a master record in `godownId`. Returns the stored document. */
export async function upsertMaster<E extends MasterEntity>(
  godownId: string,
  entity: E,
  input: MasterInput<E>,
): Promise<MasterDocs[E]> {
  const d = db();
  const doc = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    return upsertMasterInTx(ctx, entity, input);
  });
  emitLocalWrite();
  return doc;
}

/** `upsertMaster` inside the caller's write transaction (e.g. auto-created godown parties). */
export async function upsertMasterInTx<E extends MasterEntity>(
  ctx: WriteCtx,
  entity: E,
  input: MasterInput<E>,
): Promise<MasterDocs[E]> {
  const d = db();
  const godownId = ctx.godown._id;
  const table = masterTable(entity, d);
  {
    const inputGodown = (input as { godownId?: string }).godownId;
    if (inputGodown !== undefined && inputGodown !== godownId) {
      throw new RepoError("GODOWN_IMMUTABLE");
    }
    const existing = input._id ? await table.get(input._id) : undefined;
    if (existing && existing.godownId !== godownId) throw new RepoError("GODOWN_IMMUTABLE");

    const user = ctx.session.user;
    if (existing) {
      const mayEdit =
        can(user, godownId, "master.edit") ||
        (ctx.role === "entry" &&
          entryMayChange(existing, ctx.userId, ctx.nowIso, { requireUnsynced: true }));
      if (!mayEdit) throw new RepoError("FORBIDDEN", entity);
    } else if (!can(user, godownId, "master.create")) {
      throw new RepoError("FORBIDDEN", entity);
    }

    const id = existing?._id ?? input._id ?? uuidv7();
    const raw = normalize(entity, {
      ...(input as Record<string, unknown>),
      _id: id,
      godownId,
      rev: existing ? existing.rev + 1 : 1,
      createdAt: existing?.createdAt ?? ctx.nowIso,
      createdBy: existing?.createdBy ?? ctx.userId,
      deviceId: existing?.deviceId ?? ctx.deviceId,
      updatedAt: ctx.nowIso,
      updatedBy: ctx.userId,
      status: input.status ?? existing?.status ?? "active",
      ...(existing?.serverSeq !== undefined ? { serverSeq: existing.serverSeq } : {}),
    });
    const parsed = PUSH_SCHEMAS[entity].safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const next = parsed.data as MasterDocs[E];

    if (entity === "expenseCategory") {
      const code = (next as ExpenseCategory).code;
      if (existing && (existing as ExpenseCategory).code !== code) {
        throw new RepoError("VALIDATION_FAILED", "code is immutable");
      }
      const clash = await d.expenseCategories
        .where("[godownId+code]")
        .equals([godownId, code])
        .first();
      if (clash && clash._id !== id) throw new RepoError("VALIDATION_FAILED", "duplicate code");
    }

    const refs = collectMasterRefs(entity, next as unknown as Record<string, unknown>);
    const scope = checkRefs(godownId, refs, await buildLookup(godownId, refs));
    if (!scope.ok) throw new RepoError(scope.code, `${scope.ref.kind}:${scope.ref.id}`);

    const fields = existing ? changedFields(existing, next) : undefined;
    if (existing && fields && fields.length === 0) return existing as MasterDocs[E];

    await (table as unknown as { put(v: unknown): Promise<unknown> }).put(next);
    await enqueueOp(ctx, {
      entity,
      entityId: id,
      op: "upsert",
      baseRev: existing ? existing.rev : 0,
      payload: next,
      ...(fields ? { fields } : {}),
    });
    await auditLocal(ctx, {
      entity,
      entityId: id,
      action: existing ? "edit" : "create",
      rev: next.rev,
    });
    return next;
  }
}

/** Owner-only: update this godown's settings (lock days, rounding, defaults…). */
export async function updateGodownSettings(
  godownId: string,
  patch: Partial<Omit<GodownSettings, "_id" | "godownId" | "rev" | "updatedAt">>,
): Promise<GodownSettings> {
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    if (!can(ctx.session.user, godownId, "settings.write")) throw new RepoError("FORBIDDEN");
    const before = ctx.settings;
    const parsed = GodownSettingsSchema.safeParse({
      ...before,
      ...patch,
      _id: godownId,
      godownId,
      rev: before.rev + 1,
      updatedAt: ctx.nowIso,
    });
    if (!parsed.success) throw validationError(parsed.error);
    const next = parsed.data;
    const fields = changedFields(before, next).filter((f) => f !== "rev");
    await setMeta(godownSettingsKey(godownId), next);
    await enqueueOp(ctx, {
      entity: "godownSettings",
      entityId: godownId,
      op: "upsert",
      baseRev: before.rev,
      payload: next,
      fields,
    });
    await auditLocal(ctx, { entity: "godownSettings", entityId: godownId, action: "edit" });
    return next;
  });
  emitLocalWrite();
  return out;
}

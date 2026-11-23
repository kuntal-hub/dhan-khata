/**
 * Pull feed (spec §12.4): changed documents (with their derived lines/moves) ordered by
 * serverSeq, FILTERED to the godowns the user can access, plus global docs (those godowns and
 * the user's own record). A user without access to a godown never receives any of its data.
 */
import type { Db, Filter } from "mongodb";
import type { PullChange, PullEntity, PullResponse } from "@/domain/schemas";
import { publicDoc } from "./convert";
import { cols, type ChangeLogDoc, type UserDoc } from "./db";
import { ApiError } from "./http";
import { readVoucherDerived } from "./apply/mongoStore";
import { godownIdsFor } from "./rbac";

export interface PullParams {
  since: number;
  limit: number;
  /** Per-godown bootstrap (newly granted godown): only that godown's feed. */
  godownId?: string;
  /** accessVersion the client knows. */
  av?: number;
  count?: boolean;
}

export async function pullChanges(db: Db, user: UserDoc, p: PullParams): Promise<PullResponse> {
  const k = cols(db);
  const accessible = await godownIdsFor(db, user);
  let scope: Filter<ChangeLogDoc>;
  if (p.godownId) {
    if (!accessible.includes(p.godownId)) throw new ApiError(403, "FORBIDDEN");
    scope = {
      $or: [{ godownId: p.godownId }, { godownId: null, entity: "godown", entityId: p.godownId }],
    };
  } else {
    scope = {
      $or: [
        { godownId: { $in: accessible } },
        { godownId: null, entity: "godown", entityId: { $in: accessible } },
        { godownId: null, entity: "user", entityId: user._id },
      ],
    };
  }
  const entries = await k.changelog
    .find({ ...scope, serverSeq: { $gt: p.since } })
    .sort({ serverSeq: 1 })
    .limit(p.limit)
    .toArray();

  // Latest entry per entity (the document is sent in its current state).
  const latest = new Map<string, ChangeLogDoc>();
  for (const e of entries) latest.set(`${e.entity}:${e.entityId}`, e);
  const ordered = [...latest.values()].sort((a, b) => a.serverSeq - b.serverSeq);

  const idsBy = new Map<string, string[]>();
  for (const e of ordered) idsBy.set(e.entity, [...(idsBy.get(e.entity) ?? []), e.entityId]);
  const docs = new Map<string, unknown>();
  const collFor: Record<string, { find: (f: object) => { toArray(): Promise<object[]> } }> = {
    voucher: k.vouchers,
    party: k.parties,
    variety: k.varieties,
    bankAccount: k.bankAccounts,
    vehicle: k.vehicles,
    place: k.places,
    expenseCategory: k.expenseCategories,
    godownSettings: k.godownSettings,
    godown: k.godowns,
    user: k.users,
    dayStatus: k.dayStatus,
    reminder: k.reminders,
  } as unknown as Record<string, { find: (f: object) => { toArray(): Promise<object[]> } }>;
  for (const [entity, ids] of idsBy) {
    const coll = collFor[entity];
    if (!coll) continue;
    for (const d of await coll.find({ _id: { $in: ids } }).toArray()) {
      docs.set(`${entity}:${(d as { _id: string })._id}`, publicDoc(d));
    }
  }
  const derived = await readVoucherDerived(db, idsBy.get("voucher") ?? []);

  const changes: PullChange[] = ordered.map((e) => {
    const doc = docs.get(`${e.entity}:${e.entityId}`) ?? null;
    const base: PullChange = {
      serverSeq: e.serverSeq,
      entity: e.entity as PullEntity,
      entityId: e.entityId,
      godownId: e.godownId,
      doc,
    };
    if (e.entity === "voucher") {
      const d = derived.get(e.entityId);
      return { ...base, lines: d?.lines ?? [], moves: d?.moves ?? [] };
    }
    return base;
  });

  const nextSince = entries.length ? entries[entries.length - 1]!.serverSeq : p.since;
  const accessVersion = user.accessVersion ?? 0;
  const res: PullResponse = {
    changes,
    nextSince,
    hasMore: entries.length === p.limit,
    accessChanged: p.av !== undefined && p.av !== accessVersion,
    accessVersion,
    godownIds: accessible,
    serverTime: new Date().toISOString(),
  };
  if (p.count) {
    res.remaining = await k.changelog.countDocuments({ ...scope, serverSeq: { $gt: nextSince } });
  }
  return res;
}

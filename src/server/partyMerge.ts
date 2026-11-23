/**
 * Merge duplicate parties (owner-only, online, spec §9.12): in ONE transaction every voucher,
 * vehicle and reminder of the godown that references the dropped party is re-pointed to the
 * kept party (new revision + re-derived ledger lines + changelog), and the dropped party is
 * voided with `mergedInto`. Audited.
 */
import type { Db, Filter } from "mongodb";
import { applyVoucherDerived } from "@/domain/posting/derive";
import { VoucherSchema, type Voucher } from "@/domain/schemas";
import { mongoDerivedStore } from "./apply/mongoStore";
import { audit, logChanges, type ChangeEntry } from "./changelog";
import { publicDoc } from "./convert";
import { cols, getMongoClient, type UserDoc } from "./db";
import { ApiError } from "./http";

const PARTY_FIELDS = [
  "partyId",
  "millPartyId",
  "fromPartyId",
  "toMillPartyId",
  "secondPartyId",
  "payeePartyId",
  "driverPartyId",
  "hirerPartyId",
  "loading.labourPartyId",
  "delivery.transporterPartyId",
  "expenses.creditPartyId",
  "items.refId",
  "lines.partyId",
];

/** Replace every exact string `from` (and account `PARTY:from`) with `to`, deep. */
export function repoint<T>(value: T, from: string, to: string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v === from) return to;
      if (v === `PARTY:${from}`) return `PARTY:${to}`;
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "_id" ? x : walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

export async function mergeParties(
  db: Db,
  owner: UserDoc,
  deviceId: string,
  input: { godownId: string; keepId: string; dropId: string },
): Promise<{ vouchers: number }> {
  if (!owner.isOwner || !owner.active) throw new ApiError(403, "FORBIDDEN");
  if (input.keepId === input.dropId) throw new ApiError(400, "BAD_REQUEST");
  const client = await getMongoClient();
  return client.withSession((session) =>
    session.withTransaction(async () => {
      const k = cols(db);
      const g = input.godownId;
      // Sequential: concurrent first operations can't share one transaction's session.
      const keep = await k.parties.findOne({ _id: input.keepId }, { session });
      const drop = await k.parties.findOne({ _id: input.dropId }, { session });
      if (!keep || !drop || keep.godownId !== g || drop.godownId !== g)
        throw new ApiError(404, "NOT_FOUND");
      if (keep.status !== "active" || drop.status !== "active")
        throw new ApiError(400, "BAD_REQUEST");
      const now = new Date().toISOString();
      const entries: ChangeEntry[] = [];

      const vFilter = {
        godownId: g,
        $or: [
          ...PARTY_FIELDS.map((f) => ({ [f]: input.dropId })),
          { "lines.account": `PARTY:${input.dropId}` },
        ],
      } as Filter<Voucher>;
      const vouchers = await k.vouchers.find(vFilter, { session }).toArray();
      const store = mongoDerivedStore(db, session);
      for (const current of vouchers) {
        const { serverSeq: _s, ...clean } = current as Voucher & { serverSeq?: number };
        const next = VoucherSchema.parse({
          ...repoint(clean, input.dropId, input.keepId),
          rev: current.rev + 1,
          updatedAt: now,
          updatedBy: owner._id,
        });
        await k.vouchers.replaceOne({ _id: next._id }, next, { session });
        await applyVoucherDerived(store, next, current);
        entries.push({ godownId: g, entity: "voucher", entityId: next._id, rev: next.rev });
      }

      const vehicles = await k.vehicles
        .find(
          { godownId: g, $or: [{ ownerPartyId: input.dropId }, { driverPartyId: input.dropId }] },
          { session },
        )
        .toArray();
      for (const v of vehicles) {
        const next = {
          ...repoint(publicDoc(v), input.dropId, input.keepId),
          rev: v.rev + 1,
          updatedAt: now,
          updatedBy: owner._id,
        };
        await k.vehicles.replaceOne({ _id: v._id }, { ...next, _m: v._m ?? {} }, { session });
        entries.push({ godownId: g, entity: "vehicle", entityId: v._id, rev: next.rev });
      }
      const reminders = await k.reminders
        .find({ godownId: g, partyId: input.dropId }, { session })
        .toArray();
      for (const r of reminders) {
        await k.reminders.updateOne(
          { _id: r._id },
          { $set: { partyId: input.keepId, rev: r.rev + 1, updatedAt: now, updatedBy: owner._id } },
          { session },
        );
        entries.push({ godownId: g, entity: "reminder", entityId: r._id, rev: r.rev + 1 });
      }
      await k.parties.updateOne(
        { _id: drop._id },
        {
          $set: {
            status: "void",
            mergedInto: keep._id,
            rev: drop.rev + 1,
            updatedAt: now,
            updatedBy: owner._id,
          },
        },
        { session },
      );
      entries.push({ godownId: g, entity: "party", entityId: drop._id, rev: drop.rev + 1 });

      const seqs = await logChanges(db, session, entries);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        const coll =
          e.entity === "voucher"
            ? k.vouchers
            : e.entity === "vehicle"
              ? k.vehicles
              : e.entity === "party"
                ? k.parties
                : k.reminders;
        await (coll as typeof k.vouchers).updateOne(
          { _id: e.entityId },
          { $set: { serverSeq: seqs[i]! } },
          { session },
        );
      }
      await audit(db, session, {
        userId: owner._id,
        deviceId,
        godownId: g,
        entity: "party",
        entityId: drop._id,
        action: "edit",
        detail: `merged-into:${keep._id};vouchers:${vouchers.length}`,
      });
      return { vouchers: vouchers.length };
    }),
  );
}

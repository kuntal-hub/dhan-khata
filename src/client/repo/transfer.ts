/**
 * Inter-godown transfer writes (spec §1.4 rule 5, §9.11). One Dexie transaction writes BOTH books
 * when the user can write both godowns (two outbox ops, one per godown). Otherwise only the sending
 * side is written and the server publishes a pending receipt to the receiving godown, which one of
 * its users accepts later. The two sides share `groupId` and are edited/voided together.
 */
import { v7 as uuidv7 } from "uuid";
import { can, roleIn } from "@/domain/rbac";
import type { Party, Voucher } from "@/domain/schemas";
import {
  transferReceiveDraft,
  transferSendDraft,
  type TransferSide,
  type TransferTerms,
} from "@/domain/transfer";
import { db, writeTables } from "../db/dexie";
import { getSession } from "../db/meta";
import { RepoError, writeContext, type WriteCtx } from "./context";
import { upsertMasterInTx } from "./masters";
import { emitLocalWrite } from "./notify";
import { createInTx, editInTx, loadForChange, voidOneInTx, type VoucherDraft } from "./vouchers";

/** The party in `ctx`'s godown that represents `counter` (role godown); created when missing. */
export async function ensureGodownPartyInTx(
  ctx: WriteCtx,
  counter: { _id: string; name: string },
): Promise<Party> {
  const existing = await db()
    .parties.where("godownId")
    .equals(ctx.godown._id)
    .filter(
      (p) =>
        p.status === "active" && p.roles.includes("godown") && p.linkedGodownId === counter._id,
    )
    .first();
  if (existing) return existing;
  return upsertMasterInTx(ctx, "party", {
    name: counter.name,
    roles: ["godown"],
    linkedGodownId: counter._id,
  });
}

/** Can this device write vouchers into `godownId` (known locally, active, role allows)? */
export async function canWriteGodown(godownId: string): Promise<boolean> {
  const session = await getSession();
  const g = await db().godowns.get(godownId);
  if (!session || !g || g.status !== "active") return false;
  return (
    roleIn(session.user, godownId) !== null &&
    can(session.user, godownId, "voucher.create", {
      voucherType: "PURCHASE",
    })
  );
}

async function sideOf(godownId: string, groupId: string): Promise<Voucher | undefined> {
  return db()
    .vouchers.where("[godownId+groupId]")
    .equals([godownId, groupId])
    .filter((v) => v.status === "active" && "interGodown" in v && !!v.interGodown)
    .first();
}

export interface TransferInput extends TransferTerms {
  fromGodownId: string;
  toGodownId: string;
  from: Omit<TransferSide, "godownId" | "partyId">;
  to: Omit<TransferSide, "godownId" | "partyId">;
}

export interface SavedTransfer {
  groupId: string;
  send: Voucher;
  /** Undefined when the receiving godown is not writable here (pending receipt there). */
  receive?: Voucher;
}

/** Create (or, with `groupId`, edit) a transfer. */
export async function saveTransfer(
  input: TransferInput,
  opts: { groupId?: string; reason?: string } = {},
): Promise<SavedTransfer> {
  if (input.fromGodownId === input.toGodownId) throw new RepoError("TRANSFER_SAME_GODOWN");
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctxA = await writeContext(input.fromGodownId);
    const both = await canWriteGodown(input.toGodownId);
    const ctxB = both ? await writeContext(input.toGodownId) : null;
    const groupId = opts.groupId ?? uuidv7();
    const oldSend = opts.groupId ? await sideOf(input.fromGodownId, groupId) : undefined;
    const oldReceive = opts.groupId && both ? await sideOf(input.toGodownId, groupId) : undefined;
    if (opts.groupId && !oldSend) throw new RepoError("NOT_FOUND", groupId);
    if (oldSend && oldSend.type !== (input.kind === "PADDY" ? "SALE" : "PAYMENT")) {
      throw new RepoError("TYPE_IMMUTABLE");
    }
    const priorPaired =
      oldSend && "interGodown" in oldSend && oldSend.interGodown
        ? oldSend.interGodown.paired
        : undefined;
    const paired = priorPaired ?? both;

    // The receiving godown must at least be visible on this device (the wizard lists only those).
    const toGodown = ctxB?.godown ?? (await d.godowns.get(input.toGodownId));
    if (!toGodown) throw new RepoError("GODOWN_NOT_FOUND", input.toGodownId);
    const partyA = await ensureGodownPartyInTx(ctxA, { _id: toGodown._id, name: toGodown.name });
    const sendDraft = transferSendDraft(
      input,
      { ...input.from, godownId: input.fromGodownId, partyId: partyA._id },
      input.toGodownId,
      groupId,
      paired,
    ) as VoucherDraft;
    let send: Voucher;
    if (oldSend) {
      const checked = await loadForChange(ctxA, oldSend._id, "voucher.edit", { internal: true });
      send = await editInTx(ctxA, checked, sendDraft, opts.reason);
    } else {
      send = await createInTx(ctxA, sendDraft, { groupId });
    }

    let receive: Voucher | undefined;
    if (ctxB && (!opts.groupId || oldReceive || paired)) {
      const partyB = await ensureGodownPartyInTx(ctxB, {
        _id: input.fromGodownId,
        name: ctxA.godown.name,
      });
      const recvDraft = transferReceiveDraft(
        input,
        { ...input.to, godownId: input.toGodownId, partyId: partyB._id },
        input.fromGodownId,
        groupId,
        oldReceive && "interGodown" in oldReceive && oldReceive.interGodown
          ? oldReceive.interGodown.paired
          : paired,
      ) as VoucherDraft;
      if (oldReceive) {
        const checked = await loadForChange(ctxB, oldReceive._id, "voucher.edit", {
          internal: true,
        });
        receive = await editInTx(ctxB, checked, recvDraft, opts.reason);
      } else {
        receive = await createInTx(ctxB, recvDraft, { groupId });
      }
    }
    return { groupId, send, ...(receive ? { receive } : {}) };
  });
  emitLocalWrite();
  return out;
}

/**
 * Void a transfer from either side: both books together when this device can write both;
 * otherwise only this side (the server keeps the other book consistent or refuses).
 */
export async function voidTransfer(
  godownId: string,
  voucherId: string,
  reason: string,
): Promise<Voucher[]> {
  if (!reason.trim()) throw new RepoError("NOTE_REQUIRED");
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const own = await loadForChange(ctx, voucherId, "voucher.void", { internal: true });
    if (!("interGodown" in own) || !own.interGodown || !own.groupId) {
      throw new RepoError("INVALID_REFERENCE");
    }
    const voided = [await voidOneInTx(ctx, own, reason.trim())];
    const counterId = own.interGodown.counterGodownId;
    if (await canWriteGodown(counterId)) {
      const other = await sideOf(counterId, own.groupId);
      if (other) {
        const ctxB = await writeContext(counterId);
        const checked = await loadForChange(ctxB, other._id, "voucher.void", { internal: true });
        voided.push(await voidOneInTx(ctxB, checked, reason.trim()));
      }
    } else if (own.interGodown.side === "SEND" && own.interGodown.paired) {
      // The receiving book exists but this device can't change it.
      throw new RepoError("TRANSFER_NEEDS_BOTH");
    }
    return voided;
  });
  emitLocalWrite();
  return out;
}

export interface AcceptInput {
  /** Paddy: the receiving godown's own variety. */
  varietyId?: string;
  mode?: TransferSide["mode"];
  bankAccountId?: string;
  date?: string;
}

/** A user of the receiving godown accepts a pending receipt (creates the RECEIVE voucher). */
export async function acceptTransfer(
  godownId: string,
  transferId: string,
  input: AcceptInput,
): Promise<Voucher> {
  const d = db();
  const v = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const t = await d.transfers.get(transferId);
    if (!t || t.godownId !== godownId || t.status !== "pending") {
      throw new RepoError("TRANSFER_NOT_PENDING");
    }
    if (await sideOf(godownId, transferId)) throw new RepoError("TRANSFER_NOT_PENDING");
    const party = await ensureGodownPartyInTx(ctx, { _id: t.fromGodownId, name: t.fromGodownName });
    const terms: TransferTerms = {
      kind: t.kind,
      date: input.date ?? t.date,
      ...(t.qtyG ? { qtyG: BigInt(t.qtyG) } : {}),
      ...(t.ratePaisePerQtl ? { ratePaisePerQtl: BigInt(t.ratePaisePerQtl) } : {}),
      amountPaise: BigInt(t.amountPaise),
      ...(t.notes ? { notes: t.notes } : {}),
    };
    const draft = transferReceiveDraft(
      terms,
      {
        godownId,
        partyId: party._id,
        ...(input.varietyId ? { varietyId: input.varietyId } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
      },
      t.fromGodownId,
      transferId,
      false,
    ) as VoucherDraft;
    const created = await createInTx(ctx, draft, { groupId: transferId });
    await d.transfers.put({ ...t, status: "accepted", acceptedVoucherId: created._id });
    return created;
  });
  emitLocalWrite();
  return v;
}

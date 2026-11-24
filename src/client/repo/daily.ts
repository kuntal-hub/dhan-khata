/**
 * Daily money writes (spec §9.4, §9.9, §9.10): expenses, contra entries, stock adjustments and
 * trips save as single vouchers; day close writes a DAY_CLOSE voucher + the day's lock in ONE
 * transaction; the owner's unlock voids it (audited) so the day can be closed again.
 */
import { ACC } from "@/domain/posting/accounts";
import { can } from "@/domain/rbac";
import type { Voucher } from "@/domain/schemas";
import { db, writeTables } from "../db/dexie";
import { RepoError, auditLocal, writeContext } from "./context";
import { emitLocalWrite } from "./notify";
import type { SaveOpts } from "./trade";
import {
  createInTx,
  saveVoucherWithLinked,
  voidOneInTx,
  type SavedGroup,
  type VoucherDraft,
} from "./vouchers";

/** One voucher with no linked members (EXPENSE, CONTRA, STOCK_ADJUST, TRIP, OPENING). */
export function saveSimple(
  godownId: string,
  draft: VoucherDraft,
  opts: SaveOpts = {},
): Promise<SavedGroup> {
  return saveVoucherWithLinked(godownId, { primary: draft }, opts);
}

/** CASH balance at the end of `date` (Σdebit − Σcredit of every CASH line dated ≤ date). */
async function cashAtEndOf(godownId: string, date: string): Promise<bigint> {
  const lines = await db()
    .ledgerLines.where("[godownId+account+date]")
    .between([godownId, ACC.CASH, ""], [godownId, ACC.CASH, date], true, true)
    .toArray();
  let bal = 0n;
  for (const l of lines) bal += BigInt(l.debitPaise) - BigInt(l.creditPaise);
  return bal;
}

export interface CloseDayInput {
  date: string;
  countedCashPaise: bigint;
  /** Note count by rupee value ("500" → 3) plus `coinsPaise`. */
  denominations?: Record<string, number>;
  notes?: string;
}

/**
 * দিন শেষ: expected cash is read INSIDE the transaction (so it matches what is posted); the
 * difference posts to CASH_DIFF; the day is locked for manager/entry.
 */
export async function closeDay(godownId: string, input: CloseDayInput): Promise<Voucher> {
  const d = db();
  const v = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const expected = await cashAtEndOf(godownId, input.date);
    const draft = {
      type: "DAY_CLOSE",
      date: input.date,
      expectedCashPaise: expected.toString(),
      countedCashPaise: input.countedCashPaise.toString(),
      differencePaise: "0",
      ...(input.denominations && Object.keys(input.denominations).length
        ? { denominations: input.denominations }
        : {}),
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    } as VoucherDraft;
    return createInTx(ctx, draft, {});
  });
  emitLocalWrite();
  return v;
}

/** Owner only: unlock a closed day (voids its DAY_CLOSE, reversing CASH_DIFF; audited). */
export async function unlockDay(godownId: string, date: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new RepoError("NOTE_REQUIRED");
  const d = db();
  await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    if (!can(ctx.session.user, godownId, "day.unlock")) throw new RepoError("FORBIDDEN");
    const closes = await d.vouchers
      .where("[godownId+type+date]")
      .equals([godownId, "DAY_CLOSE", date])
      .filter((x) => x.status === "active")
      .toArray();
    if (closes.length === 0) throw new RepoError("DAY_NOT_CLOSED", date);
    for (const c of closes) await voidOneInTx(ctx, c, reason.trim());
    await auditLocal(ctx, {
      entity: "dayStatus",
      entityId: `${godownId}:${date}`,
      action: "unlock",
      reason: reason.trim(),
    });
  });
  emitLocalWrite();
}

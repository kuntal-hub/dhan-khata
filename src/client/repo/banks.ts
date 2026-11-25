/**
 * Bank accounts (avatar menu → ব্যাংক অ্যাকাউন্ট). A new account's opening balance is posted as
 * an OPENING document (BANK item) in the same transaction, so the bank book starts right and the
 * figure is a real, reversible record (never only a number on the master).
 */
import type { BankAccount } from "@/domain/schemas";
import { db, writeTables } from "../db/dexie";
import { writeContext } from "./context";
import { createInTx, newId, type DocDraft } from "./docs";
import { upsertMasterInTx } from "./masters";
import { emitLocalWrite } from "./notify";

export interface BankInput {
  _id?: string;
  name: string;
  bank: string;
  last4: string;
  isUpiLinked: boolean;
  /** Only for a new account: balance today (signed paise). */
  openingPaise?: bigint;
}

export async function saveBankAccount(godownId: string, input: BankInput): Promise<BankAccount> {
  const d = db();
  const out = await d.transaction("rw", writeTables(d), async () => {
    const ctx = await writeContext(godownId);
    const existing = input._id ? await d.bankAccounts.get(input._id) : undefined;
    const id = existing?._id ?? newId();
    const acc = await upsertMasterInTx(ctx, "bankAccount", {
      _id: id,
      name: input.name.trim(),
      bank: input.bank.trim(),
      last4: input.last4,
      isUpiLinked: input.isUpiLinked,
      openingBalancePaise: existing?.openingBalancePaise ?? (input.openingPaise ?? 0n).toString(),
    });
    if (!existing && input.openingPaise && input.openingPaise !== 0n) {
      await createInTx(ctx, {
        type: "OPENING",
        transactionDate: ctx.today,
        items: [{ kind: "BANK", refId: id, amountPaise: input.openingPaise.toString() }],
      } as DocDraft);
    }
    return acc;
  });
  emitLocalWrite();
  return out;
}

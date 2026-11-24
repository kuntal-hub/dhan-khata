"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/client/db/dexie";
import { linesOfParty, partyBills } from "@/client/queries/parties";
import { getLastUsed } from "@/client/repo";
import type { Voucher } from "@/domain/schemas";

export { useGodownSettings } from "@/client/hooks";

export interface PriorBalance {
  /** Party balance without the voucher group being edited (> 0 = they owe us). */
  balancePaise: bigint;
  advanceGivenPaise: bigint;
  advanceTakenPaise: bigint;
}

/** "আগের বাকি ₹x / অগ্রিম দেওয়া আছে ₹y" — excluding the group currently being edited. */
export function usePriorBalance(
  godownId: string | null,
  partyId: string | undefined,
  excludeGroupId?: string,
): PriorBalance | undefined {
  return useLiveQuery(async () => {
    if (!godownId || !partyId) return undefined;
    const exclude = new Set<string>();
    if (excludeGroupId) {
      const group = await db()
        .vouchers.where("[godownId+groupId]")
        .equals([godownId, excludeGroupId])
        .toArray();
      group.forEach((v) => exclude.add(v._id));
    }
    let bal = 0n;
    for (const l of await linesOfParty(godownId, partyId)) {
      if (exclude.has(l.voucherId)) continue;
      bal += BigInt(l.debitPaise) - BigInt(l.creditPaise);
    }
    const bills = await partyBills(godownId, partyId);
    return {
      balancePaise: bal,
      advanceGivenPaise: bills.advanceGivenPaise,
      advanceTakenPaise: bills.advanceTakenPaise,
    };
  }, [godownId, partyId, excludeGroupId]);
}

export function useLastUsed(godownId: string | null, partyId: string | undefined) {
  return useLiveQuery(
    async () => (godownId && partyId ? ((await getLastUsed(godownId, partyId)) ?? null) : null),
    [godownId, partyId],
  );
}

export function useVoucher(id: string | undefined): Voucher | null | undefined {
  return useLiveQuery(async () => (id ? ((await db().vouchers.get(id)) ?? null) : null), [id]);
}

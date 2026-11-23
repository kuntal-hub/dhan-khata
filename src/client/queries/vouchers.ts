/** Voucher list / register queries (per godown). */
import { loadMargin } from "@/domain/calc/load";
import { addDays } from "@/domain/dates";
import { divRoundHalfUp } from "@/domain/rounding";
import type { Voucher, VoucherType } from "@/domain/schemas";
import { db } from "../db/dexie";

export interface ListFilter {
  from?: string;
  to?: string;
  season?: string;
  varietyId?: string;
  partyId?: string;
  /** "active" (default), "void" or "all". */
  status?: "active" | "void" | "all";
}

/** Vouchers of one type, newest first. */
export async function listVouchers(
  godownId: string,
  type: VoucherType,
  f: ListFilter = {},
): Promise<Voucher[]> {
  const list = await db()
    .vouchers.where("[godownId+type+date]")
    .between([godownId, type, f.from ?? ""], [godownId, type, f.to ?? "￿"], true, true)
    .toArray();
  const status = f.status ?? "all";
  return list
    .filter((v) => status === "all" || v.status === status)
    .filter((v) => !f.season || v.season === f.season)
    .filter((v) => !f.partyId || ("partyId" in v && v.partyId === f.partyId))
    .filter(
      (v) =>
        !f.varietyId ||
        ((v.type === "PURCHASE" || v.type === "SALE") &&
          v.lines.some((l) => l.varietyId === f.varietyId)) ||
        (v.type === "LOAD" && v.varietyId === f.varietyId),
    )
    .sort((a, b) =>
      a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1,
    );
}

/** All vouchers of one business day (any type), newest first. */
export async function vouchersOfDay(godownId: string, date: string): Promise<Voucher[]> {
  const list = await db().vouchers.where("[godownId+date]").equals([godownId, date]).toArray();
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function groupOf(v: Voucher): Promise<Voucher[]> {
  if (!v.groupId) return [v];
  return db().vouchers.where("[godownId+groupId]").equals([v.godownId, v.groupId]).toArray();
}

/** Weighted average purchase rate of a variety over the last 30 days (sanity band, §9.2). */
export async function avgPurchaseRate30d(
  godownId: string,
  varietyId: string,
  today: string,
  excludeId?: string,
): Promise<bigint | null> {
  const list = await listVouchers(godownId, "PURCHASE", {
    from: addDays(today, -30),
    to: today,
    status: "active",
  });
  let net = 0n;
  let amount = 0n;
  for (const v of list) {
    if (v.type !== "PURCHASE" || v._id === excludeId) continue;
    for (const l of v.lines) {
      if (l.varietyId !== varietyId) continue;
      net += BigInt(l.netG);
      amount += BigInt(l.amountPaise);
    }
  }
  return net > 0n ? divRoundHalfUp(amount * 100_000n, net) : null;
}

/** Is `rate` outside ±25 % of the reference rate? (warn only). */
export function rateOutOfBand(rate: bigint, reference: bigint | null): boolean {
  if (reference === null || reference <= 0n) return false;
  return rate * 100n > reference * 125n || rate * 100n < reference * 75n;
}

export interface LoadRow {
  load: Voucher & { type: "LOAD" };
  marginPaise: bigint;
}

/** Load register rows (spec §9.5), oldest first within the range. */
export async function loadRegister(godownId: string, f: ListFilter = {}): Promise<LoadRow[]> {
  const list = await listVouchers(godownId, "LOAD", { ...f, status: f.status ?? "active" });
  return list
    .filter((v): v is Voucher & { type: "LOAD" } => v.type === "LOAD")
    .filter(
      (v) =>
        !f.partyId ||
        v.fromPartyId === f.partyId ||
        v.toMillPartyId === f.partyId ||
        v.secondPartyId === f.partyId,
    )
    .map((load) => ({ load, marginPaise: load.mode === "OWN_TRADE" ? loadMargin(load) : 0n }))
    .sort((a, b) =>
      a.load.date === b.load.date
        ? a.load.createdAt < b.load.createdAt
          ? -1
          : 1
        : a.load.date < b.load.date
          ? -1
          : 1,
    );
}

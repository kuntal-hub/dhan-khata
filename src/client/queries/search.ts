/**
 * Global search (spec §9.15) within ONE godown, offline over Dexie: parties (name in either
 * script, village, phone), vehicle numbers, voucher numbers and amounts ("26068" / "২৬০৬৮").
 * The all-godowns variant lives in `queries/consolidated` (the only module that mixes godowns).
 */
import { normalizeDigits } from "@/domain/digits";
import { parseRupees } from "@/domain/money";
import type { Party, Vehicle, Voucher } from "@/domain/schemas";
import { normalizeVehicleNumber } from "@/domain/vehicleNumber";
import { db } from "../db/dexie";
import { amountOf } from "../ui/amount";
import { partyMatches } from "./parties";

export type SearchHit =
  | { kind: "party"; godownId: string; party: Party }
  | { kind: "vehicle"; godownId: string; vehicle: Vehicle }
  | { kind: "voucher"; godownId: string; voucher: Voucher; byAmount: boolean };

export interface SearchResults {
  parties: Array<Extract<SearchHit, { kind: "party" }>>;
  vehicles: Array<Extract<SearchHit, { kind: "vehicle" }>>;
  vouchers: Array<Extract<SearchHit, { kind: "voucher" }>>;
}

export const EMPTY_RESULTS: SearchResults = { parties: [], vehicles: [], vouchers: [] };

/** "২৬,০৬৮" / "₹26068.50" → paise, or null when the query isn't an amount. */
export function amountQuery(q: string): bigint | null {
  const s = normalizeDigits(q).replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const r = parseRupees(s);
  return r.ok && r.value > 0n ? r.value : null;
}

export async function searchGodown(
  godownId: string,
  query: string,
  limit = 30,
): Promise<SearchResults> {
  const q = query.trim();
  if (q.length < 2) return EMPTY_RESULTS;
  const d = db();
  const digits = normalizeDigits(q);
  const plate = normalizeVehicleNumber(digits);
  const numberQ = digits.toUpperCase().replace(/\s/g, "");
  const amount = amountQuery(q);
  const [parties, vehicles, vouchers] = await Promise.all([
    d.parties.where("godownId").equals(godownId).toArray(),
    d.vehicles.where("godownId").equals(godownId).toArray(),
    d.vouchers.where("godownId").equals(godownId).toArray(),
  ]);
  const partyHits = parties
    .filter((p) => p.status === "active" && partyMatches(p, q))
    .slice(0, limit)
    .map((party) => ({ kind: "party" as const, godownId, party }));
  const vehicleHits =
    plate.length >= 2
      ? vehicles
          .filter((v) => v.status === "active" && v.number.includes(plate))
          .slice(0, limit)
          .map((vehicle) => ({ kind: "vehicle" as const, godownId, vehicle }))
      : [];
  const voucherHits: SearchResults["vouchers"] = [];
  for (const v of vouchers) {
    if (voucherHits.length >= limit) break;
    const byNumber = numberQ.length >= 3 && v.number.toUpperCase().includes(numberQ);
    const byAmount = amount !== null && amountOf(v) === amount;
    const byVehicle =
      plate.length >= 4 &&
      (v.type === "SALE" || v.type === "LOAD") &&
      v.vehicleNumber.includes(plate);
    if (byNumber || byAmount || byVehicle) {
      voucherHits.push({ kind: "voucher", godownId, voucher: v, byAmount });
    }
  }
  voucherHits.sort((a, b) => (a.voucher.date < b.voucher.date ? 1 : -1));
  return { parties: partyHits, vehicles: vehicleHits, vouchers: voucherHits };
}

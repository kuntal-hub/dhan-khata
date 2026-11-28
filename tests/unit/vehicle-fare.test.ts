/**
 * Purchase vehicle fare (DECISIONS D56), pure rules: posting (farmer net, owner payable, stock and
 * purchase value unchanged, never an expense, no cash until paid), bills, direction, rules, the
 * edit guard, Gola scope and "same owner" matching.
 */
import { describe, expect, it } from "vitest";
import { DomainError } from "@/domain/errors";
import { sumBig } from "@/domain/rounding";
import { collectRefs } from "@/domain/scope";
import { findSameOwner, isSameOwner, normalizeOwnerName } from "@/domain/vehicleOwner";
import { cashEffects } from "@/domain/v2/cashbook";
import { assertPaymentDirection, directionFor } from "@/domain/v2/direction";
import { fareBillChanged, validateLinks } from "@/domain/v2/links";
import {
  billState,
  billsOf,
  farmerNetOf,
  vehicleFareOf,
  vehicleFareSourceId,
} from "@/domain/v2/payments";
import { postDoc } from "@/domain/v2/post";
import { validateDocRules } from "@/domain/v2/recompute";
import { deriveAll } from "@/domain/v2/replay";
import type { Doc, VehicleFare } from "@/domain/v2/schemas";
import { payment, purchase, QTL, RS } from "../helpers/v2";

const D = "2026-11-20";
const TODAY = "2026-11-28";
const fare = (amountRs: bigint, owner = "TOTO1"): VehicleFare => ({
  ownerPartyId: owner,
  vehicleKind: "TOTO",
  amountPaise: (amountRs * RS).toString(),
});
/** ₹12,800 of paddy (5.12 qtl × ₹2,500). */
const buy = (f?: VehicleFare, partyId = "F1") =>
  purchase(D, partyId, "V1", 512n * 1000n, 2500n * RS, {}, f ? { vehicleFare: f } : {});

const acct = (d: Doc, account: string) =>
  sumBig(
    postDoc(d)
      .lines.filter((l) => l.account === account)
      .map((l) => l.debit - l.credit),
  );

describe("posting", () => {
  it("₹12,800 with ₹300 toto fare: farmer ₹12,500, owner ₹300, stock ₹12,800, no expense or cash", () => {
    const p = buy(fare(300n));
    expect(p.totalPaise).toBe((12_800n * RS).toString());
    const { lines, moves } = postDoc(p);
    expect(sumBig(lines.map((l) => l.debit))).toBe(sumBig(lines.map((l) => l.credit)));
    expect(acct(p, "STOCK_PADDY")).toBe(12_800n * RS);
    expect(acct(p, "PARTY:F1")).toBe(-12_500n * RS);
    expect(acct(p, "PARTY:TOTO1")).toBe(-300n * RS);
    expect(acct(p, "CASH")).toBe(0n);
    expect(lines.some((l) => l.account.startsWith("EXP:") || l.account === "EXP_PAYABLE")).toBe(
      false,
    );
    // Variety-wise stock: same quantity and value as without a fare.
    expect(moves).toEqual(postDoc(buy()).moves);
    expect(cashEffects(p)).toEqual([]);
  });

  it("a purchase without a fare posts exactly as before", () => {
    const p = buy();
    expect(postDoc(p).lines).toHaveLength(2);
    expect(acct(p, "PARTY:F1")).toBe(-12_800n * RS);
  });

  it("paying the fare moves cash once, as money paid (never an expense)", () => {
    const p = buy(fare(300n));
    const pay = payment(
      D,
      "OUT",
      300n * RS,
      { type: "VEHICLE_FARE", id: vehicleFareSourceId(p._id) },
      {
        partyId: "TOTO1",
      },
    );
    const { lines } = deriveAll([p, pay]);
    const bal = (a: string) =>
      sumBig(
        lines
          .filter((l) => l.account === a)
          .map((l) => BigInt(l.debitPaise) - BigInt(l.creditPaise)),
      );
    expect(bal("PARTY:TOTO1")).toBe(0n);
    expect(bal("CASH")).toBe(-300n * RS);
    expect(bal("PARTY:F1")).toBe(-12_500n * RS);
    expect(cashEffects(pay)).toEqual([
      expect.objectContaining({ category: "PAID", signedPaise: -300n * RS }),
    ]);
  });
});

describe("bills", () => {
  it("farmer bill = total − fare (first); fare bill to the owner (second)", () => {
    const p = buy(fare(300n));
    const [farmer, owner] = billsOf(p);
    expect(farmer).toMatchObject({ sourceType: "PURCHASE", sourceId: p._id, partyId: "F1" });
    expect(farmer!.totalPaise).toBe(12_500n * RS);
    expect(owner).toMatchObject({
      sourceType: "VEHICLE_FARE",
      sourceId: `${p._id}:fare`,
      partyId: "TOTO1",
      direction: "OUT",
    });
    expect(owner!.totalPaise).toBe(300n * RS);
    expect(vehicleFareOf(p)).toBe(300n * RS);
    expect(farmerNetOf(p)).toBe(12_500n * RS);
    expect(billsOf(buy())).toHaveLength(1);
  });

  it("farmer and owner payments are tracked separately", () => {
    const p = buy(fare(300n));
    const [farmer, owner] = billsOf(p);
    const ownerPay = payment(
      D,
      "OUT",
      300n * RS,
      { type: "VEHICLE_FARE", id: owner!.sourceId },
      {
        partyId: "TOTO1",
      },
    );
    const farmerPay = payment(
      D,
      "OUT",
      2_500n * RS,
      { type: "PURCHASE", id: p._id },
      {
        partyId: "F1",
      },
    );
    const pays = [ownerPay, farmerPay];
    expect(billState(farmer!, pays, TODAY).duePaise).toBe(10_000n * RS);
    expect(billState(owner!, pays, TODAY).status).toBe("PAID");
  });
});

describe("rules", () => {
  it("VEHICLE_FARE is always OUT", () => {
    expect(directionFor("VEHICLE_FARE")).toBe("OUT");
    expect(() => assertPaymentDirection("VEHICLE_FARE", "IN")).toThrow(DomainError);
  });

  it("fare can't exceed the purchase, be owed to the farmer, or sit on an inter-Gola transfer", () => {
    expect(() => validateDocRules(buy(fare(12_800n)), TODAY)).not.toThrow();
    expect(() => validateDocRules(buy(fare(12_801n)), TODAY)).toThrow(
      expect.objectContaining({ code: "FARE_EXCEEDS_PURCHASE" }),
    );
    expect(() => validateDocRules(buy(fare(100n, "F1")), TODAY)).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    const transfer = purchase(
      D,
      "F1",
      "V1",
      QTL,
      2000n * RS,
      {},
      {
        vehicleFare: fare(100n),
        interGola: { counterGodownId: "GB", side: "RECEIVE", paired: true },
      },
    );
    expect(() => validateDocRules(transfer, TODAY)).toThrow(DomainError);
  });

  it("a fare payment must name the purchase's owner", () => {
    const p = buy(fare(300n));
    const ok = payment(
      D,
      "OUT",
      100n * RS,
      { type: "VEHICLE_FARE", id: `${p._id}:fare` },
      {
        partyId: "TOTO1",
      },
    );
    const wrong = payment(
      D,
      "OUT",
      100n * RS,
      { type: "VEHICLE_FARE", id: `${p._id}:fare` },
      {
        partyId: "F1",
      },
    );
    const get = (id: string) => (id === p._id ? p : undefined);
    expect(() => validateLinks(ok, get)).not.toThrow();
    expect(() => validateLinks(wrong, get)).toThrow(DomainError);
    // A purchase without a fare has no fare bill.
    const plain = buy();
    const none = payment(
      D,
      "OUT",
      100n * RS,
      { type: "VEHICLE_FARE", id: `${plain._id}:fare` },
      {
        partyId: "TOTO1",
      },
    );
    expect(() => validateLinks(none, (id) => (id === plain._id ? plain : undefined))).toThrow(
      DomainError,
    );
  });

  it("edit guard: owner change or removal names the fare source; amount change doesn't", () => {
    const p = buy(fare(300n));
    expect(fareBillChanged(p, { ...p, vehicleFare: fare(250n) })).toBeNull();
    expect(fareBillChanged(p, { ...p, vehicleFare: fare(300n, "VAN2") })).toBe(`${p._id}:fare`);
    const { vehicleFare: _f, ...noFare } = p;
    expect(fareBillChanged(p, noFare as Doc)).toBe(`${p._id}:fare`);
    expect(fareBillChanged(buy(), p)).toBeNull();
  });

  it("the owner is a same-Gola reference", () => {
    expect(collectRefs(buy(fare(300n)))).toContainEqual({ kind: "party", id: "TOTO1" });
  });
});

describe("same owner", () => {
  it("name ignores case and spaces; mobiles must not contradict", () => {
    expect(normalizeOwnerName("  Bapi   Das ")).toBe("bapi das");
    expect(isSameOwner({ name: "Bapi Das" }, { name: "bapi  das", phone: "9830012345" })).toBe(
      true,
    );
    expect(
      isSameOwner(
        { name: "Bapi Das", phone: "+91 98300 12345" },
        { name: "Bapi Das", phone: "9830012345" },
      ),
    ).toBe(true);
    expect(
      isSameOwner(
        { name: "Bapi Das", phone: "9830012345" },
        { name: "Bapi Das", phone: "9830099999" },
      ),
    ).toBe(false);
    expect(isSameOwner({ name: "Bapi Das" }, { name: "Bapi Dey" })).toBe(false);
    const list = [
      { _id: "a", name: "Bapi Das" },
      { _id: "b", name: "Rintu" },
    ];
    expect(findSameOwner(list, { name: "BAPI DAS" })?._id).toBe("a");
    expect(findSameOwner(list, { name: "BAPI DAS" }, "a")).toBeUndefined();
  });
});

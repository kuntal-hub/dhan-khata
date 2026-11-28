/**
 * Purchase vehicle fare & owner ledger (DECISIONS D56) through the real device write path. Follows
 * the client's mandatory validation:
 *  1–2 ₹12,800 purchase with ₹300 toto fare → farmer payable ₹12,500
 *  3   the toto owner's ledger gets ₹300
 *  4–5 same owner on other farmers' purchases (no retyping) → earnings add up (₹900)
 *  6   pay him later (₹500) → outstanding ₹400
 *  7   unpaid fare doesn't touch cash in hand
 *  8   paid fare affects cash flow exactly once
 *  9   purchase value and variety-wise stock unchanged
 * plus duplicates, other-Gola owners, edits, reversal and Due & Advance.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { ownersFromOtherGolas } from "@/client/queries/consolidated/vehicleOwners";
import { partyDues } from "@/client/queries/dues";
import { vehicleOwnerLedger, vehicleOwnerSummaries } from "@/client/queries/fares";
import { godownBalances } from "@/client/queries/ledger";
import { paymentsOf, stateOf } from "@/client/queries/purchases";
import {
  adoptVehicleOwner,
  farePaymentItem,
  importVehicleOwner,
  payBill,
  payVehicleOwner,
  saveBillWithInitialPayment,
  saveDoc,
  saveVehicleOwner,
  upsertMaster,
  voidDoc,
  voidDocs,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Doc, DocOf, VehicleFare } from "@/domain/schemas";
import { cashEffects } from "@/domain/v2/cashbook";
import { deriveAll } from "@/domain/v2/replay";
import { qtyAt, valueAt } from "@/domain/v2/stock";
import { RS, TODAY, purchaseDraft, setupDevice, type LocalGodown } from "../helpers/local";

let A: LocalGodown;
let B: LocalGodown;
const GA = "GA";
const GB = "GB";
const D1 = addDays(TODAY, -6);
const D2 = addDays(TODAY, -4);
const D3 = addDays(TODAY, -2);
/** 5.12 qtl × ₹2,500 = ₹12,800. */
const KG512 = 512_000n;

beforeEach(async () => {
  const gs = await setupDevice("repo-vehicle-fare", {
    godowns: [
      { id: GA, code: "VA" },
      { id: GB, code: "VB" },
    ],
  });
  A = gs[GA]!;
  B = gs[GB]!;
});

const fareOf = (owner: string, rs: bigint): VehicleFare => ({
  ownerPartyId: owner,
  vehicleKind: "TOTO",
  amountPaise: (rs * RS).toString(),
});

async function buyWithFare(
  farmer: string,
  owner: string,
  fareRs: bigint,
  date = D1,
  rateRs = 2500n,
) {
  const { bill } = await saveBillWithInitialPayment(
    GA,
    {
      ...purchaseDraft(farmer, A.variety.SWARNA!, KG512, rateRs * RS, date),
      vehicleFare: fareOf(owner, fareRs),
    },
    null,
  );
  return bill as DocOf<"PURCHASE">;
}

async function farmer(name: string) {
  return (await upsertMaster(GA, "party", { name, roles: ["FARMER"] }))._id;
}

const cash = async () => (await godownBalances(GA)).get("CASH") ?? 0n;

async function storedEqualsReplay(): Promise<void> {
  const want = deriveAll((await db().vouchers.toArray()) as Doc[]);
  const lines = (await db().ledgerLines.toArray()).map((l) => l._id).sort();
  expect(lines).toEqual(want.lines.map((l) => l._id).sort());
}

describe("mandatory validation (D56)", () => {
  it("₹12,800 − ₹300 toto fare; three farmers ₹900; pay ₹500 later; cash and stock exact", async () => {
    const toto = await saveVehicleOwner(GA, { name: "Bapi Das", phone: "9830012345" });
    expect(toto.roles).toEqual(["TRANSPORTER"]);
    const cash0 = await cash();

    // 1–2: farmer payable ₹12,500.
    const p1 = await buyWithFare(A.farmer, toto._id, 300n, D1);
    expect(p1.totalPaise).toBe((12_800n * RS).toString());
    const st1 = stateOf(p1, [])!;
    expect(st1.bill.totalPaise).toBe(12_500n * RS);
    expect(st1.duePaise).toBe(12_500n * RS);
    const bal = await godownBalances(GA);
    expect(bal.get(`PARTY:${A.farmer}`)).toBe(-12_500n * RS);

    // 3: the toto owner's ledger gets ₹300.
    let led = (await vehicleOwnerLedger(GA, toto._id))!;
    expect(led.summary).toMatchObject({
      jobs: 1,
      earnedPaise: 300n * RS,
      outstandingPaise: 300n * RS,
    });
    expect(bal.get(`PARTY:${toto._id}`)).toBe(-300n * RS);

    // 7: unpaid fare doesn't reduce cash in hand.
    expect(await cash()).toBe(cash0);

    // 4–5: same owner, other farmers (selected by id: no retyping) → ₹900.
    const fB = await farmer("Farmer B");
    const fC = await farmer("Farmer C");
    await buyWithFare(fB, toto._id, 250n, D2);
    await buyWithFare(fC, toto._id, 350n, D3);
    led = (await vehicleOwnerLedger(GA, toto._id))!;
    expect(led.summary).toMatchObject({
      jobs: 3,
      earnedPaise: 900n * RS,
      paidPaise: 0n,
      outstandingPaise: 900n * RS,
    });
    expect(led.deliveries.map((x) => x.farmer?.name)).toEqual(["Farmer C", "Farmer B", "Ramesh"]);

    // 6 + 8: pay ₹500 later (backdated) → outstanding ₹400; cash drops by ₹500 exactly once.
    const saved = await payVehicleOwner(GA, toto._id, {
      amountPaise: (500n * RS).toString(),
      paymentDate: D3,
      mode: "CASH",
      notes: "half now",
    });
    // Oldest first: ₹300 (fully) + ₹200 of the ₹250, one group.
    expect(saved.map((p) => p.type === "PAYMENT" && p.amountPaise)).toEqual([
      (300n * RS).toString(),
      (200n * RS).toString(),
    ]);
    expect(new Set(saved.map((p) => p.groupId)).size).toBe(1);
    led = (await vehicleOwnerLedger(GA, toto._id))!;
    expect(led.summary).toMatchObject({
      earnedPaise: 900n * RS,
      paidPaise: 500n * RS,
      outstandingPaise: 400n * RS,
    });
    expect(led.deliveries.map((x) => x.state.status)).toEqual(["UNPAID", "PARTIAL", "PAID"]);
    expect(led.payments).toHaveLength(1);
    expect(led.payments[0]).toMatchObject({
      amountPaise: 500n * RS,
      notes: "half now",
      parts: expect.any(Array),
    });
    expect(await cash()).toBe(cash0 - 500n * RS);
    const effects = ((await db().vouchers.toArray()) as Doc[]).flatMap(cashEffects);
    expect(effects.filter((e) => e.account === "CASH")).toHaveLength(2);
    expect(effects.every((e) => e.category === "PAID")).toBe(true);
    // Farmers untouched by the owner's payment.
    expect((await godownBalances(GA)).get(`PARTY:${A.farmer}`)).toBe(-12_500n * RS);

    // 9: purchase value and variety-wise stock = paddy value, fare never added or removed.
    const moves = await db().stockMoves.toArray();
    const key = {
      product: "PADDY" as const,
      location: "WAREHOUSE" as const,
      varietyId: A.variety.SWARNA!,
    };
    expect(qtyAt(moves, key)).toBe(3n * KG512);
    expect(valueAt(moves, key)).toBe(3n * 12_800n * RS);
    // Never an expense.
    expect((await db().ledgerLines.toArray()).some((l) => l.account.startsWith("EXP"))).toBe(false);

    // The owner sits under দেনা in Due & Advance; the summary list agrees.
    const dues = await partyDues(GA);
    expect(dues.find((d) => d.party._id === toto._id)?.category).toBe("payable");
    const sums = await vehicleOwnerSummaries(GA);
    expect(sums.find((s) => s.party._id === toto._id)?.outstandingPaise).toBe(400n * RS);

    // More than he is owed is refused.
    await expect(
      payVehicleOwner(GA, toto._id, {
        amountPaise: (401n * RS).toString(),
        paymentDate: TODAY,
        mode: "CASH",
      }),
    ).rejects.toMatchObject({ code: "OVERPAYMENT" });

    // Reversing that payment puts the ₹500 back, in one step.
    await voidDocs(
      GA,
      saved.map((p) => p._id),
      "wrong",
    );
    led = (await vehicleOwnerLedger(GA, toto._id))!;
    expect(led.summary.outstandingPaise).toBe(900n * RS);
    expect(led.payments[0]?.status).toBe("void");
    expect(await cash()).toBe(cash0);
    await storedEqualsReplay();
  });

  it("fare paid with the purchase: one op group, cash once, fare settled, farmer still owed", async () => {
    const van = await saveVehicleOwner(GA, { name: "Rintu" });
    const cash0 = await cash();
    const id = "0193a1b2-0000-7000-8000-00000000f001";
    const fare = fareOf(van._id, 300n);
    const { bill } = await saveBillWithInitialPayment(
      GA,
      {
        ...purchaseDraft(A.farmer, A.variety.SWARNA!, KG512, 2500n * RS, D1),
        _id: id,
        vehicleFare: fare,
      },
      { amountPaise: (2_500n * RS).toString(), paymentDate: D1, mode: "CASH" },
      {
        extra: [
          farePaymentItem(id, D1, fare, {
            amountPaise: fare.amountPaise,
            paymentDate: D1,
            mode: "CASH",
          }),
        ],
      },
    );
    const ops = (await db().outbox.toArray()).filter((o) => o.entity === "voucher");
    expect(new Set(ops.map((o) => o.opGroup)).size).toBe(1);
    const pays = (await paymentsOf(bill._id)).filter((p) => p.status === "active");
    expect(pays).toHaveLength(2);
    const st = stateOf(bill, pays)!;
    expect(st.duePaise).toBe(10_000n * RS); // 12,500 − 2,500: the fare payment isn't the farmer's
    const led = (await vehicleOwnerLedger(GA, van._id))!;
    expect(led.summary).toMatchObject({ paidPaise: 300n * RS, outstandingPaise: 0n });
    expect(led.payments[0]?.isInitial).toBe(true);
    expect(await cash()).toBe(cash0 - 2_800n * RS);
    // Paid-now can't predate the purchase or exceed the fare.
    expect(() =>
      farePaymentItem(id, D1, fare, {
        amountPaise: fare.amountPaise,
        paymentDate: addDays(D1, -1),
        mode: "CASH",
      }),
    ).toThrow(expect.objectContaining({ code: "PAYMENT_BEFORE_DEAL" }));
    expect(() =>
      farePaymentItem(id, D1, fare, {
        amountPaise: (301n * RS).toString(),
        paymentDate: D1,
        mode: "CASH",
      }),
    ).toThrow(expect.objectContaining({ code: "OVERPAYMENT" }));
  });

  it("a fare can't exceed the purchase or be owed to the farmer", async () => {
    const toto = await saveVehicleOwner(GA, { name: "Bapi" });
    await expect(buyWithFare(A.farmer, toto._id, 12_801n)).rejects.toMatchObject({
      code: "FARE_EXCEEDS_PURCHASE",
    });
    await expect(buyWithFare(A.farmer, A.farmer, 100n)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    // An owner from the other Gola can't be used directly (books are separate).
    const other = await saveVehicleOwner(GB, { name: "Gopal" });
    await expect(buyWithFare(A.farmer, other._id, 100n)).rejects.toMatchObject({
      code: "CROSS_GODOWN_REFERENCE",
    });
  });
});

describe("saved owners", () => {
  it("no duplicates; an existing party can be used; details can be edited", async () => {
    const a = await saveVehicleOwner(GA, { name: "Bapi Das", phone: "9830012345" });
    await expect(saveVehicleOwner(GA, { name: "  bapi das " })).rejects.toMatchObject({
      code: "DUPLICATE_PARTY",
      detail: a._id,
    });
    // Same name, different mobile = a different person.
    const b = await saveVehicleOwner(GA, { name: "Bapi Das", phone: "9830099999" });
    expect(b._id).not.toBe(a._id);
    // The farmer also drives a toto: reuse him (role added, no copy).
    await expect(saveVehicleOwner(GA, { name: "Ramesh" })).rejects.toMatchObject({
      code: "DUPLICATE_PARTY",
      detail: A.farmer,
    });
    const r = await adoptVehicleOwner(GA, A.farmer);
    expect(r.roles).toEqual(["FARMER", "TRANSPORTER"]);
    // Edit keeps the id; renaming onto someone else is refused.
    const e = await saveVehicleOwner(GA, { name: "Bapi Das (Toto)", phone: "9830012345" }, a._id);
    expect(e._id).toBe(a._id);
    expect(e.name).toBe("Bapi Das (Toto)");
    await expect(
      saveVehicleOwner(GA, { name: "Bapi Das", phone: "9830099999" }, a._id),
    ).rejects.toMatchObject({ code: "DUPLICATE_PARTY" });
  });

  it("owners of the other Gola are offered once and brought in with one tap", async () => {
    await saveVehicleOwner(GB, { name: "Gopal Van", phone: "9830011111" });
    let offered = await ownersFromOtherGolas(GA, [GA, GB]);
    expect(offered.map((o) => o.party.name)).toEqual(["Gopal Van"]);
    const copy = await importVehicleOwner(GA, { name: "Gopal Van", phone: "9830011111" });
    expect(copy.godownId).toBe(GA);
    expect(copy.roles).toContain("TRANSPORTER");
    offered = await ownersFromOtherGolas(GA, [GA, GB]);
    expect(offered).toEqual([]);
    // Importing again reuses the copy (no duplicate).
    const again = await importVehicleOwner(GA, { name: "gopal van", phone: "9830011111" });
    expect(again._id).toBe(copy._id);
    // Each Gola keeps its own books.
    await buyWithFare(A.farmer, copy._id, 200n);
    expect((await vehicleOwnerSummaries(GB))[0]?.earnedPaise).toBe(0n);
    expect(B.godown._id).toBe(GB);
  });
});

describe("edits and reversal", () => {
  it("amount can change; owner can't change under payments; reversal takes the fare payments too", async () => {
    const toto = await saveVehicleOwner(GA, { name: "Bapi" });
    const van = await saveVehicleOwner(GA, { name: "Rintu" });
    const p = await buyWithFare(A.farmer, toto._id, 300n);
    const { _id, ...draft } = p;
    // No payments yet: the owner may change.
    let cur = (await saveDoc(GA, { ...draft, vehicleFare: fareOf(van._id, 300n) } as never, {
      id: p._id,
    })) as DocOf<"PURCHASE">;
    expect(cur.vehicleFare?.ownerPartyId).toBe(van._id);
    await payBill(
      GA,
      cur,
      { amountPaise: (100n * RS).toString(), paymentDate: D1, mode: "CASH" },
      {
        sourceId: `${p._id}:fare`,
      },
    );
    // Amount change is fine (the ledgers follow) …
    cur = (await saveDoc(GA, { ...draft, vehicleFare: fareOf(van._id, 400n) } as never, {
      id: p._id,
    })) as DocOf<"PURCHASE">;
    expect((await godownBalances(GA)).get(`PARTY:${van._id}`)).toBe(-300n * RS);
    expect((await godownBalances(GA)).get(`PARTY:${A.farmer}`)).toBe(-12_400n * RS);
    // … but the owner can't change, and the fare can't go, while it has payments.
    await expect(
      saveDoc(GA, { ...draft, vehicleFare: fareOf(toto._id, 400n) } as never, { id: p._id }),
    ).rejects.toMatchObject({ code: "LINKED_PAYMENTS" });
    const { vehicleFare: _f, ...noFare } = draft;
    await expect(saveDoc(GA, noFare as never, { id: p._id })).rejects.toMatchObject({
      code: "LINKED_PAYMENTS",
    });
    // Reversing the purchase reverses the fare payment with it.
    await voidDoc(GA, p._id, "entered twice", { withPayments: true });
    expect((await paymentsOf(p._id)).every((x) => x.status === "void")).toBe(true);
    const bal = await godownBalances(GA);
    expect(bal.get(`PARTY:${van._id}`) ?? 0n).toBe(0n);
    expect(bal.get(`PARTY:${A.farmer}`) ?? 0n).toBe(0n);
    expect((await vehicleOwnerLedger(GA, van._id))!.summary.jobs).toBe(0);
    await storedEqualsReplay();
  });
});

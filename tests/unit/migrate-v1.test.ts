/**
 * v1 → v2 converter (src/domain/legacy/migrateV1.ts): each v1 shape becomes the right v2
 * records with the same party / cash / bank effect. (The full real-data rehearsal is
 * `pnpm migrate:v2 --copy-to-memory`, which reconciles every figure.)
 */
import { describe, expect, it } from "vitest";
import { migrateParty, migrateV1Vouchers } from "@/domain/legacy/migrateV1";
import type { Voucher as V1 } from "@/domain/legacy/v1Vouchers";
import { sumBig } from "@/domain/rounding";
import { billsOf, billState } from "@/domain/v2/payments";
import { deriveAll } from "@/domain/v2/replay";
import type { DocOf, LedgerLineV2 } from "@/domain/v2/schemas";

const G = "GA";
let n = 0;
function v1<T extends V1["type"]>(
  type: T,
  date: string,
  fields: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): V1 {
  n += 1;
  const id = (extra._id as string) ?? `v1-${n}`;
  return {
    _id: id,
    godownId: G,
    rev: 1,
    createdAt: `${date}T0${n % 10}:00:00.000Z`,
    createdBy: "U",
    deviceId: "D",
    updatedAt: `${date}T0${n % 10}:00:00.000Z`,
    updatedBy: "U",
    status: "active",
    number: `RP-A-${type.slice(0, 3)}-${String(n).padStart(6, "0")}`,
    date,
    fy: "2026-27",
    type,
    ...fields,
    ...extra,
  } as unknown as V1;
}
const line = (g: number, rate: number, extra: Record<string, unknown> = {}) => ({
  varietyId: "VAR",
  grossG: String(g),
  netG: String(g),
  ratePaisePerQtl: String(rate),
  amountPaise: String((BigInt(g) * BigInt(rate)) / 100000n),
  ...extra,
});

const bal = (lines: LedgerLineV2[], account: string) =>
  sumBig(
    lines
      .filter((l) => l.account === account)
      .map((l) => BigInt(l.debitPaise) - BigInt(l.creditPaise)),
  );

const conv = (vs: V1[]) => migrateV1Vouchers(vs, { businessId: "B", defaultBankOf: () => "BK" });

describe("v1 → v2", () => {
  it("purchase + paid-now payment → bill + initial Payment(PURCHASE); deductions kept", () => {
    const p = v1("PURCHASE", "2026-11-20", {
      partyId: "F",
      storeAt: "STORE",
      lines: [line(1_000_000, 200_000, { grossG: "1010000", bags: 20, tarePerBagG: "500" })],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      totalPaise: "2000000",
      groupId: "grp1",
      paidNow: { amountPaise: "500000", mode: "CASH" },
    });
    const pay = v1("PAYMENT", "2026-11-20", {
      partyId: "F",
      amountPaise: "500000",
      mode: "CASH",
      purpose: "BILL",
      allocations: [{ voucherId: p._id, amountPaise: "500000" }],
      groupId: "grp1",
    });
    const r = conv([p, pay]);
    const purchase = r.docs.find((d) => d.type === "PURCHASE") as DocOf<"PURCHASE">;
    expect(purchase.weight).toMatchObject({
      totalG: "1010000",
      netG: "1000000",
      deductions: { tareG: "10000" },
    });
    expect(purchase.totalPaise).toBe("2000000");
    const payment = r.docs.find((d) => d.type === "PAYMENT") as DocOf<"PAYMENT">;
    expect(payment).toMatchObject({
      _id: pay._id,
      source: { type: "PURCHASE", id: p._id },
      isInitial: true,
    });
    expect(billState(billsOf(purchase)[0]!, [payment], "2026-11-20").duePaise).toBe(1_500_000n);
  });

  it("expense paid now → Expense + Payment(EXPENSE) on the same date; on credit → Expense only", () => {
    const paid = v1("EXPENSE", "2026-11-20", {
      categoryCode: "LABOUR",
      amountPaise: "50000",
      mode: "UPI",
      bankAccountId: "BK1",
      description: "loading",
    });
    const credit = v1("EXPENSE", "2026-11-21", {
      categoryCode: "LABOUR",
      amountPaise: "30000",
      mode: "CASH",
      description: "hamali",
      onCredit: true,
      payeePartyId: "L",
    });
    const r = conv([paid, credit]);
    expect(r.docs.map((d) => [d.type, d._id])).toEqual([
      ["EXPENSE", paid._id],
      ["PAYMENT", `${paid._id}~pay`],
      ["EXPENSE", credit._id],
    ]);
    const { lines } = deriveAll(r.docs);
    expect(bal(lines, "BANK:BK1")).toBe(-50_000n);
    expect(bal(lines, "PARTY:L")).toBe(-30_000n);
    expect(bal(lines, "EXP:LABOUR")).toBe(80_000n);
  });

  it("BILL payment without allocations is allocated FIFO over the party's open bills; rest = advance", () => {
    const a = v1("PURCHASE", "2026-11-10", {
      partyId: "F",
      storeAt: "STORE",
      lines: [line(100_000, 100_000)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      totalPaise: "100000",
    });
    const b = v1("PURCHASE", "2026-11-11", {
      partyId: "F",
      storeAt: "STORE",
      lines: [line(100_000, 200_000)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      totalPaise: "200000",
    });
    const pay = v1("PAYMENT", "2026-11-12", {
      partyId: "F",
      amountPaise: "350000",
      mode: "CASH",
      purpose: "BILL",
    });
    const r = conv([a, b, pay]);
    const pays = r.docs.filter((d): d is DocOf<"PAYMENT"> => d.type === "PAYMENT");
    expect(pays.map((p) => [p.source.type, p.source.id, p.amountPaise])).toEqual([
      ["PURCHASE", a._id, "100000"],
      ["PURCHASE", b._id, "200000"],
      ["PARTY_ADVANCE", null, "50000"],
    ]);
    expect(new Set(pays.map((p) => p.groupId)).size).toBe(1);
    expect(bal(deriveAll(r.docs).lines, "PARTY:F")).toBe(50_000n);
  });

  it("cheques: cleared → bank on the clearing date; bounced → void; party balance unchanged", () => {
    const ok = v1("RECEIPT", "2026-11-10", {
      partyId: "C",
      amountPaise: "70000",
      mode: "CHEQUE",
      purpose: "ADVANCE",
      chequeNo: "123456",
    });
    const bad = v1("RECEIPT", "2026-11-10", {
      partyId: "C",
      amountPaise: "30000",
      mode: "CHEQUE",
      purpose: "ADVANCE",
    });
    const clear = v1("CONTRA", "2026-11-12", {
      kind: "CHEQUE_CLEAR",
      amountPaise: "70000",
      bankAccountId: "BK9",
      receiptVoucherId: ok._id,
    });
    const bounce = v1("CONTRA", "2026-11-13", {
      kind: "CHEQUE_BOUNCE",
      amountPaise: "30000",
      partyId: "C",
      receiptVoucherId: bad._id,
    });
    const r = conv([ok, bad, clear, bounce]);
    expect(r.docs.filter((d) => d.type === "CONTRA")).toEqual([]);
    const [p1, p2] = r.docs as DocOf<"PAYMENT">[];
    expect(p1).toMatchObject({
      mode: "BANK",
      bankAccountId: "BK9",
      paymentDate: "2026-11-12",
      reference: "123456",
    });
    expect(p2).toMatchObject({ status: "void", voidReason: "CHEQUE_BOUNCED" });
    const { lines } = deriveAll(r.docs);
    expect(bal(lines, "PARTY:C")).toBe(-70_000n);
    expect(bal(lines, "BANK:BK9")).toBe(70_000n);
  });

  it("sale freight and mill settlement keep the party balances", () => {
    const s = v1("SALE", "2026-11-15", {
      partyId: "M",
      vehicleNumber: "WB12AB3456",
      source: "STORE",
      lines: [line(1_000_000, 250_000)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      totalPaise: "2500000",
      duePaise: "2500000",
      settlementStatus: "SETTLED",
      delivery: { amountPaise: "40000", payer: "MILL" },
    });
    const st = v1("MILL_SETTLEMENT", "2026-11-18", {
      saleId: s._id,
      partyId: "M",
      dispatchedNetG: "1000000",
      saleTotalPaise: "2500000",
      millReceivedGrossG: "990000",
      millDeductions: [],
      millNetG: "990000",
      finalRatePaisePerQtl: "250000",
      finalAmountPaise: "2475000",
      differencePaise: "-25000",
      shortageG: "10000",
    });
    const r = conv([s, st]);
    expect(r.docs.map((d) => d.type)).toEqual(["SALE", "EXPENSE", "SECOND_PARTY"]);
    const { lines } = deriveAll(r.docs);
    // v1: sale 25,000.00 − freight deducted by the mill 400.00 − settlement cut 250.00.
    expect(bal(lines, "PARTY:M")).toBe(2_500_000n - 40_000n - 25_000n);
  });

  it("roles map to v2 codes", () => {
    expect(
      migrateParty(
        {
          _id: "p",
          roles: ["farmer", "party", "pump", "godown"],
          village: "Kalna",
          district: "Bardhaman",
        },
        "B",
      ),
    ).toMatchObject({
      businessId: "B",
      roles: ["FARMER", "CUSTOMER", "SECOND_PARTY", "SUPPLIER", "GOLA"],
      address: "Kalna, Bardhaman",
    });
  });
});

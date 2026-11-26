/**
 * v2 posting rules per event (requirement_v2 §8 table, §9.2), dues/FIFO and cashbook classes.
 */
import { describe, expect, it } from "vitest";
import { DomainError } from "@/domain/errors";
import { sumBig } from "@/domain/rounding";
import { cashEffects } from "@/domain/v2/cashbook";
import { postDoc } from "@/domain/v2/post";
import { validateDocRules, verifyDoc } from "@/domain/v2/recompute";
import { allocateFifo, billsOf, billState } from "@/domain/v2/payments";
import { deriveAll } from "@/domain/v2/replay";
import type { Doc } from "@/domain/v2/schemas";
import { qtyAt } from "@/domain/v2/stock";
import { bags, doc, manual, opening, payment, purchase, QTL, RS, sale } from "../helpers/v2";

const D = "2026-11-20";

function balanced(d: Doc) {
  const { lines } = postDoc(d);
  expect(sumBig(lines.map((l) => l.debit))).toBe(sumBig(lines.map((l) => l.credit)));
  return lines;
}

const acct = (lines: ReturnType<typeof balanced>, account: string) =>
  sumBig(lines.filter((l) => l.account === account).map((l) => l.debit - l.credit));

describe("posting per event", () => {
  it("purchase: Dr STOCK_PADDY / Cr PARTY, no cash; direct delivery goes to TRANSIT", () => {
    const p = purchase(D, "F1", "V1", 10n * QTL, 2000n * RS);
    const lines = balanced(p);
    expect(acct(lines, "STOCK_PADDY")).toBe(20_000n * RS);
    expect(acct(lines, "PARTY:F1")).toBe(-20_000n * RS);
    expect(acct(lines, "CASH")).toBe(0n);
    const t = purchase(
      D,
      "F1",
      "V1",
      10n * QTL,
      2000n * RS,
      { groupId: "G1" },
      { storeAt: "TRANSIT" },
    );
    expect(postDoc(t).moves[0]).toMatchObject({ location: "TRANSIT", groupId: "G1" });
  });

  it("direct delivery: the linked sale takes exactly the purchase cost out of TRANSIT", () => {
    const t = purchase(
      D,
      "F1",
      "V1",
      10n * QTL,
      2000n * RS,
      { groupId: "G1" },
      { storeAt: "TRANSIT" },
    );
    const s = sale(
      D,
      "C1",
      "V1",
      10n * QTL,
      2300n * RS,
      { groupId: "G1", createdAt: `${D}T11:00:00.000Z` },
      { source: "TRANSIT" },
    );
    const { lines, moves } = deriveAll([t, s]);
    expect(qtyAt(moves, { product: "PADDY", location: "TRANSIT" })).toBe(0n);
    expect(qtyAt(moves, { product: "PADDY", location: "WAREHOUSE" })).toBe(0n);
    const cogs = sumBig(lines.filter((l) => l.account === "COGS").map((l) => BigInt(l.debitPaise)));
    expect(cogs).toBe(20_000n * RS);
  });

  it("rice sale moves only rice stock", () => {
    const r = sale(D, "C1", "RV", 2n * QTL, 3000n * RS, {}, { product: "RICE" });
    const { moves } = postDoc(r);
    expect(moves).toEqual([
      { product: "RICE", location: "WAREHOUSE", varietyId: "RV", qtyG: -2n * QTL, valuePaise: 0n },
    ]);
  });

  it("mill dispatch: the mill owes us (Dr PARTY / Cr MILL_SALES), cost to COGS, no cash", () => {
    const op = opening(D, [
      {
        kind: "STOCK",
        product: "PADDY",
        location: "WAREHOUSE",
        varietyId: "V1",
        qtyG: (30n * QTL).toString(),
        amountPaise: (60_000n * RS).toString(),
      },
    ]);
    const di = doc(
      "MILL_DISPATCH",
      D,
      {
        // A v2.0 type is kept on old records but ignored by posting.
        dispatchType: "CONSIGNMENT",
        millPartyId: "M1",
        dispatchDate: D,
        varietyId: "V1",
        weight: manual(20n * QTL),
        ratePaisePerQtl: (2500n * RS).toString(),
        totalValuePaise: "0",
      },
      { createdAt: `${D}T11:00:00.000Z` },
    );
    expect(di.totalValuePaise).toBe((50_000n * RS).toString());
    const diLines = balanced(di);
    expect(acct(diLines, "PARTY:M1")).toBe(50_000n * RS);
    expect(acct(diLines, "MILL_SALES")).toBe(-50_000n * RS);
    expect(acct(diLines, "SALES")).toBe(0n);
    expect(acct(diLines, "CASH")).toBe(0n);
    expect(cashEffects(di)).toEqual([]);
    const col = payment(
      D,
      "IN",
      10_000n * RS,
      { type: "MILL_DISPATCH", id: di._id },
      { partyId: "M1" },
    );
    expect(acct(balanced(col), "CASH")).toBe(10_000n * RS);
    // Final settlement: 18 qtl accepted at 2,550, 2 qtl short → cut 50,000 − 45,900 = 4,100.
    const st = doc("MILL_SETTLEMENT", "2026-11-22", {
      dispatchId: di._id,
      millPartyId: "M1",
      varietyId: "V1",
      dispatchRatePaisePerQtl: di.ratePaisePerQtl,
      transactionDate: "2026-11-22",
      acceptedG: (18n * QTL).toString(),
      finalRatePaisePerQtl: (2550n * RS).toString(),
      deductionPaise: "0",
      shortfallG: (2n * QTL).toString(),
      shortfallReason: "WEIGHING",
      billedPaise: "0",
      finalValuePaise: "0",
      adjustmentPaise: "0",
    });
    expect(st.adjustmentPaise).toBe((4_100n * RS).toString());
    const { lines, moves } = deriveAll([op, di, col, st]);
    expect(qtyAt(moves, { product: "PADDY", location: "MILL" })).toBe(0n);
    expect(qtyAt(moves, { product: "PADDY", location: "WAREHOUSE" })).toBe(10n * QTL);
    const sum = (a: string) =>
      sumBig(
        lines
          .filter((l) => l.account === a)
          .map((l) => BigInt(l.debitPaise) - BigInt(l.creditPaise)),
      );
    expect(sum("PARTY:M1")).toBe((45_900n - 10_000n) * RS);
    expect(sum("MILL_DEDUCTION")).toBe(4_100n * RS);
    // Cost of the 20 qtl at average (60,000 / 30 qtl = 2,000 per qtl), once, at dispatch.
    expect(sum("COGS")).toBe(40_000n * RS);
    // No sale is ever created.
    expect(lines.some((l) => l.account === "SALES")).toBe(false);
  });
  it("expense: with a party → PARTY; without → EXP_PAYABLE; payments clear them", () => {
    const e1 = doc("EXPENSE", D, {
      title: "লেবার",
      categoryCode: "LABOUR",
      amountPaise: "50000",
      expenseDate: D,
      partyId: "L1",
    });
    expect(acct(balanced(e1), "PARTY:L1")).toBe(-50_000n);
    const e2 = doc("EXPENSE", D, {
      title: "চা",
      categoryCode: "OFFICE",
      amountPaise: "5000",
      expenseDate: D,
    });
    expect(acct(balanced(e2), "EXP_PAYABLE")).toBe(-5_000n);
    const p = payment(D, "OUT", 5_000n, { type: "EXPENSE", id: e2._id });
    expect(acct(balanced(p), "EXP_PAYABLE")).toBe(5_000n);
  });

  it("trip: income to the customer; costs to the payee or EXP_PAYABLE; net profit", () => {
    const t = doc("TRIP", D, {
      transactionDate: D,
      customerPartyId: "VC1",
      vehicleId: "VH1",
      loadingLocation: "বর্ধমান",
      destination: "কলকাতা",
      qtyG: (100n * QTL).toString(),
      rateMode: "PER_QTL",
      ratePaise: (80n * RS).toString(),
      totalIncomePaise: "0",
      costs: [
        { id: "c1", kind: "DRIVER", amountPaise: (1_000n * RS).toString(), partyId: "DR1" },
        { id: "c2", kind: "DIESEL", amountPaise: (3_000n * RS).toString(), litresMl: "30000" },
        { id: "c3", kind: "OTHER", amountPaise: (500n * RS).toString() },
      ],
    });
    expect(t.totalIncomePaise).toBe((8_000n * RS).toString());
    const lines = balanced(t);
    expect(acct(lines, "PARTY:VC1")).toBe(8_000n * RS);
    expect(acct(lines, "VEH_INCOME:VH1")).toBe(-8_000n * RS);
    expect(acct(lines, "PARTY:DR1")).toBe(-1_000n * RS);
    expect(acct(lines, "EXP_PAYABLE")).toBe(-3_500n * RS);
    const bills = billsOf(t);
    expect(bills.map((b) => b.sourceType)).toEqual([
      "VEHICLE_TRIP",
      "VEHICLE_COST",
      "VEHICLE_COST",
      "VEHICLE_COST",
    ]);
    expect(bills[2]!.sourceId).toBe(`${t._id}:c2`);
    // Net profit = income − driver − diesel − other.
    const profit = -sumBig(
      lines.filter((l) => l.account.startsWith("VEH_")).map((l) => l.debit - l.credit),
    );
    expect(profit).toBe(3_500n * RS);
  });

  it("second party entries post against SP_CLEARING", () => {
    const we = doc("SECOND_PARTY", D, {
      partyId: "S1",
      transactionDate: D,
      kind: "WE_OWE",
      amountPaise: "100000",
    });
    expect(acct(balanced(we), "PARTY:S1")).toBe(-100_000n);
    const they = doc("SECOND_PARTY", D, {
      partyId: "S1",
      transactionDate: D,
      kind: "THEY_OWE",
      amountPaise: "40000",
    });
    expect(acct(balanced(they), "PARTY:S1")).toBe(40_000n);
  });

  it("contra and capital/drawings", () => {
    const dep = doc("CONTRA", D, {
      transactionDate: D,
      kind: "DEPOSIT",
      bankAccountId: "BK1",
      amountPaise: "100",
    });
    expect(acct(balanced(dep), "CASH")).toBe(-100n);
    expect(cashEffects(dep).map((e) => [e.account, e.category])).toEqual([
      ["CASH", "PAID"],
      ["BANK:BK1", "RECEIVED"],
    ]);
    const wd = doc("CONTRA", D, {
      transactionDate: D,
      kind: "WITHDRAW",
      bankAccountId: "BK1",
      amountPaise: "100",
    });
    expect(cashEffects(wd)[0]).toMatchObject({ account: "CASH", category: "RECEIVED" });
    const dr = doc("CONTRA", D, { transactionDate: D, kind: "DRAWINGS", amountPaise: "100" });
    expect(acct(balanced(dr), "DRAWINGS")).toBe(100n);
  });

  it("stock adjustment: shortage at average cost, excess at average cost", () => {
    const op = opening(D, [
      {
        kind: "STOCK",
        product: "PADDY",
        location: "WAREHOUSE",
        varietyId: "V1",
        qtyG: (10n * QTL).toString(),
        amountPaise: (20_000n * RS).toString(),
      },
    ]);
    const adj = doc(
      "STOCK_ADJUST",
      D,
      {
        transactionDate: D,
        lines: [
          {
            product: "PADDY",
            location: "WAREHOUSE",
            varietyId: "V1",
            qtyG: (-QTL).toString(),
            reason: "DRYING",
            systemG: (10n * QTL).toString(),
            countedG: (9n * QTL).toString(),
          },
        ],
      },
      { createdAt: `${D}T12:00:00.000Z` },
    );
    const { lines, moves } = deriveAll([op, adj]);
    expect(qtyAt(moves, { product: "PADDY" })).toBe(9n * QTL);
    expect(
      sumBig(lines.filter((l) => l.account === "STOCK_ADJ").map((l) => BigInt(l.debitPaise))),
    ).toBe(2_000n * RS);
  });

  it("load khata entries post nothing", () => {
    const l = doc("LOAD", D, {
      transactionDate: D,
      fromPartyId: "F1",
      destinationMillId: "M1",
      varietyId: "V1",
      weight: bags(50_000n, 51_000n),
      ratePaisePerQtl: (2200n * RS).toString(),
      totalPaise: "0",
      vehicleNumber: "WB12AB3456",
    });
    expect(l.weight.totalG).toBe("101000");
    expect(postDoc(l)).toEqual({ lines: [], moves: [] });
  });

  it("void posts nothing; payments without a party need an expense source", () => {
    const p = purchase(D, "F1", "V1", QTL, 2000n * RS, { status: "void" });
    expect(postDoc(p)).toEqual({ lines: [], moves: [] });
    const bad = payment(D, "OUT", 100n, { type: "PURCHASE", id: "x" });
    expect(() => postDoc(bad)).toThrow(DomainError);
  });
});

describe("dues", () => {
  it("statuses: paid / partial / unpaid, overdue an extra flag (D54)", () => {
    const p = purchase(D, "F1", "V1", QTL, 1000n * RS, {}, { dueDate: "2026-11-22" });
    const [b] = billsOf(p);
    expect(billState(b!, [], "2026-11-21")).toMatchObject({ status: "UNPAID", overdue: false });
    // On the due date itself: not overdue yet.
    expect(billState(b!, [], "2026-11-22")).toMatchObject({ status: "UNPAID", overdue: false });
    expect(billState(b!, [], "2026-11-25")).toMatchObject({
      status: "UNPAID",
      overdue: true,
      overdueDays: 3,
    });
    const half = payment(D, "OUT", 500n * RS, { type: "PURCHASE", id: p._id }, { partyId: "F1" });
    expect(billState(b!, [half], "2026-11-21").status).toBe("PARTIAL");
    // Partly paid AND overdue: both, the status is not replaced.
    expect(billState(b!, [half], "2026-11-25")).toMatchObject({ status: "PARTIAL", overdue: true });
    const rest = payment(D, "OUT", 500n * RS, { type: "PURCHASE", id: p._id }, { partyId: "F1" });
    // Fully paid is never overdue.
    expect(billState(b!, [half, rest], "2026-11-25")).toMatchObject({
      status: "PAID",
      overdue: false,
      overdueDays: 0,
    });
    // No due date = never overdue.
    const [noDue] = billsOf(purchase(D, "F1", "V1", QTL, 1000n * RS));
    expect(billState(noDue!, [], "2027-06-01")).toMatchObject({ status: "UNPAID", overdue: false });
    const voided = { ...rest, status: "void" as const };
    expect(billState(b!, [half, voided], "2026-11-21").duePaise).toBe(500n * RS);
  });

  it("FIFO allocation pays the oldest bill first; the rest is an advance", () => {
    const a = purchase("2026-11-10", "F1", "V1", QTL, 1000n * RS);
    const b = purchase("2026-11-12", "F1", "V1", QTL, 2000n * RS);
    const states = [b, a].map((p) => billState(billsOf(p)[0]!, [], D));
    const r = allocateFifo(2_500n * RS, states);
    expect(r.allocations.map((x) => [x.sourceId, x.amountPaise])).toEqual([
      [a._id, 1_000n * RS],
      [b._id, 1_500n * RS],
    ]);
    expect(r.advancePaise).toBe(0n);
    expect(allocateFifo(4_000n * RS, states).advancePaise).toBe(1_000n * RS);
  });

  it("opening party balances are bills settled by OPENING_DUE payments", () => {
    const op = opening(D, [{ kind: "PARTY", refId: "F1", amountPaise: "-70000" }]);
    const [b] = billsOf(op);
    expect(b).toMatchObject({
      sourceType: "OPENING_DUE",
      direction: "OUT",
      totalPaise: 70_000n,
      partyId: "F1",
    });
  });
});

describe("rules and verification", () => {
  it("detects tampered totals (CALC_MISMATCH paths)", () => {
    const p = purchase(D, "F1", "V1", 10n * QTL, 2000n * RS);
    expect(verifyDoc(p)).toEqual([]);
    expect(verifyDoc({ ...p, totalPaise: "1" })).toContain("totalPaise");
    expect(verifyDoc({ ...p, weight: { ...p.weight, netG: "1" } })).toContain("weight.netG");
  });

  it("blocks future business dates and farmer payments as expenses", () => {
    const p = purchase("2026-11-26", "F1", "V1", QTL, 1000n * RS);
    expect(() => validateDocRules(p, "2026-11-25")).toThrow("FUTURE_DATE");
    const e = doc("EXPENSE", D, {
      title: "x",
      categoryCode: "FARMER_PAYMENT",
      amountPaise: "1",
      expenseDate: D,
    });
    expect(() => validateDocRules(e, D)).toThrow("CATEGORY_IS_PAYMENT");
    const bank = payment(
      D,
      "OUT",
      1n,
      { type: "PURCHASE", id: "x" },
      { partyId: "F1", mode: "UPI" },
    );
    expect(() => validateDocRules(bank, D)).toThrow("BANK_ACCOUNT_REQUIRED");
    const dueLater = purchase(D, "F1", "V1", QTL, 1000n * RS, {}, { dueDate: "2027-01-01" });
    expect(() => validateDocRules(dueLater, D)).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { agingBucketOf, agingBuckets } from "@/domain/aging";
import { allocateFifo, settleBills } from "@/domain/allocation";
import { recomputeVoucher, validateVoucherRules, verifyVoucher } from "@/domain/calc/recompute";
import { countDenominations } from "@/domain/calc/settlement";
import { tripProfit } from "@/domain/calc/trip";
import { estimatedSaleProfit } from "@/domain/calc/sale";
import { loadMargin } from "@/domain/calc/load";
import { formatVehicleNumber, normalizeVehicleNumber } from "@/domain/schemas/masters";
import { assertGodownUnchanged, checkSameGodown, collectRefs } from "@/domain/scope";
import { seedChartOfAccounts, accountType } from "@/domain/posting/accounts";
import { line, mk } from "../helpers/factory";

describe("FIFO allocation & bill status", () => {
  const bills = [
    { voucherId: "B2", date: "2026-11-02", number: "2", totalPaise: 5000n },
    { voucherId: "B1", date: "2026-11-01", number: "1", totalPaise: 3000n },
    { voucherId: "B3", date: "2026-11-03", number: "3", totalPaise: 2000n },
  ];

  it("allocates to oldest bills first; leftover is an advance", () => {
    const r = settleBills(bills, [{ voucherId: "P1", date: "2026-11-05", amountPaise: 6000n }]);
    expect(r.bills.map((b) => [b.voucherId, b.paidPaise, b.status])).toEqual([
      ["B1", 3000n, "SETTLED"],
      ["B2", 3000n, "PARTIAL"],
      ["B3", 0n, "OPEN"],
    ]);
    expect(r.unallocatedPaise).toBe(0n);
    const over = settleBills(bills, [
      { voucherId: "P1", date: "2026-11-05", amountPaise: 11_000n },
    ]);
    expect(over.unallocatedPaise).toBe(1000n);
  });

  it("manual allocations apply first, remainder FIFO", () => {
    const r = settleBills(bills, [
      {
        voucherId: "P1",
        date: "2026-11-05",
        amountPaise: 4000n,
        allocations: [{ voucherId: "B3", amountPaise: 2500n }],
      },
    ]);
    // B3 capped at 2000, remaining 2000 → FIFO to B1
    expect(r.bills.find((b) => b.voucherId === "B3")?.status).toBe("SETTLED");
    expect(r.bills.find((b) => b.voucherId === "B1")?.paidPaise).toBe(2000n);
  });

  it("allocateFifo", () => {
    expect(
      allocateFifo(
        [
          { voucherId: "a", outstandingPaise: 5n },
          { voucherId: "b", outstandingPaise: 5n },
        ],
        7n,
      ),
    ).toEqual({
      allocations: [
        { voucherId: "a", amountPaise: 5n },
        { voucherId: "b", amountPaise: 2n },
      ],
      unallocated: 0n,
    });
  });
});

describe("aging", () => {
  it("buckets", () => {
    expect(agingBucketOf("2026-11-01", "2026-12-01")).toBe("D0_30");
    expect(agingBucketOf("2026-10-01", "2026-12-01")).toBe("D61_90");
    expect(agingBucketOf("2026-01-01", "2026-12-01")).toBe("D90_PLUS");
    expect(
      agingBuckets(
        [
          { date: "2026-11-20", outstandingPaise: 100n },
          { date: "2026-10-15", outstandingPaise: 200n },
          { date: "2026-06-01", outstandingPaise: 300n },
        ],
        "2026-11-23",
      ),
    ).toEqual({ D0_30: 100n, D31_60: 200n, D61_90: 0n, D90_PLUS: 300n });
  });
});

describe("godown scope", () => {
  const v = mk(
    "SALE",
    {
      partyId: "P_A",
      vehicleNumber: "X",
      source: "STORE",
      lines: [line("VAR_A", 100_000n, 200_000n)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      delivery: { fixedPaise: "100", amountPaise: "0", payer: "US", transporterPartyId: "T_B" },
      totalPaise: "0",
      duePaise: "0",
      settlementStatus: "PENDING",
    },
    { godownId: "GA" },
  );

  it("collects every reference", () => {
    expect(collectRefs(v)).toEqual([
      { kind: "party", id: "P_A" },
      { kind: "variety", id: "VAR_A" },
      { kind: "party", id: "T_B" },
    ]);
  });

  it("rejects a reference to another godown's record", () => {
    const owner: Record<string, string> = { P_A: "GA", VAR_A: "GA", T_B: "GB" };
    expect(checkSameGodown(v, (r) => owner[r.id])).toEqual({
      ok: false,
      code: "CROSS_GODOWN_REFERENCE",
      ref: { kind: "party", id: "T_B" },
    });
    expect(checkSameGodown(v, (r) => (r.id === "T_B" ? undefined : "GA"))).toMatchObject({
      code: "INVALID_REFERENCE",
    });
    expect(checkSameGodown(v, () => "GA")).toEqual({ ok: true });
  });

  it("godownId is immutable", () => {
    expect(() => assertGodownUnchanged({ godownId: "GA" }, { godownId: "GB" })).toThrow(
      /GODOWN_IMMUTABLE/,
    );
  });
});

describe("recompute / verify / rules", () => {
  it("verifyVoucher flags tampered derived fields (CALC_MISMATCH paths)", () => {
    const p = mk("PURCHASE", {
      partyId: "F1",
      storeAt: "STORE",
      lines: [line("V1", 1_000_000n, 200_000n)],
      charges: [],
      roundToRupee: true,
      roundOffPaise: "0",
      totalPaise: "0",
    });
    expect(verifyVoucher(p)).toEqual([]);
    const tampered = { ...p, totalPaise: "1", lines: [{ ...p.lines[0]!, netG: "999999" }] };
    expect(verifyVoucher(tampered)).toEqual(["lines.0.netG", "totalPaise"]);
  });

  it("recompute is idempotent", () => {
    const s = mk("SALE", {
      partyId: "M",
      vehicleNumber: "X",
      source: "STORE",
      lines: [line("V", 123_456n, 211_111n, { bags: 3, tarePerBagG: 333n, moistureBps: 175 })],
      charges: [{ label: "x", kind: "add", amountPaise: "99" }],
      roundToRupee: true,
      roundOffPaise: "0",
      totalPaise: "0",
      duePaise: "0",
      settlementStatus: "PENDING",
    });
    expect(recomputeVoucher(s)).toEqual(s);
  });

  it("business rules", () => {
    const upi = mk("PAYMENT", { partyId: "F", amountPaise: "1", mode: "UPI", purpose: "BILL" });
    expect(validateVoucherRules(upi)).toEqual(["BANK_ACCOUNT_REQUIRED"]);
    const dc = mk("DAY_CLOSE", {
      expectedCashPaise: "100",
      countedCashPaise: "90",
      differencePaise: "0",
    });
    expect(validateVoucherRules(dc)).toEqual(["NOTE_REQUIRED"]);
    const trip = mk("TRIP", {
      vehicleId: "V",
      loadingPlace: "a",
      unloadingPlace: "b",
      rateMode: "FIXED",
      ratePaise: "100",
      freightPaise: "0",
      expenses: [],
      duePaise: "0",
    });
    expect(validateVoucherRules(trip)).toEqual(["HIRER_REQUIRED"]);
  });
});

describe("misc calcs", () => {
  it("denominations", () => {
    expect(countDenominations({ "500": 3, "100": 2, coinsPaise: 550 })).toBe(170_550n);
  });
  it("trip profit, load margin, sale profit", () => {
    const trip = mk("TRIP", {
      vehicleId: "V",
      hirerPartyId: "H",
      loadingPlace: "a",
      unloadingPlace: "b",
      rateMode: "FIXED",
      ratePaise: "100000",
      freightPaise: "0",
      expenses: [{ kind: "DIESEL", amountPaise: "30000", mode: "CASH" }],
      duePaise: "0",
    });
    expect(tripProfit(trip)).toBe(70_000n);
    const load = mk("LOAD", {
      mode: "OWN_TRADE",
      fromPartyId: "F",
      toMillPartyId: "M",
      vehicleNumber: "X",
      varietyId: "V",
      grossG: "1000000",
      netG: "1000000",
      partySellRatePaisePerQtl: "200000",
      millRatePaisePerQtl: "210000",
      totalAmountPaise: "0",
    });
    expect(loadMargin(load)).toBe(100_000n);
    const sale = mk("SALE", {
      partyId: "M",
      vehicleNumber: "X",
      source: "STORE",
      lines: [line("V", 1_000_000n, 210_000n)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      delivery: { fixedPaise: "20000", amountPaise: "0", payer: "US", transporterPartyId: "T" },
      loading: { fixedPaise: "5000", amountPaise: "0", payTo: "CASH_NOW" },
      totalPaise: "0",
      duePaise: "0",
      settlementStatus: "PENDING",
    });
    expect(estimatedSaleProfit(sale, 2_000_000n)).toBe(75_000n);
  });
  it("vehicle numbers", () => {
    expect(normalizeVehicleNumber("wb 12 ab 3456")).toBe("WB12AB3456");
    expect(formatVehicleNumber("WB12AB3456")).toBe("WB 12 AB 3456");
  });
  it("chart of accounts is per godown", () => {
    const a = seedChartOfAccounts("GA");
    expect(a.every((x) => x.godownId === "GA")).toBe(true);
    expect(a.find((x) => x.key === "CASH")?.i18nKey).toBe("account.CASH");
    expect(accountType("PARTY:x")).toBe("party");
    expect(accountType("VEH_EXP:v:DIESEL")).toBe("expense");
  });
});

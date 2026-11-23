/**
 * Golden test cases G1–G10 (requirement.md §6.4) — exactly as written in the spec.
 */
import { describe, expect, it } from "vitest";
import { computeBill, computeLine, computeDeductions } from "@/domain/calc/trade";
import { saleLinkedDrafts, saleSummary } from "@/domain/calc/sale";
import { amountForWeight, formatPaise, parseRupees } from "@/domain/money";
import { accountBalance, partyBalance, replay, toLedgerLineDocs } from "@/domain/posting";
import { divRoundHalfUp } from "@/domain/rounding";
import { line, mk } from "../helpers/factory";

describe("golden cases (spec §6.4)", () => {
  it("G1: 25 bags, gross 1,250 kg, tare 0.5 kg/bag, dhalta 2 kg/qtl → net 1,212.5 kg, ₹26,068.75", () => {
    const r = computeLine({
      bags: 25,
      grossG: 1_250_000n,
      tarePerBagG: 500n,
      dhaltaMode: "PER_QUINTAL",
      dhaltaValueG: 2_000n,
      moistureBps: 0n,
      ratePaisePerQtl: 215_000n,
    });
    expect(r.tareG).toBe(12_500n);
    expect(r.dhaltaG).toBe(25_000n);
    expect(r.netG).toBe(1_212_500n);
    expect(r.amountPaise).toBe(2_606_875n);
  });

  it("G2: net 987.333 kg × ₹2,183.50 = ₹21,558.42", () => {
    expect(amountForWeight(987_333n, 218_350n)).toBe(2_155_842n);
  });

  it("G3: gross 1,000 kg, moisture 2% → moisture 20 kg, net 980 kg", () => {
    const r = computeDeductions({ grossG: 1_000_000n, tarePerBagG: 0n, moistureBps: 200n });
    expect(r.moistureG).toBe(20_000n);
    expect(r.netG).toBe(980_000n);
  });

  it("G4: net 120 q, delivery ₹40/q, vehicle advance ₹2,000 → freight ₹4,800, due to vehicle ₹2,800", () => {
    const sale = mk("SALE", {
      partyId: "MILL1",
      vehicleNumber: "WB12AB3456",
      source: "STORE",
      lines: [line("VAR1", 12_000_000n, 200_000n)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      delivery: {
        ratePaisePerQtl: "4000",
        amountPaise: "0",
        payer: "US",
        transporterPartyId: "VEH1",
      },
      vehicleAdvance: { amountPaise: "200000", mode: "CASH" },
      totalPaise: "0",
      duePaise: "0",
      settlementStatus: "PENDING",
    });
    expect(sale.delivery?.amountPaise).toBe("480000");
    expect(saleSummary(sale).dueToVehicle).toBe(280_000n);

    // Same answer from the ledger: freight posted by the sale, advance by the linked PAYMENT.
    const adv = saleLinkedDrafts(sale).vehicleAdvancePayment!;
    const payment = mk("PAYMENT", { ...adv, groupId: undefined, season: undefined });
    const { results } = replay([sale, payment]);
    const lines = results.flatMap((r) => toLedgerLineDocs(r.voucher, r.lines));
    expect(partyBalance(lines, "VEH1")).toBe(-280_000n); // we owe the vehicle ₹2,800
  });

  it("G5: opening cash ₹50,000 − farmer ₹20,000 − labour ₹1,200 + mill cash via driver ₹75,000 = ₹1,03,800", () => {
    const opening = mk(
      "OPENING",
      { items: [{ kind: "CASH", amountPaise: "5000000" }] },
      { createdAt: "2026-11-23T01:00:00.000Z" },
    );
    const payFarmer = mk("PAYMENT", {
      partyId: "F1",
      amountPaise: "2000000",
      mode: "CASH",
      purpose: "BILL",
    });
    const labour = mk("EXPENSE", {
      categoryCode: "LABOUR",
      amountPaise: "120000",
      mode: "CASH",
      description: "loading",
    });
    const millCash = mk("RECEIPT", {
      partyId: "MILL1",
      amountPaise: "7500000",
      mode: "CASH",
      purpose: "BILL",
      cashVia: { vehicleNumber: "WB12AB3456" },
    });
    const { results } = replay([opening, payFarmer, labour, millCash]);
    const lines = results.flatMap((r) => toLedgerLineDocs(r.voucher, r.lines));
    const cash = accountBalance(lines, "CASH");
    expect(cash).toBe(10_380_000n);
    expect(formatPaise(cash)).toBe("₹1,03,800.00");
  });

  it("G6: subtotal ₹26,068.75 rounded to rupee → +₹0.25, total ₹26,069.00", () => {
    const b = computeBill([2_606_875n], [], true);
    expect(b.roundOff).toBe(25n);
    expect(b.total).toBe(2_606_900n);
  });

  it("G7: subtotal ₹21,558.42 rounded to rupee → −₹0.42, total ₹21,558.00", () => {
    const b = computeBill([2_155_842n], [], true);
    expect(b.roundOff).toBe(-42n);
    expect(b.total).toBe(2_155_800n);
  });

  it("G8: divRoundHalfUp(−5, 10) = −1 (half away from zero)", () => {
    expect(divRoundHalfUp(-5n, 10n)).toBe(-1n);
    expect(divRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divRoundHalfUp(-4n, 10n)).toBe(0n);
    expect(divRoundHalfUp(15n, -10n)).toBe(-2n);
  });

  it("G9: parse ২৬,০৬৮.৭৫ and 26,068.75; format in bn and en digits", () => {
    expect(parseRupees("২৬,০৬৮.৭৫")).toEqual({ ok: true, value: 2_606_875n });
    expect(parseRupees("26,068.75")).toEqual({ ok: true, value: 2_606_875n });
    expect(formatPaise(2_606_875n, { digits: "bn" })).toBe("₹২৬,০৬৮.৭৫");
    expect(formatPaise(2_606_875n, { digits: "en" })).toBe("₹26,068.75");
  });

  it("G10: payment in godown A changes only A's cash; all-godowns total is the sum", () => {
    const openA = mk(
      "OPENING",
      { items: [{ kind: "CASH", amountPaise: "5000000" }] },
      { godownId: "GA", createdAt: "2026-11-23T01:00:00.000Z" },
    );
    const openB = mk(
      "OPENING",
      { items: [{ kind: "CASH", amountPaise: "3000000" }] },
      { godownId: "GB", createdAt: "2026-11-23T01:00:00.000Z" },
    );
    const payA = mk(
      "PAYMENT",
      { partyId: "FA", amountPaise: "500000", mode: "CASH", purpose: "BILL" },
      { godownId: "GA" },
    );
    const { results } = replay([openA, openB, payA]);
    const lines = results.flatMap((r) => toLedgerLineDocs(r.voucher, r.lines));
    const cashOf = (g: string) =>
      accountBalance(
        lines.filter((l) => l.godownId === g),
        "CASH",
      );
    expect(cashOf("GA")).toBe(4_500_000n);
    expect(cashOf("GB")).toBe(3_000_000n);
    expect(cashOf("GA") + cashOf("GB")).toBe(7_500_000n);
  });
});

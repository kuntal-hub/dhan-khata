/**
 * Table-driven postLedger / postStock expectations for EVERY voucher type (spec §7.2, §19.1).
 */
import { describe, expect, it } from "vitest";
import { loadLinkedDrafts } from "@/domain/calc/load";
import { paidNowPaymentDraft } from "@/domain/calc/purchase";
import { saleLinkedDrafts } from "@/domain/calc/sale";
import { DomainError } from "@/domain/errors";
import {
  ACC,
  EMPTY_CONTEXT,
  post,
  postLedger,
  postStock,
  replay,
  toLedgerLineDocs,
  trialBalance,
  type PostedLine,
  type PostingContext,
} from "@/domain/posting";
import type { Voucher } from "@/domain/schemas/vouchers";
import { line, mk } from "../helpers/factory";

/** Compact view of lines: "Dr ACC 100" / "Cr ACC 100". */
function view(lines: PostedLine[]): string[] {
  return lines.map((l) =>
    l.debit > 0n ? `Dr ${l.account} ${l.debit}` : `Cr ${l.account} ${l.credit}`,
  );
}

function ctxWith(positions: Record<string, { qtyG: bigint; valuePaise: bigint }>): PostingContext {
  return {
    position: (varietyId, location, groupId) =>
      positions[`${varietyId}|${location}|${location === "TRANSIT" ? (groupId ?? "") : ""}`] ?? {
        qtyG: 0n,
        valuePaise: 0n,
      },
  };
}

function expectBalanced(v: Voucher, ctx: PostingContext = EMPTY_CONTEXT) {
  const tb = trialBalance(postLedger(v, ctx));
  expect(tb.balanced).toBe(true);
}

const purchase = () =>
  mk("PURCHASE", {
    partyId: "F1",
    storeAt: "STORE",
    lines: [line("V1", 1_000_000n, 200_000n), line("V2", 500_000n, 300_000n)],
    charges: [{ label: "hamali", kind: "deduct", amountPaise: "5050" }],
    roundToRupee: true,
    roundOffPaise: "0",
    totalPaise: "0",
  });

describe("postLedger / postStock per voucher type", () => {
  it("PURCHASE: Dr STOCK per line (allocated) / Cr PARTY total; stock in at bill value", () => {
    const v = purchase();
    // lines: 10 q × ₹2000 = 20,000.00 ; 5 q × ₹3000 = 15,000.00 ; − 50.50 → 34,949.50 → round 34,950.00
    expect(v.totalPaise).toBe("3495000");
    expect(v.roundOffPaise).toBe("50");
    const { lines, moves } = post(v);
    expect(view(lines)).toEqual(["Dr STOCK 1997143", "Dr STOCK 1497857", "Cr PARTY:F1 3495000"]);
    expect(moves.map((m) => [m.location, m.varietyId, m.qtyG, m.valuePaise])).toEqual([
      ["STORE", "V1", 1_000_000n, 1_997_143n],
      ["STORE", "V2", 500_000n, 1_497_857n],
    ]);
    expectBalanced(v);
  });

  it("PURCHASE paid now → linked PAYMENT draft (Dr PARTY / Cr CASH)", () => {
    const p = mk("PURCHASE", {
      partyId: "F1",
      storeAt: "STORE",
      lines: [line("V1", 100_000n, 200_000n)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      totalPaise: "0",
      paidNow: { amountPaise: "100000", mode: "CASH" },
    });
    const draft = paidNowPaymentDraft(p)!;
    expect(draft.allocations).toEqual([{ voucherId: p._id, amountPaise: "100000" }]);
    const pay = mk("PAYMENT", { ...draft, groupId: undefined, season: undefined });
    expect(view(postLedger(pay))).toEqual(["Dr PARTY:F1 100000", "Cr CASH 100000"]);
  });

  it("SALE from STORE: Dr PARTY / Cr SALES; COGS at weighted average; freight payer US", () => {
    const v = mk("SALE", {
      partyId: "M1",
      vehicleNumber: "WB12AB3456",
      source: "STORE",
      lines: [line("V1", 400_000n, 250_000n)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      delivery: { fixedPaise: "300000", amountPaise: "0", payer: "US", transporterPartyId: "T1" },
      totalPaise: "0",
      duePaise: "0",
      settlementStatus: "PENDING",
    });
    // Position: 10 q worth ₹20,000 → avg ₹2,000/q → 4 q cost ₹8,000.
    const ctx = ctxWith({ "V1|STORE|": { qtyG: 1_000_000n, valuePaise: 2_000_000n } });
    expect(view(postLedger(v, ctx))).toEqual([
      "Dr PARTY:M1 1000000",
      "Cr SALES 1000000",
      "Dr COGS 800000",
      "Cr STOCK 800000",
      "Dr EXP:TRANSPORT 300000",
      "Cr PARTY:T1 300000",
    ]);
    expect(postStock(v, ctx)).toEqual([
      { location: "STORE", varietyId: "V1", qtyG: -400_000n, valuePaise: -800_000n },
    ]);
    expectBalanced(v, ctx);
  });

  it("SALE freight payer MILL: mill pays the driver directly and deducts from our bill", () => {
    const v = mk("SALE", {
      partyId: "M1",
      vehicleNumber: "X1",
      source: "STORE",
      lines: [line("V1", 100_000n, 200_000n)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      delivery: { fixedPaise: "50000", amountPaise: "0", payer: "MILL", transporterPartyId: "T1" },
      totalPaise: "0",
      duePaise: "0",
      settlementStatus: "PENDING",
    });
    expect(v.duePaise).toBe("150000");
    const ls = view(postLedger(v)).filter((s) => !s.includes("COGS") && !s.includes("STOCK"));
    expect(ls).toEqual([
      "Dr PARTY:M1 200000",
      "Cr SALES 200000",
      "Dr EXP:TRANSPORT 50000",
      "Cr PARTY:T1 50000",
      "Dr PARTY:T1 50000",
      "Cr PARTY:M1 50000",
    ]);
  });

  it("SALE freight payer BUYER posts no freight; linked drafts for advance, vehicle advance, loading", () => {
    const v = mk("SALE", {
      partyId: "M1",
      vehicleNumber: "X1",
      source: "STORE",
      lines: [line("V1", 100_000n, 200_000n)],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      loading: {
        ratePaisePerQtl: "1000",
        amountPaise: "0",
        payTo: "LABOUR_PARTY",
        labourPartyId: "L1",
      },
      delivery: { fixedPaise: "50000", amountPaise: "0", payer: "BUYER", transporterPartyId: "T1" },
      vehicleAdvance: { amountPaise: "10000", mode: "CASH" },
      advanceReceived: { amountPaise: "20000", mode: "CASH", via: "driver" },
      totalPaise: "0",
      duePaise: "0",
      settlementStatus: "PENDING",
    });
    expect(view(postLedger(v)).some((s) => s.includes("TRANSPORT"))).toBe(false);
    const d = saleLinkedDrafts(v);
    expect(d.advanceReceipt?.amountPaise).toBe("20000");
    expect(d.vehicleAdvancePayment?.partyId).toBe("T1");
    expect(d.loadingExpense).toMatchObject({
      categoryCode: "LABOUR",
      amountPaise: "1000",
      onCredit: true,
      payeePartyId: "L1",
    });
    const exp = mk("EXPENSE", { ...d.loadingExpense!, groupId: undefined, season: undefined });
    expect(view(postLedger(exp))).toEqual(["Dr EXP:LABOUR 1000", "Cr PARTY:L1 1000"]);
  });

  it("LOAD OWN_TRADE: one load → purchase into TRANSIT + exactly one sale; sale takes specific cost", () => {
    const load = mk(
      "LOAD",
      {
        mode: "OWN_TRADE",
        fromPartyId: "F1",
        toMillPartyId: "M1",
        vehicleNumber: "WB12AB3456",
        varietyId: "V1",
        grossG: "1010000",
        netG: "1000000",
        partySellRatePaisePerQtl: "200000",
        millRatePaisePerQtl: "220000",
        totalAmountPaise: "0",
      },
      { _id: "LOAD1" },
    );
    expect(load.totalAmountPaise).toBe("2200000");
    expect(postLedger(load)).toEqual([]); // OWN_TRADE posts via its linked vouchers
    const { purchase: pd, sale: sd } = loadLinkedDrafts({ ...load, groupId: "G1" }, false);
    expect(pd?.storeAt).toBe("TRANSIT");
    expect(sd?.source).toBe("TRANSIT");
    const p = mk(
      "PURCHASE",
      { ...pd!, season: undefined },
      { createdAt: "2026-11-23T10:00:00.000Z" },
    );
    const s = mk("SALE", { ...sd!, season: undefined }, { createdAt: "2026-11-23T10:00:01.000Z" });
    const { results, book } = replay([p, s]);
    const saleLines = view(results[1]!.lines);
    expect(saleLines).toEqual([
      "Dr PARTY:M1 2200000",
      "Cr SALES 2200000",
      "Dr COGS 2000000",
      "Cr STOCK 2000000",
    ]);
    expect(book.total("GA", "V1", "TRANSIT")).toEqual({ qtyG: 0n, valuePaise: 0n });
    expect(book.total("GA", "V1", "STORE")).toEqual({ qtyG: 0n, valuePaise: 0n });
  });

  it("LOAD AGENT: commission only (Dr PARTY payer / Cr COMMISSION_INCOME)", () => {
    const load = mk("LOAD", {
      mode: "AGENT",
      fromPartyId: "F1",
      toMillPartyId: "M1",
      vehicleNumber: "X",
      varietyId: "V1",
      grossG: "1000000",
      netG: "1000000",
      totalAmountPaise: "0",
      commission: { ratePaisePerQtl: "1000", amountPaise: "0", payer: "MILL" },
    });
    expect(load.commission?.amountPaise).toBe("10000");
    expect(view(postLedger(load))).toEqual(["Dr PARTY:M1 10000", "Cr COMMISSION_INCOME 10000"]);
    expect(loadLinkedDrafts(load, true)).toEqual({ purchase: null, sale: null });
  });

  it("PAYMENT by bank: Dr PARTY / Cr BANK:x", () => {
    const v = mk("PAYMENT", {
      partyId: "F1",
      amountPaise: "123456",
      mode: "BANK_TRANSFER",
      ourBankAccountId: "B1",
      purpose: "ADVANCE",
    });
    expect(view(postLedger(v))).toEqual(["Dr PARTY:F1 123456", "Cr BANK:B1 123456"]);
  });

  it("RECEIPT by cheque with TDS: Dr CHEQUE_IN_HAND + Dr TDS / Cr PARTY", () => {
    const v = mk("RECEIPT", {
      partyId: "M1",
      amountPaise: "990000",
      mode: "CHEQUE",
      chequeNo: "123456",
      tdsPaise: "10000",
      purpose: "BILL",
    });
    expect(view(postLedger(v))).toEqual([
      "Dr CHEQUE_IN_HAND 990000",
      "Dr TDS_RECEIVABLE 10000",
      "Cr PARTY:M1 1000000",
    ]);
  });

  it("EXPENSE cash: Dr EXP:<code> / Cr CASH", () => {
    const v = mk("EXPENSE", {
      categoryCode: "FOOD",
      amountPaise: "15000",
      mode: "CASH",
      description: "tea",
    });
    expect(view(postLedger(v))).toEqual(["Dr EXP:FOOD 15000", "Cr CASH 15000"]);
  });

  it("TRIP: hirer owes freight; advance received; diesel on credit from pump", () => {
    const v = mk("TRIP", {
      vehicleId: "VEH1",
      hirerPartyId: "H1",
      loadingPlace: "A",
      unloadingPlace: "B",
      qtyG: "10000000",
      rateMode: "PER_QUINTAL",
      ratePaise: "5000",
      freightPaise: "0",
      advanceReceivedPaise: "100000",
      advanceMode: "CASH",
      expenses: [
        {
          kind: "DIESEL",
          amountPaise: "200000",
          litresMl: "22000",
          mode: "CASH",
          creditPartyId: "PUMP1",
        },
        { kind: "TOLL", amountPaise: "15000", mode: "CASH" },
      ],
      duePaise: "0",
    });
    expect(v.freightPaise).toBe("500000");
    expect(v.duePaise).toBe("400000");
    expect(view(postLedger(v))).toEqual([
      "Dr PARTY:H1 500000",
      "Cr VEH_INCOME:VEH1 500000",
      "Dr CASH 100000",
      "Cr PARTY:H1 100000",
      "Dr VEH_EXP:VEH1:DIESEL 200000",
      "Cr PARTY:PUMP1 200000",
      "Dr VEH_EXP:VEH1:TOLL 15000",
      "Cr CASH 15000",
    ]);
  });

  it("TRIP for own trade load: costs only, no freight income", () => {
    const v = mk("TRIP", {
      vehicleId: "VEH1",
      loadingPlace: "A",
      unloadingPlace: "B",
      qtyG: "10000000",
      rateMode: "PER_QUINTAL",
      ratePaise: "5000",
      freightPaise: "0",
      expenses: [{ kind: "DRIVER", amountPaise: "50000", mode: "CASH" }],
      duePaise: "0",
      ownTradeLoadId: "LOAD1",
    });
    expect(v.duePaise).toBe("0");
    const ls = postLedger(v);
    expect(view(ls)).toEqual(["Dr VEH_EXP:VEH1:DRIVER 50000", "Cr CASH 50000"]);
    expect(ls[0]?.loadId).toBe("LOAD1");
  });

  it.each([
    ["CASH_DEPOSIT", { bankAccountId: "B1" }, ["Dr BANK:B1 1000", "Cr CASH 1000"]],
    ["CASH_WITHDRAWAL", { bankAccountId: "B1" }, ["Dr CASH 1000", "Cr BANK:B1 1000"]],
    [
      "BANK_TRANSFER",
      { bankAccountId: "B1", toBankAccountId: "B2" },
      ["Dr BANK:B2 1000", "Cr BANK:B1 1000"],
    ],
    ["CHEQUE_CLEAR", { bankAccountId: "B1" }, ["Dr BANK:B1 1000", "Cr CHEQUE_IN_HAND 1000"]],
    ["CHEQUE_BOUNCE", { partyId: "M1" }, ["Dr PARTY:M1 1000", "Cr CHEQUE_IN_HAND 1000"]],
    ["CAPITAL_IN", {}, ["Dr CASH 1000", "Cr CAPITAL 1000"]],
    ["DRAWINGS", { bankAccountId: "B1" }, ["Dr DRAWINGS 1000", "Cr BANK:B1 1000"]],
  ] as const)("CONTRA %s", (kind, extra, expected) => {
    const v = mk("CONTRA", { kind, amountPaise: "1000", ...extra });
    expect(view(postLedger(v))).toEqual(expected);
  });

  it("STOCK_ADJUST shortage at average cost and excess at average cost", () => {
    const v = mk("STOCK_ADJUST", {
      lines: [
        { varietyId: "V1", qtyG: "-50000", reason: "DRYING" },
        { varietyId: "V2", qtyG: "20000", reason: "COUNT" },
      ],
    });
    const ctx = ctxWith({
      "V1|STORE|": { qtyG: 1_000_000n, valuePaise: 2_000_000n },
      "V2|STORE|": { qtyG: 100_000n, valuePaise: 300_000n },
    });
    expect(view(postLedger(v, ctx))).toEqual([
      "Dr STOCK_ADJ 100000",
      "Cr STOCK 100000",
      "Dr STOCK 60000",
      "Cr STOCK_ADJ 60000",
    ]);
  });

  it("MILL_SETTLEMENT cut → SALES_DEDUCTION; shortage computed", () => {
    const v = mk("MILL_SETTLEMENT", {
      saleId: "S1",
      partyId: "M1",
      dispatchedNetG: "1000000",
      saleTotalPaise: "2200000",
      millReceivedGrossG: "995000",
      millDeductions: [
        { label: "moisture", bps: 100 },
        { label: "quality", paise: "5000" },
      ],
      millNetG: "0",
      finalRatePaisePerQtl: "220000",
      finalAmountPaise: "0",
      differencePaise: "0",
      shortageG: "0",
    });
    // mill net = 995 kg − 1% (9.95 kg) = 985.05 kg → ₹21,671.10 − ₹50 = ₹21,621.10
    expect(v.millNetG).toBe("985050");
    expect(v.finalAmountPaise).toBe("2162110");
    expect(v.differencePaise).toBe("-37890");
    expect(v.shortageG).toBe("14950");
    expect(view(postLedger(v))).toEqual(["Dr SALES_DEDUCTION 37890", "Cr PARTY:M1 37890"]);
  });

  it("DAY_CLOSE shortage: Dr CASH_DIFF / Cr CASH; excess reversed", () => {
    const short = mk("DAY_CLOSE", {
      expectedCashPaise: "1000000",
      countedCashPaise: "990000",
      differencePaise: "0",
      notes: "short",
    });
    expect(short.differencePaise).toBe("-10000");
    expect(view(postLedger(short))).toEqual(["Dr CASH_DIFF 10000", "Cr CASH 10000"]);
    const excess = mk("DAY_CLOSE", {
      expectedCashPaise: "1000000",
      countedCashPaise: "1000500",
      differencePaise: "0",
      notes: "extra",
    });
    expect(view(postLedger(excess))).toEqual(["Dr CASH 500", "Cr CASH_DIFF 500"]);
  });

  it("OPENING: each item posted, OPENING_BAL balances; stock item creates a move", () => {
    const v = mk("OPENING", {
      items: [
        { kind: "CASH", amountPaise: "5000000" },
        { kind: "BANK", refId: "B1", amountPaise: "2000000" },
        { kind: "PARTY", refId: "F1", amountPaise: "-300000" },
        { kind: "STOCK", varietyId: "V1", qtyG: "2000000", amountPaise: "4000000" },
      ],
    });
    const { lines, moves } = post(v);
    expect(view(lines)).toEqual([
      "Dr CASH 5000000",
      "Dr BANK:B1 2000000",
      "Cr PARTY:F1 300000",
      "Dr STOCK 4000000",
      "Cr OPENING_BAL 10700000",
    ]);
    expect(moves).toEqual([
      { location: "STORE", varietyId: "V1", qtyG: 2_000_000n, valuePaise: 4_000_000n },
    ]);
  });

  it("JOURNAL posts as written; unbalanced journal throws", () => {
    const v = mk("JOURNAL", {
      lines: [
        { account: ACC.DRAWINGS, debitPaise: "1000", creditPaise: "0" },
        { account: "PARTY:F1", debitPaise: "0", creditPaise: "1000", partyId: "F1" },
      ],
    });
    expect(view(postLedger(v))).toEqual(["Dr DRAWINGS 1000", "Cr PARTY:F1 1000"]);
    const bad = {
      ...v,
      lines: [
        { account: ACC.CASH, debitPaise: "1000", creditPaise: "0" },
        { account: ACC.CAPITAL, debitPaise: "0", creditPaise: "999" },
      ],
    };
    expect(() => postLedger(bad)).toThrow(DomainError);
  });

  it("void vouchers post nothing", () => {
    const v = { ...purchase(), status: "void" as const };
    expect(post(v)).toEqual({ lines: [], moves: [] });
  });

  it("every line carries the voucher's godownId and tags when serialized", () => {
    const v = mk(
      "PAYMENT",
      { partyId: "F9", amountPaise: "100", mode: "CASH", purpose: "BILL" },
      { godownId: "GZ" },
    );
    const docs = toLedgerLineDocs(v, postLedger(v));
    expect(
      docs.every((d) => d.godownId === "GZ" && d.voucherId === v._id && d.fy === "2026-27"),
    ).toBe(true);
    expect(docs[0]?.partyId).toBe("F9");
  });

  it("missing bank account on a bank payment is a domain error", () => {
    const v = mk("PAYMENT", { partyId: "F1", amountPaise: "100", mode: "UPI", purpose: "BILL" });
    expect(() => postLedger(v)).toThrow(/BANK_ACCOUNT_REQUIRED/);
  });
});

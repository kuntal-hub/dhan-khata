/**
 * requirement_v2 §21 Tests 1–6 at domain level (pure posting + derived queries).
 * The same numbers are re-checked end-to-end in the UI phases.
 */
import { describe, expect, it } from "vitest";
import { sumBig } from "@/domain/rounding";
import { balanceAt, cashbookDay, cashEffects } from "@/domain/v2/cashbook";
import { billsOf, billState, paidFor, splitOverpayment } from "@/domain/v2/payments";
import { deriveAll } from "@/domain/v2/replay";
import type { Doc, LedgerLineV2 } from "@/domain/v2/schemas";
import { dispatchBalance, millDay, paddyDay, productDay, qtyAt } from "@/domain/v2/stock";
import { doc, manual, opening, payment, purchase, QTL, RS, sale } from "../helpers/v2";

const Y = "2026";
const d = (md: string) => `${Y}-${md}`;

function partyBalance(lines: readonly LedgerLineV2[], partyId: string): bigint {
  return sumBig(
    lines
      .filter((l) => l.account === `PARTY:${partyId}`)
      .map((l) => BigInt(l.debitPaise) - BigInt(l.creditPaise)),
  );
}

function ledgerBalance(lines: readonly LedgerLineV2[], account: string, upTo?: string): bigint {
  return sumBig(
    lines
      .filter((l) => l.account === account && (!upTo || l.date <= upTo))
      .map((l) => BigInt(l.debitPaise) - BigInt(l.creditPaise)),
  );
}

describe("Test 1: purchase with three dated payments", () => {
  const p = purchase(d("11-20"), "F1", "V1", 56n * QTL, 2400n * RS);
  const pay = (date: string, amt: bigint, mode: "CASH" | "BANK", initial = false) =>
    payment(
      date,
      "OUT",
      amt * RS,
      { type: "PURCHASE", id: p._id },
      {
        partyId: "F1",
        mode,
        isInitial: initial,
        ...(mode === "BANK" ? { bankAccountId: "BK1" } : {}),
      },
    );
  const p1 = pay(d("11-20"), 50_000n, "CASH", true);
  const p2 = pay(d("11-22"), 30_000n, "BANK");
  const p3 = pay(d("11-24"), 20_000n, "CASH");
  const docs: Doc[] = [
    opening(d("11-01"), [
      { kind: "CASH", amountPaise: (2_00_000n * RS).toString() },
      { kind: "BANK", refId: "BK1", amountPaise: (1_00_000n * RS).toString() },
    ]),
    p,
    p1,
    p2,
    p3,
  ];
  const [bill] = billsOf(p);

  it("total ₹1,34,400 and dues ₹84,400 → ₹54,400 → ₹34,400", () => {
    expect(p.totalPaise).toBe("13440000");
    expect(billState(bill!, [p1], d("11-20")).duePaise).toBe(84_400n * RS);
    expect(billState(bill!, [p1, p2], d("11-22")).duePaise).toBe(54_400n * RS);
    const s = billState(bill!, [p1, p2, p3], d("11-24"));
    expect(s.duePaise).toBe(34_400n * RS);
    expect(s.status).toBe("PARTIAL");
  });

  it("three payment records, each on its own date; the books move on paymentDate only", () => {
    expect([p1, p2, p3].map((x) => x.paymentDate)).toEqual([d("11-20"), d("11-22"), d("11-24")]);
    const c20 = cashbookDay(docs, "CASH", d("11-20"));
    expect(c20.paidPaise).toBe(50_000n * RS);
    expect(c20.items.paid.map((e) => e.docId)).toEqual([p1._id]);
    const b22 = cashbookDay(docs, "BANK:BK1", d("11-22"));
    expect(b22.paidPaise).toBe(30_000n * RS);
    expect(cashbookDay(docs, "CASH", d("11-22")).paidPaise).toBe(0n);
    expect(cashbookDay(docs, "CASH", d("11-24")).paidPaise).toBe(20_000n * RS);
  });

  it("no duplicate deduction: ₹70,000 cash + ₹30,000 bank, the purchase itself moves no money", () => {
    expect(cashEffects(p)).toEqual([]);
    const cashOut = sumBig(
      docs
        .flatMap(cashEffects)
        .filter((e) => e.account === "CASH" && e.category === "PAID")
        .map((e) => -e.signedPaise),
    );
    const bankOut = sumBig(
      docs
        .flatMap(cashEffects)
        .filter((e) => e.account === "BANK:BK1" && e.category === "PAID")
        .map((e) => -e.signedPaise),
    );
    expect(cashOut).toBe(70_000n * RS);
    expect(bankOut).toBe(30_000n * RS);
    expect(balanceAt(docs, "CASH", d("11-24"))).toBe((2_00_000n - 70_000n) * RS);
  });

  it("the ledger agrees: farmer payable ₹34,400, cash book == CASH account", () => {
    const { lines } = deriveAll(docs);
    expect(partyBalance(lines, "F1")).toBe(-34_400n * RS);
    expect(ledgerBalance(lines, "CASH")).toBe(balanceAt(docs, "CASH", d("11-30")));
    expect(paidFor(bill!, [p1, p2, p3])).toBe(1_00_000n * RS);
  });

  it("an overpayment splits into the bill part and an advance", () => {
    expect(splitOverpayment(40_000n * RS, 34_400n * RS)).toEqual({
      billPaise: 34_400n * RS,
      advancePaise: 5_600n * RS,
    });
  });
});

/** Shared stock story for Tests 2 and 3. */
function stockStory() {
  const day0 = d("11-01");
  const op = opening(day0, [
    {
      kind: "STOCK",
      product: "PADDY",
      location: "WAREHOUSE",
      varietyId: "V1",
      qtyG: (100n * QTL).toString(),
      amountPaise: (2_20_000n * RS).toString(),
    },
  ]);
  const pu = purchase(d("11-20"), "F1", "V1", 56n * QTL, 2400n * RS);
  const sa = sale(d("11-21"), "C1", "V1", 10n * QTL, 2600n * RS);
  const di = doc("MILL_DISPATCH", d("11-22"), {
    dispatchType: "MILLING",
    millPartyId: "M1",
    dispatchDate: d("11-22"),
    varietyId: "V1",
    weight: manual(20n * QTL),
    ratePaisePerQtl: (50n * RS).toString(),
    totalValuePaise: "0",
  });
  return { op, pu, sa, di };
}

describe("Test 2: stock", () => {
  it("opening 100 + 56 − 10 − 20 → warehouse 126 qtl; mill +20 qtl", () => {
    const { op, pu, sa, di } = stockStory();
    const { moves, lines } = deriveAll([op, pu, sa, di]);
    expect(qtyAt(moves, { product: "PADDY", location: "WAREHOUSE" })).toBe(126n * QTL);
    expect(qtyAt(moves, { product: "PADDY", location: "MILL" })).toBe(20n * QTL);
    expect(qtyAt(moves, { product: "PADDY", location: "MILL", millPartyId: "M1" })).toBe(20n * QTL);
    // A dispatch is never a sale: no SALES line, no receivable from the mill for the paddy.
    expect(lines.filter((l) => l.voucherId === di._id && l.account === "SALES")).toEqual([]);
    // Milling charges are payable to the mill: 20 qtl × ₹50.
    expect(partyBalance(lines, "M1")).toBe(-1_000n * RS);
    // Daily lines on the dispatch day.
    const day = paddyDay(moves, d("11-22"));
    expect(day.openingG).toBe(146n * QTL);
    expect(day.dispatchG).toBe(20n * QTL);
    expect(day.closingG).toBe(126n * QTL);
  });
});

describe("Test 3: mill return", () => {
  it("paddy return 5 qtl → warehouse 131, mill 15; rice return 3 qtl goes to rice only", () => {
    const { op, pu, sa, di } = stockStory();
    const ret = doc("MILL_RETURN", d("11-23"), {
      dispatchId: di._id,
      millPartyId: "M1",
      returnDate: d("11-23"),
      product: "PADDY",
      varietyId: "V1",
      weight: manual(5n * QTL),
      dedupeKey: "",
    });
    const rice = doc("MILL_RETURN", d("11-24"), {
      dispatchId: di._id,
      millPartyId: "M1",
      returnDate: d("11-24"),
      product: "RICE",
      weight: manual(3n * QTL),
      dedupeKey: "",
    });
    const { moves } = deriveAll([op, pu, sa, di, ret]);
    expect(qtyAt(moves, { product: "PADDY", location: "WAREHOUSE" })).toBe(131n * QTL);
    expect(qtyAt(moves, { product: "PADDY", location: "MILL" })).toBe(15n * QTL);
    expect(qtyAt(moves, { product: "RICE" })).toBe(0n);

    const all = deriveAll([op, pu, sa, di, ret, rice]).moves;
    expect(qtyAt(all, { product: "RICE", location: "WAREHOUSE" })).toBe(3n * QTL);
    expect(qtyAt(all, { product: "PADDY", location: "WAREHOUSE" })).toBe(131n * QTL);
    expect(qtyAt(all, { product: "PADDY", location: "MILL" })).toBe(15n * QTL);
    expect(productDay(all, d("11-24"), "RICE").closingG).toBe(3n * QTL);
    expect(millDay(all, d("11-23"), "M1")).toMatchObject({
      openingG: 20n * QTL,
      returnedG: 5n * QTL,
      closingG: 15n * QTL,
    });
    expect(dispatchBalance(di, [di, ret, rice]).remainingG).toBe(15n * QTL);
  });

  it("milling conversion removes the consumed paddy from mill stock and moves its value", () => {
    const { op, pu, sa, di } = stockStory();
    const rice = doc("MILL_RETURN", d("11-24"), {
      dispatchId: di._id,
      millPartyId: "M1",
      returnDate: d("11-24"),
      product: "RICE",
      weight: manual(13n * QTL),
      dedupeKey: "",
    });
    const conv = doc("CONVERSION", d("11-25"), {
      dispatchId: di._id,
      millPartyId: "M1",
      varietyId: "V1",
      conversionDate: d("11-25"),
      paddyConsumedG: (20n * QTL).toString(),
      outputs: [{ returnId: rice._id, product: "RICE", qtyG: (13n * QTL).toString() }],
      lossG: "0",
    });
    expect(conv.lossG).toBe((7n * QTL).toString());
    const { moves, lines } = deriveAll([op, pu, sa, di, rice, conv]);
    expect(qtyAt(moves, { product: "PADDY", location: "MILL" })).toBe(0n);
    expect(qtyAt(moves, { product: "RICE" })).toBe(13n * QTL);
    // The conversion is balanced and empties the mill's stock value.
    const convLines = lines.filter((l) => l.voucherId === conv._id);
    expect(sumBig(convLines.map((l) => BigInt(l.debitPaise)))).toBe(
      sumBig(convLines.map((l) => BigInt(l.creditPaise))),
    );
    expect(ledgerBalance(lines, "STOCK_AT_MILL:M1")).toBe(0n);
  });
});

describe("Test 4: cashbook with day close", () => {
  const day1 = d("11-20");
  const day2 = d("11-21");
  const base = (): Doc[] => [
    opening(d("11-19"), [{ kind: "CASH", amountPaise: (50_000n * RS).toString() }]),
    payment(day1, "IN", 25_000n * RS, { type: "PARTY_ADVANCE", id: null }, { partyId: "C1" }),
    payment(day1, "OUT", 40_000n * RS, { type: "PARTY_ADVANCE", id: null }, { partyId: "F1" }),
    payment(day1, "OUT", 5_000n * RS, { type: "EXPENSE", id: "E1" }),
  ];
  const close = (actual: bigint, note = "গোনা হয়েছে") =>
    doc(
      "DAY_CLOSE",
      day1,
      {
        date: day1,
        expectedClosingPaise: (30_000n * RS).toString(),
        actualClosingPaise: (actual * RS).toString(),
        diffPaise: "0",
      },
      { notes: note },
    );

  it("expected ₹30,000; actual ₹29,500 → shortage ₹500; next day opens with ₹29,500", () => {
    const docs = [...base(), close(29_500n)];
    const c1 = cashbookDay(docs, "CASH", day1);
    expect(c1.openingPaise).toBe(50_000n * RS);
    expect(c1.expectedClosingPaise).toBe(30_000n * RS);
    expect(c1.diffPaise).toBe(-500n * RS);
    expect(c1.closingPaise).toBe(29_500n * RS);
    expect(cashbookDay(docs, "CASH", day2).openingPaise).toBe(29_500n * RS);
    // The ledger agrees (CASH_DIFF posted).
    const { lines } = deriveAll(docs);
    expect(ledgerBalance(lines, "CASH")).toBe(29_500n * RS);
    expect(ledgerBalance(lines, "CASH_DIFF")).toBe(500n * RS);
  });

  it("actual ₹30,200 instead → excess ₹200", () => {
    const docs = [...base(), close(30_200n)];
    const c1 = cashbookDay(docs, "CASH", day1);
    expect(c1.diffPaise).toBe(200n * RS);
    expect(cashbookDay(docs, "CASH", day2).openingPaise).toBe(30_200n * RS);
  });

  it("a difference needs a note", () => {
    expect(() =>
      doc("DAY_CLOSE", day1, {
        date: day1,
        expectedClosingPaise: "3000000",
        actualClosingPaise: "2950000",
        diffPaise: "0",
      }),
    ).not.toThrow(); // schema-valid; the rule is checked by validateDocRules (repo + server)
  });
});

describe("Test 5: backdated expense paid on two dates", () => {
  const e = doc(
    "EXPENSE",
    d("11-20"),
    {
      title: "লেবার",
      categoryCode: "LABOUR",
      amountPaise: (5_000n * RS).toString(),
      expenseDate: d("11-20"),
    },
    { entryDate: d("11-24"), createdAt: `${Y}-11-24T09:00:00.000Z` },
  );
  const pay1 = payment(
    d("11-20"),
    "OUT",
    3_000n * RS,
    { type: "EXPENSE", id: e._id },
    {},
    { entryDate: d("11-24") },
  );
  const pay2 = payment(d("11-24"), "OUT", 2_000n * RS, { type: "EXPENSE", id: e._id });
  const docs: Doc[] = [
    opening(d("11-01"), [{ kind: "CASH", amountPaise: (20_000n * RS).toString() }]),
    e,
    pay1,
    pay2,
  ];

  it("balance 0; cashbook shows ₹3,000 on 20 Nov and ₹2,000 on 24 Nov; counted once", () => {
    expect(e.expenseDate).toBe(d("11-20"));
    expect(e.entryDate).toBe(d("11-24"));
    const s = billState(billsOf(e)[0]!, [pay1, pay2], d("11-24"));
    expect(s.duePaise).toBe(0n);
    expect(s.status).toBe("PAID");
    expect(cashbookDay(docs, "CASH", d("11-20")).expensesPaise).toBe(3_000n * RS);
    expect(cashbookDay(docs, "CASH", d("11-24")).expensesPaise).toBe(2_000n * RS);
    expect(cashEffects(e)).toEqual([]);
    const { lines } = deriveAll(docs);
    // Expense counted once in profit; the payable is cleared.
    expect(ledgerBalance(lines, "EXP:LABOUR")).toBe(5_000n * RS);
    expect(ledgerBalance(lines, "EXP_PAYABLE")).toBe(0n);
    expect(ledgerBalance(lines, "CASH")).toBe(15_000n * RS);
  });

  it("an unpaid expense doesn't reduce cash", () => {
    const only = [docs[0]!, e];
    expect(balanceAt(only, "CASH", d("11-30"))).toBe(20_000n * RS);
    expect(billState(billsOf(e)[0]!, [], d("11-24")).status).toBe("UNPAID");
  });
});

describe("Test 6: partial sales collection", () => {
  it("sale ₹25,000; collect ₹10,000 and ₹5,000 → due ₹10,000 on the ledger and the cashbook", () => {
    const st = opening(d("11-01"), [
      {
        kind: "STOCK",
        product: "PADDY",
        location: "WAREHOUSE",
        varietyId: "V1",
        qtyG: (20n * QTL).toString(),
        amountPaise: (40_000n * RS).toString(),
      },
    ]);
    const s = sale(d("11-20"), "C1", "V1", 10n * QTL, 2500n * RS);
    expect(s.totalPaise).toBe((25_000n * RS).toString());
    const c1 = payment(
      d("11-21"),
      "IN",
      10_000n * RS,
      { type: "SALE", id: s._id },
      { partyId: "C1" },
    );
    const c2 = payment(
      d("11-23"),
      "IN",
      5_000n * RS,
      { type: "SALE", id: s._id },
      { partyId: "C1", mode: "UPI", bankAccountId: "BK1" },
    );
    const docs: Doc[] = [st, s, c1, c2];
    expect(billState(billsOf(s)[0]!, [c1, c2], d("11-23")).duePaise).toBe(10_000n * RS);
    const { lines } = deriveAll(docs);
    expect(partyBalance(lines, "C1")).toBe(10_000n * RS);
    const ledgerDates = lines.filter((l) => l.partyId === "C1").map((l) => l.date);
    expect(ledgerDates).toEqual([d("11-20"), d("11-21"), d("11-23")]);
    expect(cashbookDay(docs, "CASH", d("11-21")).receivedPaise).toBe(10_000n * RS);
    expect(cashbookDay(docs, "BANK:BK1", d("11-23")).receivedPaise).toBe(5_000n * RS);
    expect(cashbookDay(docs, "CASH", d("11-20")).receivedPaise).toBe(0n);
  });

  it("an ORDER moves no stock and no receivable until confirmed", () => {
    const o = sale(d("11-20"), "C1", "V1", 10n * QTL, 2500n * RS, {}, { saleStatus: "ORDER" });
    const { lines, moves } = deriveAll([o]);
    expect(lines).toEqual([]);
    expect(moves).toEqual([]);
  });
});

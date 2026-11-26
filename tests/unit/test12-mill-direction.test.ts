/**
 * Acceptance Test 12 — Mill money direction (requirement_v2.1 §21), domain level: the broker buys
 * from farmers and PAYS them; he delivers paddy to a mill and THE MILL PAYS HIM. Stock Tests 2/3
 * stay as they were. Plus property tests for the direction rules.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DomainError } from "@/domain/errors";
import { sumBig } from "@/domain/rounding";
import { balanceAt, cashbookDay, cashEffects } from "@/domain/v2/cashbook";
import { PAYMENT_DIRECTION, assertPaymentDirection } from "@/domain/v2/direction";
import { validateLinks } from "@/domain/v2/links";
import { billState, millCredits } from "@/domain/v2/payments";
import { postDoc } from "@/domain/v2/post";
import { validateDocRules } from "@/domain/v2/recompute";
import { deriveAll } from "@/domain/v2/replay";
import { PAYMENT_SOURCE_TYPES, type Doc, type LedgerLineV2 } from "@/domain/v2/schemas";
import { qtyAt } from "@/domain/v2/stock";
import { doc, manual, opening, payment, purchase, QTL, RS } from "../helpers/v2";

const d = (md: string) => `2026-${md}`;
const BANK = "BK1";

const acct = (lines: readonly LedgerLineV2[], a: string) =>
  sumBig(
    lines.filter((l) => l.account === a).map((l) => BigInt(l.debitPaise) - BigInt(l.creditPaise)),
  );
/** Gross profit = SALES + MILL_SALES − MILL_DEDUCTION − COGS (credit-positive income). */
const grossProfit = (lines: readonly LedgerLineV2[]) =>
  -(
    acct(lines, "SALES") +
    acct(lines, "MILL_SALES") +
    acct(lines, "MILL_DEDUCTION") +
    acct(lines, "COGS")
  );

function story() {
  const op = opening(d("11-01"), [{ kind: "CASH", amountPaise: (2_00_000n * RS).toString() }]);
  const pu = purchase(d("11-20"), "F1", "V1", 56n * QTL, 2400n * RS);
  const payFarmer = payment(
    d("11-20"),
    "OUT",
    1_34_400n * RS,
    { type: "PURCHASE", id: pu._id },
    {
      partyId: "F1",
    },
  );
  const di = doc("MILL_DISPATCH", d("11-21"), {
    millPartyId: "M1",
    dispatchDate: d("11-21"),
    varietyId: "V1",
    weight: manual(56n * QTL),
    ratePaisePerQtl: (2600n * RS).toString(),
    totalValuePaise: "0",
  });
  const col1 = payment(
    d("11-22"),
    "IN",
    1_00_000n * RS,
    { type: "MILL_DISPATCH", id: di._id },
    {
      partyId: "M1",
    },
  );
  const ret = doc("MILL_RETURN", d("11-23"), {
    dispatchId: di._id,
    millPartyId: "M1",
    returnDate: d("11-23"),
    product: "PADDY",
    varietyId: "V1",
    weight: manual(5n * QTL),
    ratePaisePerQtl: di.ratePaisePerQtl,
    dedupeKey: "",
  });
  const col2 = payment(
    d("11-24"),
    "IN",
    32_600n * RS,
    { type: "MILL_DISPATCH", id: di._id },
    { partyId: "M1", mode: "BANK", bankAccountId: BANK },
  );
  return { op, pu, payFarmer, di, col1, ret, col2 };
}

describe("Test 12 — mill money direction", () => {
  const s = story();
  const upTo = (...docs: Doc[]) => deriveAll(docs);

  it("buy 56 qtl @ ₹2,400 and pay the farmer in cash → cash ₹65,600, farmer due 0", () => {
    const docs = [s.op, s.pu, s.payFarmer];
    const { lines } = upTo(...docs);
    expect(balanceAt(docs, "CASH", d("11-20"))).toBe(65_600n * RS);
    expect(acct(lines, "PARTY:F1")).toBe(0n);
  });

  it("dispatch 56 qtl @ ₹2,600 → the mill owes ₹1,45,600 (পাওনা); cash unchanged; stock moves", () => {
    const docs = [s.op, s.pu, s.payFarmer, s.di];
    const { lines, moves } = upTo(...docs);
    expect(s.di.totalValuePaise).toBe((1_45_600n * RS).toString());
    expect(acct(lines, "PARTY:M1")).toBe(1_45_600n * RS); // > 0: they owe us
    expect(balanceAt(docs, "CASH", d("11-21"))).toBe(65_600n * RS);
    expect(cashEffects(s.di)).toEqual([]);
    expect(qtyAt(moves, { product: "PADDY", location: "WAREHOUSE" })).toBe(0n); // +56 −56
    expect(qtyAt(moves, { product: "PADDY", location: "MILL", millPartyId: "M1" })).toBe(56n * QTL);
  });

  it("the mill pays ₹1,00,000 cash → cash ₹1,65,600, Cash received +₹1,00,000, receivable ₹45,600", () => {
    const docs = [s.op, s.pu, s.payFarmer, s.di, s.col1];
    const { lines } = upTo(...docs);
    expect(balanceAt(docs, "CASH", d("11-22"))).toBe(1_65_600n * RS);
    const day = cashbookDay(docs, "CASH", d("11-22"));
    expect(day.receivedPaise).toBe(1_00_000n * RS);
    expect(day.paidPaise).toBe(0n);
    expect(day.expensesPaise).toBe(0n);
    expect(acct(lines, "PARTY:M1")).toBe(45_600n * RS);
  });

  it("the mill returns 5 qtl → credit ₹13,000, receivable ₹32,600; warehouse +5, mill 51; cash same", () => {
    const docs = [s.op, s.pu, s.payFarmer, s.di, s.col1, s.ret];
    const { lines, moves } = upTo(...docs);
    expect(s.ret.totalValuePaise).toBe((13_000n * RS).toString());
    expect(acct(lines, "PARTY:M1")).toBe(32_600n * RS);
    expect(qtyAt(moves, { product: "PADDY", location: "WAREHOUSE" })).toBe(5n * QTL);
    expect(qtyAt(moves, { product: "PADDY", location: "MILL" })).toBe(51n * QTL);
    expect(balanceAt(docs, "CASH", d("11-23"))).toBe(1_65_600n * RS);
    expect(cashEffects(s.ret)).toEqual([]);
  });

  it("the mill pays ₹32,600 by bank → bank +₹32,600, receivable 0, cash unchanged", () => {
    const docs = Object.values(s);
    const { lines } = upTo(...docs);
    expect(balanceAt(docs, `BANK:${BANK}`, d("11-24"))).toBe(32_600n * RS);
    expect(balanceAt(docs, "CASH", d("11-24"))).toBe(1_65_600n * RS);
    expect(acct(lines, "PARTY:M1")).toBe(0n);
    // The dispatch bill, netted by the return credit, is fully paid.
    const credits = millCredits(docs);
    const bill = {
      sourceType: "MILL_DISPATCH" as const,
      sourceId: s.di._id,
      direction: "IN" as const,
      totalPaise: BigInt(s.di.totalValuePaise) - (credits.get(s.di._id) ?? 0n),
      date: d("11-21"),
    };
    expect(billState(bill, [s.col1, s.col2] as never, d("11-30")).status).toBe("PAID");
  });

  it("gross profit = 51 × (2,600 − 2,400) = ₹10,200", () => {
    const { lines } = upTo(...Object.values(s));
    expect(grossProfit(lines)).toBe(10_200n * RS);
    // No mill payable anywhere: nothing ever credits the mill except a credit for goods back.
    expect(lines.some((l) => l.account === "MILLING_CHARGES")).toBe(false);
  });

  it("'Cash paid' is only the farmer payment: mill collections never count as paid", () => {
    const docs = Object.values(s);
    const paid = docs.flatMap(cashEffects).filter((e) => e.category === "PAID");
    expect(sumBig(paid.map((e) => -e.signedPaise))).toBe(1_34_400n * RS);
    const received = docs.flatMap(cashEffects).filter((e) => e.category === "RECEIVED");
    expect(sumBig(received.map((e) => e.signedPaise))).toBe(1_32_600n * RS);
  });
});

// ── Direction map ──────────────────────────────────────────────────────────────────────────────

describe("payment direction map", () => {
  it("covers every payment source type", () => {
    expect(Object.keys(PAYMENT_DIRECTION).sort()).toEqual([...PAYMENT_SOURCE_TYPES].sort());
    expect(PAYMENT_DIRECTION.MILL_DISPATCH).toBe("IN");
    expect(PAYMENT_DIRECTION.MILL_REFUND).toBe("OUT");
    expect(PAYMENT_DIRECTION.MILL_RETURN).toBe("NONE");
  });

  it("property: the map rejects every wrong direction (local rules) and accepts the right one", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAYMENT_SOURCE_TYPES),
        fc.constantFrom("IN" as const, "OUT" as const),
        (type, direction) => {
          const rule = PAYMENT_DIRECTION[type];
          const ok = rule === "CHOICE" || rule === direction;
          const p = doc("PAYMENT", d("11-20"), {
            direction,
            amountPaise: "100",
            paymentDate: d("11-20"),
            mode: "CASH",
            partyId: "P1",
            source: {
              type,
              id: type === "PARTY_ADVANCE" || type === "MILL_REFUND" ? null : "S1:x",
            },
            isInitial: false,
          });
          let code: string | undefined;
          try {
            validateDocRules(p, d("11-30"));
          } catch (e) {
            code = (e as DomainError).code;
          }
          if (ok) expect(code).not.toBe("PAYMENT_DIRECTION_MISMATCH");
          else expect(code).toBe("PAYMENT_DIRECTION_MISMATCH");
          // The same map also guards the cross-document check the server runs.
          let threw = false;
          try {
            assertPaymentDirection(type, direction);
          } catch {
            threw = true;
          }
          expect(threw).toBe(!ok);
        },
      ),
    );
  });

  it("validateLinks (shared with the server) refuses an OUT payment against a dispatch", () => {
    const { di } = story();
    const bad = payment(
      d("11-22"),
      "OUT",
      100n,
      { type: "MILL_DISPATCH", id: di._id },
      {
        partyId: "M1",
      },
    );
    expect(() => validateLinks(bad, (id) => (id === di._id ? di : undefined))).toThrow(
      "PAYMENT_DIRECTION_MISMATCH",
    );
  });
});

// ── Properties ─────────────────────────────────────────────────────────────────────────────────

describe("mill money properties", () => {
  it("every MILL_DISPATCH payment increases CASH or BANK", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10_000_000_00n }), fc.boolean(), (amount, bank) => {
        const p = payment(
          d("11-22"),
          "IN",
          amount,
          { type: "MILL_DISPATCH", id: "DI1" },
          bank ? { partyId: "M1", mode: "BANK", bankAccountId: BANK } : { partyId: "M1" },
        );
        const effects = cashEffects(p);
        expect(effects).toHaveLength(1);
        expect(effects[0]!.signedPaise).toBe(amount);
        expect(effects[0]!.category).toBe("RECEIVED");
        const lines = postDoc(p).lines;
        const money = lines.find((l) => l.account === (bank ? `BANK:${BANK}` : "CASH"))!;
        expect(money.debit).toBe(amount);
      }),
    );
  });

  it("a mill's balance = dispatched − returned − settlement cut − collected; negative only if it overpaid", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 80 }), // qtl dispatched
        fc.integer({ min: 1500, max: 3500 }), // dispatch rate ₹/qtl
        fc.integer({ min: 0, max: 100 }), // % returned
        fc.option(fc.integer({ min: 1500, max: 3500 }), { nil: undefined }), // final rate
        fc.array(fc.bigInt({ min: 1n, max: 3_00_000_00n }), { maxLength: 4 }), // collections
        (qtl, rate, pctBack, finalRate, collections) => {
          const sent = BigInt(qtl) * QTL;
          const back = (sent * BigInt(pctBack)) / 100n;
          const di = doc("MILL_DISPATCH", d("11-21"), {
            millPartyId: "M1",
            dispatchDate: d("11-21"),
            varietyId: "V1",
            weight: manual(sent),
            ratePaisePerQtl: (BigInt(rate) * RS).toString(),
            totalValuePaise: "0",
          });
          const docs: Doc[] = [di];
          if (back > 0n) {
            docs.push(
              doc("MILL_RETURN", d("11-22"), {
                dispatchId: di._id,
                millPartyId: "M1",
                returnDate: d("11-22"),
                product: "PADDY",
                varietyId: "V1",
                weight: manual(back),
                ratePaisePerQtl: di.ratePaisePerQtl,
                dedupeKey: "",
              }),
            );
          }
          if (finalRate !== undefined && sent - back > 0n) {
            docs.push(
              doc("MILL_SETTLEMENT", d("11-23"), {
                dispatchId: di._id,
                millPartyId: "M1",
                varietyId: "V1",
                dispatchRatePaisePerQtl: di.ratePaisePerQtl,
                transactionDate: d("11-23"),
                acceptedG: (sent - back).toString(),
                finalRatePaisePerQtl: (BigInt(finalRate) * RS).toString(),
                deductionPaise: "0",
                shortfallG: "0",
                billedPaise: "0",
                finalValuePaise: "0",
                adjustmentPaise: "0",
              }),
            );
          }
          for (const c of collections)
            docs.push(
              payment(
                d("11-24"),
                "IN",
                c,
                { type: "MILL_DISPATCH", id: di._id },
                { partyId: "M1" },
              ),
            );
          const { lines } = deriveAll(docs);
          const balance = acct(lines, "PARTY:M1");
          const net = BigInt(di.totalValuePaise) - (millCredits(docs).get(di._id) ?? 0n);
          const collected = collections.reduce((a, b) => a + b, 0n);
          expect(balance).toBe(net - collected);
          expect(balance < 0n).toBe(collected > net);
          // Every posting is balanced.
          expect(
            acct(lines, "PARTY:M1") +
              acct(lines, "MILL_SALES") +
              acct(lines, "MILL_DEDUCTION") +
              acct(lines, "CASH") +
              acct(lines, "COGS") +
              acct(lines, "STOCK_PADDY"),
          ).toBe(0n);
        },
      ),
    );
  });
});

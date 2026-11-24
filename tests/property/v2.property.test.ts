/**
 * requirement_v2 §6.4 property tests over the v2 posting engine:
 *  - every posting is balanced
 *  - void restores the previous state exactly
 *  - edit-then-edit-back is identical
 *  - stock and balances never change in another Gola
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sumBig } from "@/domain/rounding";
import { stockKeyId } from "@/domain/v2/post";
import { replayDocs } from "@/domain/v2/replay";
import type { Doc } from "@/domain/v2/schemas";
import { doc, manual, opening, payment, purchase, QTL, RS, sale } from "../helpers/v2";

const GOLAS = ["GA", "GB"];
const RUNS = 150;

const opArb = fc.record({
  kind: fc.constantFrom(
    "PURCHASE",
    "SALE",
    "PAY_OUT",
    "PAY_IN",
    "EXPENSE",
    "DISPATCH",
    "RETURN",
    "ADJUST",
    "TRIP",
    "SECOND",
    "CONTRA",
    "ORDER",
  ),
  gola: fc.integer({ min: 0, max: 1 }),
  day: fc.integer({ min: 1, max: 9 }),
  qtl: fc.integer({ min: 1, max: 60 }),
  kg: fc.integer({ min: 0, max: 999 }),
  rate: fc.integer({ min: 1500, max: 3200 }),
  amount: fc.integer({ min: 1, max: 90_000 }),
  bank: fc.boolean(),
  variety: fc.constantFrom("V1", "V2"),
});
type Op = typeof opArb extends fc.Arbitrary<infer T> ? T : never;

function build(ops: Op[]): Doc[] {
  const docs: Doc[] = GOLAS.map((g) =>
    opening(
      "2026-11-01",
      [
        { kind: "CASH", amountPaise: (5_00_000n * RS).toString() },
        { kind: "BANK", refId: `BK-${g}`, amountPaise: (5_00_000n * RS).toString() },
        {
          kind: "STOCK",
          product: "PADDY",
          location: "WAREHOUSE",
          varietyId: "V1",
          qtyG: (100n * QTL).toString(),
          amountPaise: (2_00_000n * RS).toString(),
        },
      ],
      { godownId: g },
    ),
  );
  let dispatchOf: Record<string, string> = {};
  ops.forEach((op, i) => {
    const g = GOLAS[op.gola]!;
    const date = `2026-11-${String(op.day + 1).padStart(2, "0")}`;
    const o = {
      godownId: g,
      createdAt: `${date}T${String(10 + (i % 10)).padStart(2, "0")}:00:00.${String(i).padStart(3, "0")}Z`,
    };
    const g_ = BigInt(op.qtl) * QTL + BigInt(op.kg) * 1000n;
    const rate = BigInt(op.rate) * RS;
    const amt = BigInt(op.amount) * RS;
    const money = op.bank ? { mode: "BANK" as const, bankAccountId: `BK-${g}` } : {};
    switch (op.kind) {
      case "PURCHASE":
        docs.push(purchase(date, `F-${g}`, op.variety, g_, rate, o));
        break;
      case "SALE":
        docs.push(sale(date, `C-${g}`, op.variety, g_, rate, o));
        break;
      case "ORDER":
        docs.push(sale(date, `C-${g}`, op.variety, g_, rate, o, { saleStatus: "ORDER" }));
        break;
      case "PAY_OUT":
        docs.push(
          payment(
            date,
            "OUT",
            amt,
            { type: "PARTY_ADVANCE", id: null },
            { partyId: `F-${g}`, ...money },
            o,
          ),
        );
        break;
      case "PAY_IN":
        docs.push(
          payment(
            date,
            "IN",
            amt,
            { type: "PARTY_ADVANCE", id: null },
            { partyId: `C-${g}`, ...money },
            o,
          ),
        );
        break;
      case "EXPENSE":
        docs.push(
          doc(
            "EXPENSE",
            date,
            { title: "x", categoryCode: "LABOUR", amountPaise: amt.toString(), expenseDate: date },
            o,
          ),
        );
        break;
      case "DISPATCH": {
        const di = doc(
          "MILL_DISPATCH",
          date,
          {
            dispatchType: op.bank ? "MILLING" : "CONSIGNMENT",
            millPartyId: `M-${g}`,
            dispatchDate: date,
            varietyId: op.variety,
            weight: manual(g_),
            ratePaisePerQtl: (50n * RS).toString(),
            totalValuePaise: "0",
          },
          o,
        );
        dispatchOf = { ...dispatchOf, [`${g}|${op.variety}`]: di._id };
        docs.push(di);
        break;
      }
      case "RETURN": {
        const dispatchId = dispatchOf[`${g}|${op.variety}`];
        if (!dispatchId) break;
        docs.push(
          doc(
            "MILL_RETURN",
            date,
            {
              dispatchId,
              millPartyId: `M-${g}`,
              returnDate: date,
              product: op.bank ? "RICE" : "PADDY",
              ...(op.bank ? {} : { varietyId: op.variety }),
              weight: manual(BigInt(op.kg + 1) * 1000n),
              dedupeKey: "",
            },
            o,
          ),
        );
        break;
      }
      case "ADJUST":
        docs.push(
          doc(
            "STOCK_ADJUST",
            date,
            {
              transactionDate: date,
              lines: [
                {
                  product: "PADDY",
                  location: "WAREHOUSE",
                  varietyId: op.variety,
                  qtyG: (op.bank ? -1n : 1n) * BigInt(op.kg + 1) * 1000n + "",
                  reason: "DRYING",
                },
              ],
            },
            o,
          ),
        );
        break;
      case "TRIP":
        docs.push(
          doc(
            "TRIP",
            date,
            {
              transactionDate: date,
              customerPartyId: `C-${g}`,
              vehicleId: `VH-${g}`,
              loadingLocation: "a",
              destination: "b",
              rateMode: "FIXED",
              ratePaise: amt.toString(),
              totalIncomePaise: "0",
              costs: [
                { id: "c1", kind: "DIESEL", amountPaise: (BigInt(op.kg + 1) * RS).toString() },
                {
                  id: "c2",
                  kind: "DRIVER",
                  amountPaise: (500n * RS).toString(),
                  partyId: `DR-${g}`,
                },
              ],
            },
            o,
          ),
        );
        break;
      case "SECOND":
        docs.push(
          doc(
            "SECOND_PARTY",
            date,
            {
              partyId: `SP-${g}`,
              transactionDate: date,
              kind: op.bank ? "WE_OWE" : "THEY_OWE",
              amountPaise: amt.toString(),
            },
            o,
          ),
        );
        break;
      case "CONTRA":
        docs.push(
          doc(
            "CONTRA",
            date,
            {
              transactionDate: date,
              kind: op.bank ? "DEPOSIT" : "WITHDRAW",
              bankAccountId: `BK-${g}`,
              amountPaise: amt.toString(),
            },
            o,
          ),
        );
        break;
    }
  });
  return docs;
}

/** Account balances and stock positions per Gola, as comparable strings. */
function aggregates(docs: readonly Doc[]): Map<string, string> {
  const { results } = replayDocs(docs);
  const acc = new Map<string, bigint>();
  const stock = new Map<string, [bigint, bigint]>();
  for (const r of results) {
    for (const l of r.lines) {
      const k = `${r.doc.godownId}#A#${l.account}`;
      acc.set(k, (acc.get(k) ?? 0n) + l.debit - l.credit);
    }
    for (const m of r.moves) {
      const k = `${r.doc.godownId}#S#${stockKeyId(m)}`;
      const p = stock.get(k) ?? [0n, 0n];
      stock.set(k, [p[0] + m.qtyG, p[1] + m.valuePaise]);
    }
  }
  const out = new Map<string, string>();
  for (const [k, v] of acc) if (v !== 0n) out.set(k, v.toString());
  for (const [k, [q, v]] of stock) if (q !== 0n || v !== 0n) out.set(k, `${q}/${v}`);
  return out;
}

const sorted = (m: Map<string, string>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

describe("v2 posting properties", () => {
  it("every posting is balanced", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        for (const r of replayDocs(build(ops)).results) {
          expect(sumBig(r.lines.map((l) => l.debit))).toBe(sumBig(r.lines.map((l) => l.credit)));
          for (const l of r.lines) expect(l.debit === 0n || l.credit === 0n).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("void restores the previous state exactly", () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 25 }), fc.nat(), (ops, pick) => {
        const docs = build(ops);
        const k = 2 + (pick % Math.max(1, docs.length - 2));
        if (k >= docs.length) return;
        const target = docs[k]!;
        const without = docs.filter((_, i) => i !== k);
        const voided = docs.map((x, i) =>
          i === k ? ({ ...target, status: "void", rev: target.rev + 1 } as Doc) : x,
        );
        expect(sorted(aggregates(voided))).toEqual(sorted(aggregates(without)));
      }),
      { numRuns: RUNS },
    );
  });

  it("edit then edit back is identical", () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 25 }), fc.nat(), (ops, pick) => {
        const docs = build(ops);
        const k = 2 + (pick % Math.max(1, docs.length - 2));
        if (k >= docs.length) return;
        const original = docs[k]!;
        const before = aggregates(docs);
        const edited = { ...original, rev: 2, notes: "edited" } as Doc;
        const back = { ...original, rev: 3 } as Doc;
        const afterEdit = docs.map((x, i) => (i === k ? edited : x));
        const afterBack = afterEdit.map((x, i) => (i === k ? back : x));
        expect(sorted(aggregates(afterBack))).toEqual(sorted(before));
      }),
      { numRuns: RUNS },
    );
  });

  it("stock and balances never change in another Gola", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        const docs = build(ops);
        const onlyB = docs.filter((x) => x.godownId === "GB");
        const pickB = (m: Map<string, string>) =>
          new Map([...m].filter(([key]) => key.startsWith("GB#")));
        expect(sorted(pickB(aggregates(docs)))).toEqual(sorted(aggregates(onlyB)));
      }),
      { numRuns: RUNS },
    );
  });
});

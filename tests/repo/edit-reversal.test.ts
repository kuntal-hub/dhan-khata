/**
 * requirement_v2 §21 Test 10 — Edit and reversal: edit a purchase, a payment, a sale, an expense
 * and a mill dispatch (quantity, amount, date) → stock, the cashbook on the old AND the new date,
 * dues and reports recalculate; no duplicate transaction; voiding restores the exact previous
 * state (every account total and every stock position).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { cashbookView } from "@/client/queries/dashboard";
import { partyDues } from "@/client/queries/dues";
import { godownBalances } from "@/client/queries/ledger";
import { reportById, type T } from "@/client/reports/defs";
import { runReport } from "@/client/reports/run";
import {
  payBill,
  saveBillWithInitialPayment,
  saveDoc,
  saveOpeningCash,
  saveOpeningStock,
  voidDoc,
  type DraftOf,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import { accountTotals } from "@/domain/integrity";
import type { Doc } from "@/domain/schemas";
import { deriveAll } from "@/domain/v2/replay";
import { qtyAt } from "@/domain/v2/stock";
import { translate } from "@/i18n/translate";
import {
  QTL,
  RS,
  TODAY,
  expenseDraft,
  manualWeight,
  purchaseDraft,
  saleDraft,
  setupDevice,
  type LocalGodown,
} from "../helpers/local";

let G: LocalGodown;
const GA = "GA";
const D0 = addDays(TODAY, -10);
const D1 = addDays(TODAY, -6);
const D2 = addDays(TODAY, -3);
const t: T = (k, v) => translate("en", k, v);

beforeEach(async () => {
  const gs = await setupDevice("repo-test10", { godowns: [{ id: GA, code: "RP" }] });
  G = gs[GA]!;
  await saveOpeningCash(GA, D0, 100_000n * RS);
  await saveOpeningStock(GA, {
    date: D0,
    product: "PADDY",
    varietyId: G.variety.SWARNA!,
    qtyG: 100n * QTL,
    valuePaise: 100n * 2000n * RS,
  });
});

/** Every account total + every stock position: the "state" of the books. */
async function snapshot(): Promise<{
  accounts: Record<string, string>;
  stock: Record<string, string>;
}> {
  const lines = (await db().ledgerLines.toArray()).filter((l) => l.godownId === GA);
  const moves = (await db().stockMoves.toArray()).filter((m) => m.godownId === GA);
  const stock: Record<string, string> = {};
  for (const m of moves) {
    const k = `${m.product}|${m.location}|${m.varietyId ?? ""}|${m.millPartyId ?? ""}`;
    stock[k] = (BigInt(stock[k] ?? "0") + BigInt(m.qtyG)).toString();
  }
  for (const k of Object.keys(stock)) if (stock[k] === "0") delete stock[k];
  return { accounts: accountTotals(lines), stock };
}

async function noDuplicates(): Promise<void> {
  const want = deriveAll((await db().vouchers.toArray()) as Doc[]);
  const lines = (await db().ledgerLines.toArray()).map((l) => l._id).sort();
  expect(lines).toEqual(want.lines.map((l) => l._id).sort());
  const moves = (await db().stockMoves.toArray()).map((m) => m._id).sort();
  expect(moves).toEqual(want.moves.map((m) => m._id).sort());
}

const warehouse = async () =>
  qtyAt(
    (await db().stockMoves.toArray()).filter((m) => m.godownId === GA),
    { product: "PADDY", location: "WAREHOUSE" },
  );
const cash = async (date: string) => cashbookView(GA, "CASH", date);

describe("Test 10 — edit and reversal", () => {
  it("purchase + payment: quantity, amount and dates edited; books follow; void restores", async () => {
    const before = await snapshot();
    const { bill, payment } = await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 56n * QTL, 2400n * RS, D1),
      { amountPaise: (50_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
    );
    expect(await warehouse()).toBe(156n * QTL);
    expect((await cash(D1)).paidPaise).toBe(50_000n * RS);

    // Edit the purchase: 50 qtl, ₹2,500, dated D2.
    const { _id: _p, ...pRest } = bill as DraftOf<"PURCHASE"> & { _id: string };
    await saveDoc(
      GA,
      {
        ...pRest,
        weight: manualWeight(50n * QTL),
        ratePaisePerQtl: (2500n * RS).toString(),
        transactionDate: D2,
      } as DraftOf<"PURCHASE">,
      { id: bill._id, reason: "ওজন ভুল" },
    );
    expect(await warehouse()).toBe(150n * QTL);
    const dues = (await partyDues(GA)).find((r) => r.party._id === G.farmer)!;
    expect(dues.balancePaise).toBe(-(125_000n - 50_000n) * RS);

    // Edit the payment: ₹40,000 on D2 instead of ₹50,000 on D1 → the cashbook moves.
    const { _id: _q, ...payRest } = payment as DraftOf<"PAYMENT"> & { _id: string };
    await saveDoc(
      GA,
      { ...payRest, amountPaise: (40_000n * RS).toString(), paymentDate: D2 } as DraftOf<"PAYMENT">,
      { id: payment!._id },
    );
    expect((await cash(D1)).paidPaise).toBe(0n);
    expect((await cash(D2)).paidPaise).toBe(40_000n * RS);
    expect((await godownBalances(GA)).get(`PARTY:${G.farmer}`)).toBe(-85_000n * RS);
    // The register report follows the edit.
    const reg = await runReport(reportById("purchase-register")!, {
      godownIds: [GA],
      golaName: () => "RP",
      from: D0,
      to: TODAY,
      t,
    });
    expect(reg.rows).toHaveLength(1);
    expect(reg.rows[0]![6]).toEqual({ m: 125_000n * RS });
    await noDuplicates();

    // Void (with its payment) → exactly the state before.
    await voidDoc(GA, bill._id, "ভুল এন্ট্রি", { withPayments: true });
    expect(await snapshot()).toEqual(before);
    await noDuplicates();
  });

  it("sale, expense and mill dispatch edits recalculate; voids restore", async () => {
    const before = await snapshot();
    const sale = await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 10n * QTL, 2600n * RS, D1),
      null,
    );
    await payBill(GA, sale.bill, {
      amountPaise: (5_000n * RS).toString(),
      paymentDate: D1,
      mode: "CASH",
    });
    const exp = await saveBillWithInitialPayment(GA, expenseDraft(3_000n * RS, D1), {
      amountPaise: (3_000n * RS).toString(),
      paymentDate: D1,
      mode: "CASH",
    });
    const disp = await saveDoc(GA, {
      type: "MILL_DISPATCH",
      dispatchType: "MILLING",
      millPartyId: G.mill,
      dispatchDate: D1,
      varietyId: G.variety.SWARNA!,
      weight: manualWeight(20n * QTL),
      ratePaisePerQtl: "0",
      totalValuePaise: "0",
    } as DraftOf<"MILL_DISPATCH">);
    expect(await warehouse()).toBe(70n * QTL);
    const mid = await snapshot();

    // Sale 10 → 12 qtl; expense ₹3,000 → ₹3,500 (dated D2); dispatch 20 → 15 qtl.
    const { _id: _s, ...sRest } = sale.bill as DraftOf<"SALE"> & { _id: string };
    await saveDoc(GA, { ...sRest, weight: manualWeight(12n * QTL) } as DraftOf<"SALE">, {
      id: sale.bill._id,
    });
    const { _id: _e, ...eRest } = exp.bill as DraftOf<"EXPENSE"> & { _id: string };
    await saveDoc(
      GA,
      { ...eRest, amountPaise: (3_500n * RS).toString(), expenseDate: D2 } as DraftOf<"EXPENSE">,
      { id: exp.bill._id },
    );
    const { _id: _d, ...dRest } = disp as DraftOf<"MILL_DISPATCH"> & { _id: string };
    await saveDoc(GA, { ...dRest, weight: manualWeight(15n * QTL) } as DraftOf<"MILL_DISPATCH">, {
      id: disp._id,
    });
    expect(await warehouse()).toBe(73n * QTL);
    const moves = (await db().stockMoves.toArray()).filter((m) => m.godownId === GA);
    expect(qtyAt(moves, { product: "PADDY", location: "MILL" })).toBe(15n * QTL);
    expect((await godownBalances(GA)).get(`PARTY:${G.customer}`)).toBe(31_200n * RS - 5_000n * RS);
    // The expense payment stays on its own date; the expense is now incurred on D2.
    expect((await cash(D1)).expensesPaise).toBe(3_000n * RS);
    await noDuplicates();

    // Editing back gives exactly the mid state.
    await saveDoc(GA, { ...sRest } as DraftOf<"SALE">, { id: sale.bill._id });
    await saveDoc(GA, { ...eRest } as DraftOf<"EXPENSE">, { id: exp.bill._id });
    await saveDoc(GA, { ...dRest } as DraftOf<"MILL_DISPATCH">, { id: disp._id });
    expect(await snapshot()).toEqual(mid);

    // Void everything → the state before.
    await voidDoc(GA, disp._id, "x");
    await voidDoc(GA, exp.bill._id, "x", { withPayments: true });
    await voidDoc(GA, sale.bill._id, "x", { withPayments: true });
    expect(await snapshot()).toEqual(before);
    await noDuplicates();
  });
});

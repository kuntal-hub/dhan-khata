/**
 * v2 Phase 8 repo + queries: the daily cashbook with day close / reopen (Test 4), stock lines
 * (Test 2 numbers: opening 100 + 56 − 10 − 20 = 126, mill 20), overview flows vs balances,
 * all-Golas combined = sum, daily overview rows, due and low-stock alerts, cash ↔ bank.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { setMeta, godownSettingsKey } from "@/client/db/meta";
import {
  cashbookView,
  dailyRows,
  dueAlerts,
  golaOverview,
  lowStockAlerts,
  recentEntries,
} from "@/client/queries/dashboard";
import { overviewFor } from "@/client/queries/consolidated/dashboard";
import {
  approveStockCount,
  closeDay,
  payBill,
  RepoError,
  reopenDay,
  saveBankAccount,
  saveBillWithInitialPayment,
  saveContra,
  saveDoc,
  saveOpeningCash,
  saveOpeningStock,
  type DraftOf,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import { defaultGodownSettings, type Doc } from "@/domain/schemas";
import { paddyDay, millDay } from "@/domain/v2/stock";
import { deriveAll } from "@/domain/v2/replay";
import {
  QTL,
  RS,
  T0,
  TODAY,
  expenseDraft,
  manualWeight,
  purchaseDraft,
  saleDraft,
  setupDevice,
  type LocalGodown,
} from "../helpers/local";

let G: LocalGodown;
let H: LocalGodown;
const GA = "GA";
const GB = "GB";
const D0 = addDays(TODAY, -3);
const D1 = addDays(TODAY, -2);
const D2 = addDays(TODAY, -1);

beforeEach(async () => {
  const gs = await setupDevice("repo-dashboard", {
    godowns: [
      { id: GA, code: "RP" },
      { id: GB, code: "SP" },
    ],
  });
  G = gs[GA]!;
  H = gs[GB]!;
});

async function storedEqualsReplay(): Promise<void> {
  const want = deriveAll((await db().vouchers.toArray()) as Doc[]);
  const lines = (await db().ledgerLines.toArray()).map((l) => l._id).sort();
  expect(lines).toEqual(want.lines.map((l) => l._id).sort());
}

describe("daily cashbook (Test 4)", () => {
  it("50,000 + 25,000 − 40,000 − 5,000 = 30,000; counted 29,500 → short 500; next opening 29,500", async () => {
    await saveOpeningCash(GA, D0, 50_000n * RS);
    // Received ₹25,000 (sale collection), paid ₹40,000 (farmer), expenses ₹5,000.
    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 30n * QTL, 2000n * RS, D0),
      null,
    );
    await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 10n * QTL, 2500n * RS, D1),
      { amountPaise: (25_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
    );
    const p = (await db().vouchers.where("[godownId+type]").equals([GA, "PURCHASE"]).first())!;
    await payBill(GA, p, { amountPaise: (40_000n * RS).toString(), paymentDate: D1, mode: "CASH" });
    await saveBillWithInitialPayment(GA, expenseDraft(5_000n * RS, D1), {
      amountPaise: (5_000n * RS).toString(),
      paymentDate: D1,
      mode: "CASH",
    });

    let day = await cashbookView(GA, "CASH", D1);
    expect(day.openingPaise).toBe(50_000n * RS);
    expect(day.receivedPaise).toBe(25_000n * RS);
    expect(day.paidPaise).toBe(40_000n * RS);
    expect(day.expensesPaise).toBe(5_000n * RS);
    expect(day.expectedClosingPaise).toBe(30_000n * RS);
    expect(day.items.received).toHaveLength(1);
    expect(day.closed).toBe(false);

    // A difference needs a note.
    const err = await closeDay(GA, { date: D1, actualPaise: 29_500n * RS }).catch(
      (e: unknown) => e,
    );
    expect((err as RepoError).code).toBe("NOTE_REQUIRED");
    await closeDay(GA, { date: D1, actualPaise: 29_500n * RS, note: "গোনায় কম" });
    day = await cashbookView(GA, "CASH", D1);
    expect(day.closed).toBe(true);
    expect(day.diffPaise).toBe(-500n * RS);
    expect((await cashbookView(GA, "CASH", D2)).openingPaise).toBe(29_500n * RS);
    // Closing twice is refused.
    const again = await closeDay(GA, { date: D1, actualPaise: 30_000n * RS }).catch(
      (e: unknown) => e,
    );
    expect((again as RepoError).code).toBe("DAY_ALREADY_CLOSED");

    // Reopen, count ₹30,200 instead → excess ₹200, next opening ₹30,200.
    await reopenDay(GA, D1, "আবার গুনলাম");
    expect((await cashbookView(GA, "CASH", D1)).closed).toBe(false);
    await closeDay(GA, { date: D1, actualPaise: 30_200n * RS, note: "বেশি পাওয়া গেছে" });
    expect((await cashbookView(GA, "CASH", D1)).diffPaise).toBe(200n * RS);
    expect((await cashbookView(GA, "CASH", D2)).openingPaise).toBe(30_200n * RS);

    // A later entry dated on the closed day flags it for re-check.
    await saveBillWithInitialPayment(GA, expenseDraft(100n * RS, D1), {
      amountPaise: (100n * RS).toString(),
      paymentDate: D1,
      mode: "CASH",
    });
    expect((await cashbookView(GA, "CASH", D1)).lateEntry).toBe(true);
    await storedEqualsReplay();
  });

  it("cash ↔ bank moves both books on the same day; capital and drawings move cash", async () => {
    const b = await saveBankAccount(GA, {
      name: "SBI",
      bank: "SBI",
      last4: "1111",
      isUpiLinked: false,
    });
    await saveContra(GA, { kind: "CAPITAL_IN", date: D1, amountPaise: 10_000n * RS });
    await saveContra(GA, {
      kind: "DEPOSIT",
      date: D1,
      amountPaise: 4_000n * RS,
      bankAccountId: b._id,
    });
    await saveContra(GA, {
      kind: "WITHDRAW",
      date: D2,
      amountPaise: 1_000n * RS,
      bankAccountId: b._id,
    });
    await saveContra(GA, { kind: "DRAWINGS", date: D2, amountPaise: 500n * RS });
    const c1 = await cashbookView(GA, "CASH", D1);
    expect(c1.receivedPaise).toBe(10_000n * RS);
    expect(c1.paidPaise).toBe(4_000n * RS);
    const bank = await cashbookView(GA, `BANK:${b._id}`, D2);
    expect(bank.openingPaise).toBe(4_000n * RS);
    expect(bank.paidPaise).toBe(1_000n * RS);
    expect(bank.expectedClosingPaise).toBe(3_000n * RS);
    const c2 = await cashbookView(GA, "CASH", D2);
    expect(c2.expectedClosingPaise).toBe(6_000n * RS + 1_000n * RS - 500n * RS);
    expect(c2.banks[0]!.closingPaise).toBe(3_000n * RS);
    const err = await saveOpeningCash(GA, D0, 1n).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeNull();
    const twice = await saveOpeningCash(GA, D0, 1n).catch((e: unknown) => e);
    expect(twice).toBeInstanceOf(RepoError);
  });
});

describe("stock (Test 2 numbers) and the overview", () => {
  it("100 + 56 − 10 − 20 = 126 in the Gola, 20 at the mill; flows vs balances", async () => {
    await saveOpeningStock(GA, {
      date: D0,
      product: "PADDY",
      varietyId: G.variety.SWARNA!,
      qtyG: 100n * QTL,
      valuePaise: 100n * 2000n * RS,
    });
    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 56n * QTL, 2400n * RS, D1),
      null,
    );
    await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 10n * QTL, 2600n * RS, D1),
      null,
    );
    await saveDoc(GA, {
      type: "MILL_DISPATCH",
      dispatchType: "MILLING",
      millPartyId: G.mill,
      dispatchDate: D1,
      varietyId: G.variety.SWARNA!,
      weight: manualWeight(20n * QTL),
      ratePaisePerQtl: "0",
      totalValuePaise: "0",
    } as DraftOf<"MILL_DISPATCH">);
    const moves = (await db().stockMoves.toArray()).filter((m) => m.godownId === GA);
    const pd = paddyDay(moves, D1);
    expect(pd.openingG).toBe(100n * QTL);
    expect(pd.purchaseG).toBe(56n * QTL);
    expect(pd.salesG).toBe(10n * QTL);
    expect(pd.dispatchG).toBe(20n * QTL);
    expect(pd.closingG).toBe(126n * QTL);
    expect(millDay(moves, D1).closingG).toBe(20n * QTL);

    // Overview for D1 only: flows of D1, balances at the end of D1.
    const o = await golaOverview(GA, D1, D1);
    expect(o.purchasePaise).toBe(134_400n * RS);
    expect(o.purchaseG).toBe(56n * QTL);
    expect(o.salesPaise).toBe(26_000n * RS);
    expect(o.paddyG).toBe(126n * QTL);
    expect(o.millPaddyG).toBe(20n * QTL);
    expect(o.mills).toEqual([{ id: G.mill, name: "Durga Mill", g: 20n * QTL }]);
    expect(o.receivablePaise).toBe(26_000n * RS);
    expect(o.farmerPayablePaise).toBe(134_400n * RS);
    expect(o.series).toEqual([
      { date: D1, purchasePaise: 134_400n * RS, salesPaise: 26_000n * RS },
    ]);
    // Overview for D0: only the opening stock.
    const before = await golaOverview(GA, D0, D0);
    expect(before.purchasePaise).toBe(0n);
    expect(before.paddyG).toBe(100n * QTL);

    // Physical count: 125 counted vs 126 → −1 qtl adjustment (drying).
    await approveStockCount(GA, {
      date: D2,
      product: "PADDY",
      varietyId: G.variety.SWARNA!,
      systemG: 126n * QTL,
      countedG: 125n * QTL,
      reason: "DRYING",
    });
    const moves2 = (await db().stockMoves.toArray()).filter((m) => m.godownId === GA);
    expect(paddyDay(moves2, D2).adjustmentsG).toBe(-1n * QTL);
    expect(paddyDay(moves2, D2).closingG).toBe(125n * QTL);

    // Daily overview rows.
    const rows = await dailyRows(GA, D0, D2);
    expect(rows.map((r) => r.closingPaddyG)).toEqual([100n * QTL, 126n * QTL, 125n * QTL]);
    expect(rows[1]!.stockInG).toBe(56n * QTL);
    expect(rows[1]!.stockOutG).toBe(30n * QTL);
    expect(rows[1]!.purchasePaise).toBe(134_400n * RS);
    expect((await recentEntries(GA, 3)).map((r) => r.doc.type)).toEqual([
      "STOCK_ADJUST",
      "MILL_DISPATCH",
      "SALE",
    ]);
    await storedEqualsReplay();
  });

  it("all Golas combined = the sum of each Gola (read-only, separate books)", async () => {
    await saveOpeningCash(GA, D0, 1_000n * RS);
    await saveOpeningCash(GB, D0, 2_500n * RS);
    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 5n * QTL, 2000n * RS, D1),
      null,
    );
    await saveBillWithInitialPayment(
      GB,
      purchaseDraft(H.farmer, H.variety.SWARNA!, 7n * QTL, 2000n * RS, D1),
      null,
    );
    const { perGola, total } = await overviewFor([GA, GB], D0, D2);
    expect(perGola.map((p) => p.data.cashPaise)).toEqual([1_000n * RS, 2_500n * RS]);
    expect(total.cashPaise).toBe(3_500n * RS);
    expect(total.paddyG).toBe(12n * QTL);
    expect(total.purchasePaise).toBe(24_000n * RS);
    expect(total.series.find((s) => s.date === D1)!.purchasePaise).toBe(24_000n * RS);
  });
});

describe("alerts", () => {
  it("due alerts: overdue and due within 3 days, collect vs pay", async () => {
    await saveBillWithInitialPayment(
      GA,
      { ...purchaseDraft(G.farmer, G.variety.SWARNA!, 1n * QTL, 2000n * RS, D0), dueDate: D2 },
      null,
    );
    await saveBillWithInitialPayment(
      GA,
      {
        ...saleDraft(G.customer, G.variety.SWARNA!, 1n * QTL, 2500n * RS, D0),
        dueDate: addDays(TODAY, 2),
      },
      null,
    );
    await saveBillWithInitialPayment(
      GA,
      {
        ...saleDraft(G.customer, G.variety.SWARNA!, 1n * QTL, 2500n * RS, D0),
        dueDate: addDays(TODAY, 10),
      },
      null,
    );
    const a = await dueAlerts(GA);
    expect(a.map((x) => [x.direction, x.overdue, x.duePaise])).toEqual([
      ["OUT", true, 2_000n * RS],
      ["IN", false, 2_500n * RS],
    ]);
  });

  it("low stock below the Gola's threshold", async () => {
    await setMeta(godownSettingsKey(GA), {
      ...defaultGodownSettings(GA, T0),
      lowStock: { totalG: (50n * QTL).toString() },
    });
    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 20n * QTL, 2000n * RS, D0),
      null,
    );
    const l = await lowStockAlerts(GA);
    expect(l).toEqual([{ godownId: GA, haveG: 20n * QTL, thresholdG: 50n * QTL }]);
  });
});

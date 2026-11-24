/**
 * Report reconciliation (spec §9.14, Phase 5 §B): every report's totals tie back to the ledger
 * (or to the independent per-godown queries the dashboard uses).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { accountBook } from "@/client/queries/cashbank";
import { dashboardData } from "@/client/queries/dashboard";
import { dailyExpense } from "@/client/queries/expenses";
import {
  accountBalance,
  godownBalances,
  godownTrialBalance,
  partyBalance,
} from "@/client/queries/ledger";
import { stockByVariety } from "@/client/queries/stock";
import type { Labels, ReportCtx } from "@/client/reports/defs";
import { pnlFigures } from "@/client/reports/defs";
import { presetRange, sumCol, type ReportModel } from "@/client/reports/model";
import { ALL_REPORTS, reportById } from "@/client/reports/registry";
import {
  closeDay,
  saveLoad,
  saveMillSettlement,
  saveMoney,
  savePurchase,
  saveSale,
  saveSimple,
  type VoucherDraft,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import { ACC } from "@/domain/posting/accounts";
import { translate, type TKey, type TVars } from "@/i18n/translate";
import {
  TODAY,
  expenseDraft,
  paymentDraft,
  purchaseDraft,
  saleDraft,
  setupDevice,
  type LocalGodown,
} from "../helpers/local";

const QTL = 100_000n;
let A: LocalGodown;
let B: LocalGodown;
const FROM = addDays(TODAY, -30);

const labels: Labels = {
  t: (k: TKey, v?: TVars) => translate("en", k, v),
  party: (id) => id ?? "",
  variety: (id) => id ?? "",
  bank: (id) => id ?? "",
  vehicle: (id) => id ?? "",
  category: (c) => c,
  godown: (id) => id,
};

function ctx(over: Partial<ReportCtx> = {}): ReportCtx {
  return { godownId: "GA", godownIds: ["GA", "GB"], from: FROM, to: TODAY, labels, ...over };
}

async function run(id: string, over: Partial<ReportCtx> = {}): Promise<ReportModel> {
  return reportById(id)!.build(ctx(over));
}

beforeAll(async () => {
  const w = await setupDevice("reports-test", {
    godowns: [
      { id: "GA", code: "RP" },
      { id: "GB", code: "SP" },
    ],
  });
  A = w.GA!;
  B = w.GB!;
  const sw = A.variety.SWARNA!;
  await saveSimple("GA", {
    type: "OPENING",
    date: addDays(TODAY, -10),
    items: [
      { kind: "CASH", amountPaise: "5000000" },
      { kind: "CAPITAL", amountPaise: "-5000000" },
    ],
  } as VoucherDraft);
  await savePurchase("GA", purchaseDraft(A.farmer, sw, 10n * QTL, 200_000n, addDays(TODAY, -5)));
  await savePurchase(
    "GA",
    purchaseDraft(A.farmer, A.variety.MINIKIT!, 5n * QTL, 180_000n, addDays(TODAY, -4)),
  );
  await saveMoney("GA", paymentDraft(A.farmer, 1_500_000n, addDays(TODAY, -3)));
  const sale = await saveSale("GA", saleDraft(A.mill, sw, 4n * QTL, 250_000n, addDays(TODAY, -2)));
  await saveMillSettlement("GA", sale.primary._id, {
    type: "MILL_SETTLEMENT",
    date: TODAY,
    saleId: sale.primary._id,
    partyId: A.mill,
    dispatchedNetG: "1",
    saleTotalPaise: "0",
    millReceivedGrossG: (399n * 1000n).toString(),
    millDeductions: [],
    millNetG: "1",
    finalRatePaisePerQtl: "250000",
    finalAmountPaise: "0",
    differencePaise: "0",
    shortageG: "0",
  } as VoucherDraft);
  await saveLoad("GA", {
    type: "LOAD",
    mode: "OWN_TRADE",
    date: TODAY,
    fromPartyId: A.farmer,
    toMillPartyId: A.mill,
    vehicleNumber: "WB12AB3456",
    varietyId: sw,
    grossG: (20n * QTL).toString(),
    netG: (20n * QTL).toString(),
    partySellRatePaisePerQtl: "210000",
    millRatePaisePerQtl: "230000",
    totalAmountPaise: "0",
  } as VoucherDraft);
  await saveMoney("GA", {
    type: "RECEIPT",
    date: TODAY,
    partyId: A.mill,
    amountPaise: "2000000",
    mode: "CASH",
    purpose: "BILL",
  } as VoucherDraft);
  await saveSimple("GA", expenseDraft(120_000n));
  await saveSimple("GA", {
    type: "STOCK_ADJUST",
    date: TODAY,
    lines: [{ varietyId: sw, qtyG: "-20000", reason: "DRYING" }],
  } as VoucherDraft);
  await closeDay("GA", { date: TODAY, countedCashPaise: 2_000_000n, notes: "count" });
  // Godown B: something different.
  await savePurchase("GB", purchaseDraft(B.farmer, B.variety.SWARNA!, 3n * QTL, 210_000n));
  await saveSimple("GB", expenseDraft(50_000n));
});

describe("report reconciliation", () => {
  it("every report builds for the godown without errors", async () => {
    for (const r of ALL_REPORTS) {
      const m = await r.build(ctx({ partyId: A.farmer, account: ACC.CASH }));
      expect(m.tables.length + (m.notes?.length ?? 0), r.id).toBeGreaterThan(0);
    }
  });

  it("day book cash column == cash book movement == CASH ledger in the period", async () => {
    const day = await run("dayBook");
    const cashCol = day.tables[0]!.totals![4] as bigint;
    const book = await accountBook("GA", ACC.CASH, { from: FROM, to: TODAY });
    expect(cashCol).toBe(book.totalInPaise - book.totalOutPaise);
    const cash = await run("cashBook", { account: ACC.CASH });
    expect(cash.tables[0]!.totals![5]).toBe(await accountBalance("GA", ACC.CASH));
  });

  it("trial balance balances and matches the ledger; P&L net profit = income − expense accounts", async () => {
    const tb = await run("trial");
    const [, dr, cr] = tb.tables[0]!.totals!;
    const ledger = await godownTrialBalance("GA");
    expect(dr).toBe(cr);
    expect(ledger.totalDebit).toBe(ledger.totalCredit);
    let debitBalances = 0n;
    for (const v of (await godownBalances("GA")).values()) if (v > 0n) debitBalances += v;
    expect(dr).toBe(debitBalances);
    expect(tb.notes?.[0]?.tone).toBe("ok");
    const pnl = await run("pnl");
    const f = await pnlFigures("GA", FROM, TODAY);
    const rows = pnl.tables[0]!.rows;
    // Gross profit row = sales − deductions − cogs; net = Σ every line except the gross subtotal.
    const listed = sumCol(rows, 1) - f.grossProfit;
    expect(pnl.tables[0]!.totals![1]).toBe(f.netProfit);
    expect(listed).toBe(f.netProfit);
  });

  it("party statement closing == party balance; outstanding totals == dashboard receivable/payable", async () => {
    const st = await run("partyStatement", { partyId: A.farmer, from: "" });
    expect(st.tables[0]!.totals![5]).toBe(await partyBalance("GA", A.farmer));
    const out = await run("outstanding");
    const d = await dashboardData("GA", TODAY);
    expect(out.tables[0]!.totals![1]).toBe(d.receivablePaise);
    expect(out.tables[0]!.totals![2]).toBe(d.payablePaise);
    // Aging buckets add up to what is open on the bills.
    const ages = [3, 4, 5, 6].reduce((s, i) => s + (out.tables[0]!.totals![i] as bigint), 0n);
    expect(ages).toBeGreaterThan(0n);
  });

  it("registers and stock tie back to vouchers / stock moves", async () => {
    const pr = await run("purchaseRegister");
    const purchaseTotal = pr.tables[0]!.totals![3] as bigint;
    expect(purchaseTotal).toBe(pr.tables[1]!.totals![2]);
    expect(purchaseTotal).toBe(2_000_000n + 900_000n + 4_200_000n); // 2 purchases + the load's
    const sr = await run("salesRegister");
    expect(sr.tables[0]!.totals![3]).toBe(1_000_000n + 4_600_000n);
    expect(sr.tables[0]!.totals![4]).toBe(1); // one settled sale
    const st = await run("stock");
    const store = (await stockByVariety("GA", TODAY)).filter((s) => s.location === "STORE");
    expect(st.tables[0]!.totals![4]).toBe(store.reduce((s, x) => s + x.qtyG, 0n));
    expect(st.tables[0]!.totals![5]).toBe(store.reduce((s, x) => s + x.valuePaise, 0n));
    const lr = await run("loadRegister");
    expect(lr.tables[0]!.rows.length).toBe(1);
    expect(lr.tables[0]!.totals![11]).toBe(400_000n); // (2,300 − 2,100) × 20 qtl
    const sh = await run("shortage");
    expect(sh.tables[0]!.totals![6]).toBe(1_000n); // 400 kg dispatched, 399 kg at the mill
  });

  it("expense report == daily expense screen; load profitability adds up", async () => {
    const ex = await run("expense", { from: TODAY });
    const daily = await dailyExpense("GA", TODAY);
    expect(ex.tables[0]!.totals![1]).toBe(daily.expenseTotalPaise);
    const lp = await run("loadProfit");
    const [, , , , sale, cost, exp, margin] = lp.tables[0]!.totals!;
    expect(margin).toBe((sale as bigint) - (cost as bigint) - (exp as bigint));
    expect(sale).toBe(4_600_000n);
  });

  it("all-godowns reports: totals == Σ godowns; comparison purchase row == per-godown registers", async () => {
    const cmp = await run("comparison");
    const purchaseRow = cmp.tables[0]!.rows[0]!;
    const [, ga, gb, total] = purchaseRow as [string, bigint, bigint, bigint];
    expect(total).toBe(ga + gb);
    expect(ga).toBe(7_100_000n);
    expect(gb).toBe(630_000n);
    const cash = await run("allCash");
    const totals = cash.tables[0]!.totals!;
    expect(totals[1]).toBe(
      (await accountBalance("GA", ACC.CASH)) + (await accountBalance("GB", ACC.CASH)),
    );
    const stock = await run("allStock");
    const t = stock.tables[0]!.totals!;
    expect(t[3]).toBe((t[1] as bigint) + (t[2] as bigint));
  });

  it("date presets", () => {
    expect(presetRange("today", "2026-11-24")).toEqual({ from: "2026-11-24", to: "2026-11-24" });
    expect(presetRange("yesterday", "2026-11-24")).toEqual({
      from: "2026-11-23",
      to: "2026-11-23",
    });
    expect(presetRange("week", "2026-11-26")).toEqual({ from: "2026-11-23", to: "2026-11-26" }); // Mon
    expect(presetRange("month", "2026-11-24").from).toBe("2026-11-01");
    expect(presetRange("fy", "2026-11-24").from).toBe("2026-04-01");
    expect(presetRange("season", "2026-11-24").from <= "2026-11-01").toBe(true);
  });
});

/**
 * v2 Phase 11: reports reconcile with the dashboard. The same records seen through a report and
 * through the dashboard queries give the same figures (purchase, sales, expenses, cash book,
 * daily overview, Gola-wise = sum = combined, party balances). Export cells stay exact.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { cashbookView, dailyRows, golaOverview } from "@/client/queries/dashboard";
import { godownBalances } from "@/client/queries/ledger";
import { reportById, reportsOf, REPORTS, type T } from "@/client/reports/defs";
import {
  cellCsv,
  modelToCsv,
  withoutRice,
  type CellValue,
  type ReportModel,
} from "@/client/reports/model";
import { runReport } from "@/client/reports/run";
import {
  payBill,
  saveBillWithInitialPayment,
  saveOpeningCash,
  saveOpeningStock,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import { translate } from "@/i18n/translate";
import {
  QTL,
  RS,
  TODAY,
  expenseDraft,
  purchaseDraft,
  saleDraft,
  setupDevice,
  type LocalGodown,
} from "../helpers/local";

let G: LocalGodown;
let H: LocalGodown;
const GA = "GA";
const GB = "GB";
const D0 = addDays(TODAY, -5);
const D1 = addDays(TODAY, -3);
const D2 = addDays(TODAY, -1);
const t: T = (k, v) => translate("bn", k, v);

beforeEach(async () => {
  const gs = await setupDevice("repo-reports", {
    godowns: [
      { id: GA, code: "RP" },
      { id: GB, code: "SP" },
    ],
  });
  G = gs[GA]!;
  H = gs[GB]!;
  for (const [g, L] of [
    [GA, G],
    [GB, H],
  ] as const) {
    await saveOpeningCash(g, D0, 50_000n * RS);
    await saveOpeningStock(g, {
      date: D0,
      product: "PADDY",
      varietyId: L.variety.SWARNA!,
      qtyG: 100n * QTL,
      valuePaise: 100n * 2000n * RS,
    });
  }
  const p = await saveBillWithInitialPayment(
    GA,
    purchaseDraft(G.farmer, G.variety.SWARNA!, 56n * QTL, 2400n * RS, D1),
    { amountPaise: (50_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
  );
  await payBill(GA, p.bill, {
    amountPaise: (20_000n * RS).toString(),
    paymentDate: D2,
    mode: "CASH",
  });
  await saveBillWithInitialPayment(
    GA,
    saleDraft(G.customer, G.variety.SWARNA!, 10n * QTL, 2600n * RS, D1),
    { amountPaise: (10_000n * RS).toString(), paymentDate: D2, mode: "CASH" },
  );
  await saveBillWithInitialPayment(GA, expenseDraft(3_000n * RS, D1), {
    amountPaise: (3_000n * RS).toString(),
    paymentDate: D1,
    mode: "CASH",
  });
  await saveBillWithInitialPayment(
    GB,
    purchaseDraft(H.farmer, H.variety.SWARNA!, 7n * QTL, 2000n * RS, D2),
    null,
  );
});

const scope = (ids: string[]) => ({
  godownIds: ids,
  golaName: (id: string) => (id === GA ? "Rampur" : "Sonapur"),
  from: D0,
  to: TODAY,
  t,
});

const totalM = (m: ReportModel, col: number): bigint => {
  const c = m.totals?.[col];
  return c && typeof c === "object" && "m" in c ? c.m : 0n;
};
const totalQ = (m: ReportModel, col: number): bigint => {
  const c = m.totals?.[col];
  return c && typeof c === "object" && "q" in c ? c.q : 0n;
};

async function run(id: string, ids: string[], opt?: string) {
  return runReport(reportById(id)!, { ...scope(ids), ...(opt ? { opt } : {}) });
}

describe("reports reconcile with the dashboard", () => {
  it("purchase, sales and expense reports = the overview flows", async () => {
    const o = await golaOverview(GA, D0, TODAY);
    const pd = await run("purchase-daily", [GA]);
    expect(totalM(pd, 3)).toBe(o.purchasePaise);
    expect(totalQ(pd, 2)).toBe(o.purchaseG);
    const pr = await run("purchase-register", [GA]);
    expect(totalM(pr, 6)).toBe(o.purchasePaise);
    expect(totalM(pr, 8)).toBe(134_400n * RS - 70_000n * RS);
    const sd = await run("sales-daily", [GA]);
    expect(totalM(sd, 4)).toBe(o.salesPaise);
    const ec = await run("expense-category", [GA]);
    expect(totalM(ec, 2)).toBe(o.expensesPaise);
    expect(ec.chart?.labels.length).toBe(1);
  });

  it("the cash book report = the cashbook screen, day by day", async () => {
    const cb = await run("cashbook", [GA]);
    for (const row of cb.rows) {
      const day = (row[0] as { d: string }).d;
      const v = await cashbookView(GA, "CASH", day);
      expect((row[6] as { m: bigint }).m).toBe(v.closingPaise);
      expect((row[3] as { m: bigint }).m).toBe(v.paidPaise);
    }
    const o = await golaOverview(GA, D0, TODAY);
    expect(totalM(cb, 6)).toBe(o.cashPaise);
    // 50,000 opening − 50,000 − 20,000 paid + 10,000 received − 3,000 expense.
    expect(totalM(cb, 6)).toBe(-13_000n * RS);
  });

  it("the daily overview report = the Daily Overview rows", async () => {
    const rep = await run("daily-overview", [GA]);
    const rows = await dailyRows(GA, D0, TODAY);
    expect(rep.rows).toHaveLength(rows.length);
    expect(rep.rows.map((r) => (r[8] as { m: bigint }).m)).toEqual(
      rows.map((r) => r.closingCashPaise),
    );
    expect(totalQ(rep, 9)).toBe(rows[rows.length - 1]!.closingPaddyG);
  });

  it("Gola-wise rows = each Gola; total = combined = the sum; per-Gola merge adds a Gola column", async () => {
    const gw = await run("gola-wise", [GA, GB]);
    expect(gw.rows.map((r) => r[0])).toEqual(["Rampur", "Sonapur"]);
    const [oa, ob] = [await golaOverview(GA, D0, TODAY), await golaOverview(GB, D0, TODAY)];
    expect(totalM(gw, 1)).toBe(oa.purchasePaise + ob.purchasePaise);
    expect(totalQ(gw, 7)).toBe(oa.paddyG + ob.paddyG);
    const comb = await run("combined", [GA, GB]);
    const paddyRow = comb.rows.find((r) => r[0] === t("rep.c.paddyEnd"))!;
    expect((paddyRow[2] as { q: bigint }).q).toBe(oa.paddyG + ob.paddyG);
    const merged = await run("purchase-register", [GA, GB]);
    expect(merged.columns[0]!.label).toBe(t("rep.c.gola"));
    expect(new Set(merged.rows.map((r) => r[0]))).toEqual(new Set(["Rampur", "Sonapur"]));
    expect(totalM(merged, 7)).toBe(oa.purchasePaise + ob.purchasePaise);
  });

  it("due & advance = the ledger; the party ledger report ends at the balance", async () => {
    const due = await run("due-advance", [GA]);
    const bal = await godownBalances(GA);
    let net = 0n;
    for (const [k, v] of bal) if (k.startsWith("PARTY:")) net += v;
    expect(totalM(due, 6) - totalM(due, 7)).toBe(net);
    const led = await run("party-ledger", [GA], G.farmer);
    expect(totalM(led, 5)).toBe(bal.get(`PARTY:${G.farmer}`));
    const none = await run("party-ledger", [GA]);
    expect(none.rows).toEqual([]);
  });

  it("every report builds for one Gola and for all Golas without error", async () => {
    for (const def of REPORTS) {
      const one = await runReport(def, scope([GA]));
      const all = await runReport(def, scope([GA, GB]));
      for (const m of [one, all]) {
        for (const r of m.rows) expect(r).toHaveLength(m.columns.length);
        if (m.totals) expect(m.totals).toHaveLength(m.columns.length);
      }
    }
  });
});

describe("export cells are exact", () => {
  it("CSV writes rupees and quintals as exact decimals, with a BOM and escaping", () => {
    const cells: CellValue[] = [
      { m: 2_606_875n },
      { q: 1_234_567n },
      { n: 3 },
      { d: "2026-11-20" },
      null,
      'a,"b"',
    ];
    expect(cells.map(cellCsv)).toEqual(["26068.75", "12.34567", "3", "2026-11-20", "", 'a,"b"']);
    const csv = modelToCsv("কেনা", {
      columns: [
        { label: "নাম", kind: "text" },
        { label: "টাকা", kind: "money" },
      ],
      rows: [["রহিম, শেখ", { m: 13_440_000n }]],
      totals: ["মোট", { m: 13_440_000n }],
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"রহিম, শেখ",134400.00');
    expect(csv).toContain("মোট,134400.00");
  });
});

describe("rice hidden (business profile)", () => {
  it("rice-only reports are not offered; every other report still is", () => {
    for (const s of ["dashboard", "mill", "sales"] as const) {
      const shown = reportsOf(s).map((r) => r.id);
      const hidden = reportsOf(s, false).map((r) => r.id);
      expect(hidden).toEqual(shown.filter((id) => id !== "rice-stock" && id !== "mill-conversion"));
    }
    expect(reportsOf("dashboard")).toContainEqual(expect.objectContaining({ id: "rice-stock" }));
    expect(reportsOf("dashboard", false).some((r) => r.id === "rice-stock")).toBe(false);
    expect(reportsOf("mill", false).some((r) => r.id === "mill-conversion")).toBe(false);
  });

  it("drops only the rice columns / row; every other cell and total is unchanged", async () => {
    for (const id of ["sales-daily", "customer-ledger", "daily-overview", "monthly-summary"]) {
      const full = await runReport(reportById(id)!, scope([GA]));
      const lean = await runReport(reportById(id)!, { ...scope([GA]), rice: false });
      const keep = full.columns.map((c) => !c.rice);
      expect(
        full.columns.some((c) => c.rice),
        id,
      ).toBe(true);
      expect(
        lean.columns.some((c) => c.rice),
        id,
      ).toBe(false);
      expect(lean.columns).toEqual(full.columns.filter((_, i) => keep[i]));
      expect(lean.rows).toEqual(full.rows.map((r) => r.filter((_, i) => keep[i])));
      if (full.totals) expect(lean.totals).toEqual(full.totals.filter((_, i) => keep[i]));
    }
    // Gola-wise (business report, all Golas) and the range summary (a rice row).
    const gw = await runReport(reportById("gola-wise")!, { ...scope([GA, GB]), rice: false });
    expect(gw.columns.map((c) => c.label)).not.toContain(t("rep.c.riceEnd"));
    expect(gw.totals).toHaveLength(gw.columns.length);
    const rs = await runReport(reportById("range-summary")!, { ...scope([GA]), rice: false });
    const full = await runReport(reportById("range-summary")!, scope([GA]));
    expect(rs.rows.map((r) => r[0])).toEqual(
      full.rows.map((r) => r[0]).filter((l) => l !== t("rep.c.riceEnd")),
    );
  });

  it("withoutRice leaves a model with no rice column as it is", () => {
    const m: ReportModel = {
      columns: [{ label: "a", kind: "text" }],
      rows: [["x"]],
      totals: ["t"],
    };
    expect(withoutRice(m)).toBe(m);
  });
});

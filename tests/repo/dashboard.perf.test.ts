/**
 * Dashboard performance budget (spec §9.1, §15): with 50k vouchers in IndexedDB the dashboard
 * queries finish in < 300 ms, because they read the `dailyAgg` cache (O(days)) plus one indexed
 * day range — and the cache can be rebuilt from scratch with identical results.
 */
import { describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { dashboardData } from "@/client/queries/dashboard";
import { rebuildDailyAgg, saveSimple, type VoucherDraft } from "@/client/repo";
import { addDays } from "@/domain/dates";
import { serializeDerived } from "@/domain/posting/derive";
import { post } from "@/domain/posting/post";
import type { LedgerLine, StockMove, Voucher } from "@/domain/schemas";
import {
  TODAY,
  expenseDraft,
  paymentDraft,
  purchaseDraft,
  saleDraft,
  setupDevice,
} from "../helpers/local";
import { baseFields, line } from "../helpers/factory";

const QTL = 100_000n;
const N = 50_000;
const DAYS = 1_000;

function seedVoucher(i: number, godownId: string, variety: string): Voucher {
  const date = addDays(TODAY, -(i % DAYS));
  const party = `P${String(i % 400).padStart(4, "0")}`;
  const base = baseFields("PAYMENT", {
    godownId,
    date,
    _id: `seed-${String(i).padStart(6, "0")}`,
    createdAt: `${date}T0${i % 10}:00:00.000Z`,
  });
  switch (Math.floor(i / DAYS) % 5) {
    case 0:
      return {
        ...base,
        number: `RP-A-PUR-${i}`,
        type: "PURCHASE",
        partyId: party,
        storeAt: "STORE",
        lines: [
          {
            ...line(variety, 10n * QTL, 200_000n),
            netG: (10n * QTL).toString(),
            amountPaise: "2000000",
          },
        ],
        charges: [],
        roundToRupee: false,
        roundOffPaise: "0",
        totalPaise: "2000000",
      } as Voucher;
    case 1:
      return {
        ...base,
        number: `RP-A-PAY-${i}`,
        type: "PAYMENT",
        partyId: party,
        amountPaise: "500000",
        mode: "CASH",
        purpose: "BILL",
      } as Voucher;
    case 2:
      return {
        ...base,
        number: `RP-A-RCP-${i}`,
        type: "RECEIPT",
        partyId: party,
        amountPaise: "700000",
        mode: "CASH",
        purpose: "BILL",
      } as Voucher;
    case 3:
      return {
        ...base,
        number: `RP-A-EXP-${i}`,
        type: "EXPENSE",
        categoryCode: "LABOUR",
        amountPaise: "12000",
        mode: "CASH",
        description: "labour",
      } as Voucher;
    default:
      return {
        ...base,
        number: `RP-A-SAL-${i}`,
        type: "SALE",
        partyId: party,
        vehicleNumber: "WB12AB3456",
        source: "STORE",
        lines: [
          {
            ...line(variety, 5n * QTL, 230_000n),
            netG: (5n * QTL).toString(),
            amountPaise: "1150000",
          },
        ],
        charges: [],
        roundToRupee: false,
        roundOffPaise: "0",
        totalPaise: "1150000",
        duePaise: "1150000",
        settlementStatus: "PENDING",
      } as Voucher;
  }
}

describe("dashboard performance (§9.1 / §15)", () => {
  it(`dashboard queries over ${N} vouchers finish in < 300 ms`, { timeout: 600_000 }, async () => {
    const w = await setupDevice("dash-perf", { godowns: [{ id: "GP", code: "RP" }] });
    const variety = w.GP!.variety.SWARNA!;
    const d = db();
    const BATCH = 5_000;
    for (let start = 0; start < N; start += BATCH) {
      const vs: Voucher[] = [];
      const lines: LedgerLine[] = [];
      const moves: StockMove[] = [];
      for (let i = start; i < Math.min(N, start + BATCH); i++) {
        const v = seedVoucher(i, "GP", variety);
        vs.push(v);
        const derived = serializeDerived(v, post(v));
        lines.push(...derived.lines);
        moves.push(...derived.moves);
      }
      await d.transaction("rw", d.vouchers, d.ledgerLines, d.stockMoves, async () => {
        await d.vouchers.bulkPut(vs);
        await d.ledgerLines.bulkPut(lines);
        await d.stockMoves.bulkPut(moves);
      });
    }
    expect(await d.vouchers.count()).toBe(N);
    const days = await rebuildDailyAgg("GP");
    expect(days).toBe(DAYS);

    await dashboardData("GP", TODAY); // first open (cold caches)
    const runs: number[] = [];
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      const data = await dashboardData("GP", TODAY);
      runs.push(performance.now() - t0);
      expect(data.purchaseCount).toBe(N / 5 / DAYS);
    }
    const best = Math.min(...runs);
    console.info(`dashboard over ${N} vouchers: ${runs.map((r) => r.toFixed(1)).join(" / ")} ms`);
    expect(best).toBeLessThan(300);
  });

  it("dailyAgg is maintained by writes and a rebuild gives identical dashboard figures", async () => {
    const w = await setupDevice("dash-rebuild", { godowns: [{ id: "GR", code: "RP" }] });
    const g = w.GR!;
    await saveSimple(
      "GR",
      purchaseDraft(g.farmer, g.variety.SWARNA!, 10n * QTL, 200_000n, addDays(TODAY, -3)),
    );
    await saveSimple(
      "GR",
      saleDraft(g.mill, g.variety.SWARNA!, 4n * QTL, 240_000n, addDays(TODAY, -1)),
    );
    await saveSimple("GR", paymentDraft(g.farmer, 1_000_000n));
    await saveSimple("GR", expenseDraft(20_000n) as VoucherDraft);
    const before = await dashboardData("GR", TODAY);
    const rows = await db().dailyAgg.toArray();
    await db().dailyAgg.clear();
    await rebuildDailyAgg("GR");
    expect(await db().dailyAgg.toArray()).toEqual(rows);
    expect(await dashboardData("GR", TODAY)).toEqual(before);
  });
});

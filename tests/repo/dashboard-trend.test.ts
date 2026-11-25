/**
 * Dashboard 30-day trend (UI refresh): closing cash / bank per day and purchase / sales per day,
 * matching the overview's balances; all Golas = per-day sum. Read-only derivation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { golaOverview, golaTrend } from "@/client/queries/dashboard";
import { trendFor } from "@/client/queries/consolidated/dashboard";
import { saveBillWithInitialPayment, saveOpeningCash } from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Doc } from "@/domain/schemas";
import {
  QTL,
  RS,
  TODAY,
  purchaseDraft,
  saleDraft,
  setupDevice,
  type LocalGodown,
} from "../helpers/local";

let G: LocalGodown;
const GA = "GA";
const GB = "GB";
const D0 = addDays(TODAY, -3);
const D1 = addDays(TODAY, -2);
const D2 = addDays(TODAY, -1);

beforeEach(async () => {
  const gs = await setupDevice("repo-dashboard-trend", {
    godowns: [
      { id: GA, code: "RP" },
      { id: GB, code: "SP" },
    ],
  });
  G = gs[GA]!;
});

async function totalOf(type: "PURCHASE" | "SALE"): Promise<bigint> {
  const d = (await db().vouchers.where("[godownId+type]").equals([GA, type]).first()) as Doc;
  return BigInt((d as Doc & { totalPaise: string }).totalPaise);
}

describe("golaTrend", () => {
  it("gives one point per day with running cash and the day's purchase / sales", async () => {
    await saveOpeningCash(GA, D0, 50_000n * RS);
    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 30n * QTL, 2000n * RS, D1),
      null,
    );
    await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 10n * QTL, 2500n * RS, D2),
      { amountPaise: (25_000n * RS).toString(), paymentDate: D2, mode: "CASH" },
    );
    const purchase = await totalOf("PURCHASE");
    const sale = await totalOf("SALE");

    const pts = await golaTrend(GA, TODAY, 5);
    expect(pts.map((p) => p.date)).toEqual([addDays(TODAY, -4), D0, D1, D2, TODAY]);
    const at = (d: string) => pts.find((p) => p.date === d)!;
    expect(at(addDays(TODAY, -4)).cashPaise).toBe(0n);
    expect(at(D0).cashPaise).toBe(50_000n * RS);
    expect(at(D1).purchasePaise).toBe(purchase);
    expect(at(D1).cashPaise).toBe(50_000n * RS);
    expect(at(D2).salesPaise).toBe(sale);
    expect(at(D2).cashPaise).toBe(75_000n * RS);
    // The last point equals the overview's closing balances.
    const ov = await golaOverview(GA, TODAY, TODAY);
    expect(at(TODAY).cashPaise).toBe(ov.cashPaise);
    expect(at(TODAY).bankPaise).toBe(ov.bankPaise);
  });

  it("carries the opening balance from before the window", async () => {
    await saveOpeningCash(GA, addDays(TODAY, -40), 12_000n * RS);
    const pts = await golaTrend(GA, TODAY, 30);
    expect(pts).toHaveLength(30);
    expect(pts.every((p) => p.cashPaise === 12_000n * RS)).toBe(true);
  });

  it("all Golas = per-day sum", async () => {
    await saveOpeningCash(GA, D0, 50_000n * RS);
    await saveOpeningCash(GB, D1, 10_000n * RS);
    const sum = await trendFor([GA, GB], TODAY, 5);
    const a = await golaTrend(GA, TODAY, 5);
    const b = await golaTrend(GB, TODAY, 5);
    expect(sum.map((p) => p.cashPaise)).toEqual(a.map((p, i) => p.cashPaise + b[i]!.cashPaise));
    expect(sum.at(-1)!.cashPaise).toBe(60_000n * RS);
  });
});

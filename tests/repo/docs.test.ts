/**
 * v2 local write path (src/client/repo/docs.ts): one Dexie transaction per save, derived rows
 * always equal a full replay, linked payments, day close + re-check, duplicate varieties.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { godownBalances, godownTrialBalance, partyBalance } from "@/client/queries/ledger";
import { newId, saveDoc, saveDocs, upsertMaster, voidDoc } from "@/client/repo";
import { deriveAll } from "@/domain/v2/replay";
import type { Doc } from "@/domain/schemas";
import {
  QTL,
  RS,
  TODAY,
  expenseDraft,
  paymentDraft,
  purchaseDraft,
  saleDraft,
  setupDevice,
  type LocalGodown,
} from "../helpers/local";
import { addDays } from "@/domain/dates";

let G: LocalGodown;
const GA = "GA";

beforeEach(async () => {
  const gs = await setupDevice("repo-docs", { godowns: [{ id: GA, code: "RP" }] });
  G = gs[GA]!;
});

async function storedEqualsReplay(): Promise<void> {
  const docs = (await db().vouchers.toArray()) as Doc[];
  const want = deriveAll(docs);
  const lines = await db().ledgerLines.toArray();
  const moves = await db().stockMoves.toArray();
  const key = (x: { _id: string }) => x._id;
  expect(lines.map(key).sort()).toEqual(want.lines.map(key).sort());
  const byId = new Map(want.moves.map((m) => [m._id, m] as const));
  for (const m of moves) expect(m).toEqual(byId.get(m._id));
  const lById = new Map(want.lines.map((l) => [l._id, l] as const));
  for (const l of lines) expect(l).toEqual(lById.get(l._id));
}

describe("documents", () => {
  it("purchase + initial payment in one save: one op group, balanced, cash on the payment date", async () => {
    const id = newId();
    const yesterday = addDays(TODAY, -1);
    await saveDocs(GA, [
      {
        draft: {
          ...purchaseDraft(G.farmer, G.variety.SWARNA!, 56n * QTL, 2400n * RS, yesterday),
          _id: id,
        },
      },
      {
        draft: paymentDraft(
          "OUT",
          50_000n * RS,
          { type: "PURCHASE", id },
          { partyId: G.farmer, isInitial: true },
          TODAY,
        ),
      },
    ]);
    const ops = await db().outbox.toArray();
    expect(ops).toHaveLength(2);
    expect(new Set(ops.map((o) => o.opGroup)).size).toBe(1);
    expect((await godownTrialBalance(GA)).balanced).toBe(true);
    expect(await partyBalance(GA, G.farmer)).toBe(-84_400n * RS);
    const cashLines = await db()
      .ledgerLines.where("[godownId+account+date]")
      .between([GA, "CASH", ""], [GA, "CASH", "￿"])
      .toArray();
    expect(cashLines.map((l) => l.date)).toEqual([TODAY]);
    await storedEqualsReplay();
  });

  it("a payment must match its bill (party and direction) and stay in the Gola", async () => {
    const p = await saveDoc(GA, purchaseDraft(G.farmer, G.variety.SWARNA!, QTL, 2000n * RS));
    await expect(
      saveDoc(GA, paymentDraft("OUT", 100n, { type: "PURCHASE", id: p._id }, { partyId: G.mill })),
    ).rejects.toMatchObject({ code: "SOURCE_MISMATCH" });
    // The direction comes from the source type (v2.1 direction map).
    await expect(
      saveDoc(GA, paymentDraft("IN", 100n, { type: "PURCHASE", id: p._id }, { partyId: G.farmer })),
    ).rejects.toMatchObject({ code: "PAYMENT_DIRECTION_MISMATCH" });
    await expect(
      saveDoc(GA, paymentDraft("OUT", 100n, { type: "SALE", id: p._id }, { partyId: G.farmer })),
    ).rejects.toMatchObject({ code: "PAYMENT_DIRECTION_MISMATCH" });
    // Right direction, wrong kind of source → still refused.
    await expect(
      saveDoc(GA, paymentDraft("IN", 100n, { type: "SALE", id: p._id }, { partyId: G.farmer })),
    ).rejects.toMatchObject({ code: "SOURCE_MISMATCH" });
    // Nothing was written by the failed saves.
    expect(await db().vouchers.count()).toBe(1);
    expect(await db().outbox.count()).toBe(1);
  });

  it("a back-dated purchase re-posts the cost of a later sale (stored rows == replay)", async () => {
    const d0 = addDays(TODAY, -5);
    const d2 = addDays(TODAY, -2);
    await saveDoc(GA, purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 2000n * RS, d0));
    await saveDoc(GA, saleDraft(G.customer, G.variety.SWARNA!, 5n * QTL, 2500n * RS, TODAY));
    await saveDoc(GA, purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 3000n * RS, d2));
    await storedEqualsReplay();
    const bal = await godownBalances(GA);
    // COGS = 5 qtl at the average of 20 qtl (₹50,000): ₹12,500.
    expect(bal.get("COGS")).toBe(12_500n * RS);
  });

  it("edit and void keep the derived rows equal to a replay; void of a paid bill needs both", async () => {
    const id = newId();
    await saveDocs(GA, [
      { draft: { ...purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 2000n * RS), _id: id } },
      { draft: paymentDraft("OUT", 5_000n * RS, { type: "PURCHASE", id }, { partyId: G.farmer }) },
    ]);
    await saveDoc(GA, purchaseDraft(G.farmer, G.variety.SWARNA!, 12n * QTL, 2000n * RS), {
      id,
      reason: "ওজন ভুল",
    });
    expect(await partyBalance(GA, G.farmer)).toBe(-19_000n * RS);
    await storedEqualsReplay();
    await expect(voidDoc(GA, id, "ভুল")).rejects.toMatchObject({ code: "LINKED_PAYMENTS" });
    await voidDoc(GA, id, "ভুল", { withPayments: true });
    expect(await partyBalance(GA, G.farmer)).toBe(0n);
    expect(await godownBalances(GA)).toEqual(new Map());
    await storedEqualsReplay();
  });

  it("a party can't change under a bill's payments", async () => {
    const id = newId();
    await saveDocs(GA, [
      { draft: { ...purchaseDraft(G.farmer, G.variety.SWARNA!, QTL, 2000n * RS), _id: id } },
      { draft: paymentDraft("OUT", 100n, { type: "PURCHASE", id }, { partyId: G.farmer }) },
    ]);
    await expect(
      saveDoc(GA, purchaseDraft(G.mill, G.variety.SWARNA!, QTL, 2000n * RS), { id }),
    ).rejects.toMatchObject({ code: "LINKED_PAYMENTS" });
  });

  it("expense incurred vs paid: unpaid doesn't touch cash; farmer payment can't be an expense", async () => {
    const e = await saveDoc(GA, expenseDraft(5_000n * RS, addDays(TODAY, -4)));
    expect((await godownBalances(GA)).get("CASH")).toBeUndefined();
    await saveDoc(
      GA,
      paymentDraft("OUT", 3_000n * RS, { type: "EXPENSE", id: e._id }, {}, addDays(TODAY, -4)),
    );
    expect((await godownBalances(GA)).get("CASH")).toBe(-3_000n * RS);
    await expect(
      saveDoc(GA, expenseDraft(100n, TODAY, { categoryCode: "FARMER_PAYMENT" })),
    ).rejects.toMatchObject({
      code: "CATEGORY_IS_PAYMENT",
    });
  });

  it("future business dates are blocked", async () => {
    await expect(
      saveDoc(GA, purchaseDraft(G.farmer, G.variety.SWARNA!, QTL, 2000n * RS, addDays(TODAY, 1))),
    ).rejects.toMatchObject({ code: "FUTURE_DATE" });
  });
});

describe("cashbook day close", () => {
  it("one close per day; a back-dated cash entry flags closed days for re-check", async () => {
    const d1 = addDays(TODAY, -3);
    const close = {
      type: "DAY_CLOSE" as const,
      date: d1,
      expectedClosingPaise: "0",
      actualClosingPaise: "0",
      diffPaise: "0",
    };
    await saveDoc(GA, close);
    expect((await db().dayStatus.get(`${GA}:${d1}`))?.closed).toBe(true);
    await expect(saveDoc(GA, close)).rejects.toMatchObject({ code: "DAY_ALREADY_CLOSED" });
    await saveDoc(
      GA,
      paymentDraft(
        "OUT",
        100n,
        { type: "PARTY_ADVANCE", id: null },
        { partyId: G.farmer },
        addDays(TODAY, -4),
      ),
    );
    expect((await db().dayStatus.get(`${GA}:${d1}`))?.lateEntry).toBe(true);
  });

  it("a difference needs a note", async () => {
    await expect(
      saveDoc(GA, {
        type: "DAY_CLOSE",
        date: TODAY,
        expectedClosingPaise: "3000000",
        actualClosingPaise: "2950000",
        diffPaise: "0",
      }),
    ).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
  });
});

describe("varieties", () => {
  it("normalized name + company is unique per Gola", async () => {
    await upsertMaster(GA, "variety", {
      name: "Swarna Sub1",
      product: "PADDY",
      normalizedKey: "",
      verified: false,
      company: "PAN",
    });
    await expect(
      upsertMaster(GA, "variety", {
        name: "  swarna   SUB1 ",
        product: "PADDY",
        normalizedKey: "",
        verified: false,
        company: "PAN",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_VARIETY" });
    // Same name, another company is a different variety.
    await upsertMaster(GA, "variety", {
      name: "Swarna Sub1",
      product: "PADDY",
      normalizedKey: "",
      verified: false,
      company: "MUNDRA",
    });
  });
});

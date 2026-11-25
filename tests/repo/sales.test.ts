/**
 * v2 Phase 6 repo + queries: sale with an advance (one op group), later collections (Test 6),
 * customer ledger and cashbook on the payment dates, ORDER → no stock until confirmed, delivery
 * timeline, direct delivery through TRANSIT, inter-Gola transfer (one op group across both Golas)
 * and its reversal.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { godownBalances, partyBalance } from "@/client/queries/ledger";
import { partyLedger, paymentsOf } from "@/client/queries/purchases";
import {
  customerSummaries,
  openTransitPurchases,
  saleRows,
  saleTotals,
  stockAvailable,
} from "@/client/queries/sales";
import {
  confirmSaleOrder,
  pairedTransferDoc,
  payBill,
  RepoError,
  saveBillWithInitialPayment,
  saveInterGolaTransfer,
  setDeliveryStatus,
  voidDoc,
  voidInterGolaTransfer,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Doc } from "@/domain/schemas";
import { cashbookDay } from "@/domain/v2/cashbook";
import { deriveAll } from "@/domain/v2/replay";
import {
  QTL,
  RS,
  TODAY,
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
const D0 = addDays(TODAY, -6);
const D1 = addDays(TODAY, -4);
const D2 = addDays(TODAY, -2);

beforeEach(async () => {
  const gs = await setupDevice("repo-sales", {
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
  const moves = (await db().stockMoves.toArray()).map((m) => m._id).sort();
  expect(moves).toEqual(want.moves.map((m) => m._id).sort());
}

async function stockIn(godownId = GA, g = 20n * QTL, lg: LocalGodown = G) {
  await saveBillWithInitialPayment(
    godownId,
    purchaseDraft(lg.farmer, lg.variety.SWARNA!, g, 2000n * RS, D0),
    null,
  );
}

const warehousePaddy = (godownId = GA, varietyId = G.variety.SWARNA!) =>
  stockAvailable(godownId, { product: "PADDY", location: "WAREHOUSE", varietyId });

describe("sale with collections (Test 6)", () => {
  it("₹25,000 sale; ₹10,000 and ₹5,000 collected on two dates → due ₹10,000", async () => {
    await stockIn();
    const { bill, payment } = await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 10n * QTL, 2500n * RS, D0),
      null,
    );
    expect(payment).toBeUndefined();
    expect(bill.type === "SALE" && bill.totalPaise).toBe((25_000n * RS).toString());
    // Credit sale: no cash moved, the buyer owes the whole bill.
    expect((await godownBalances(GA)).get("CASH") ?? 0n).toBe(0n);
    expect(await partyBalance(GA, G.customer)).toBe(25_000n * RS);

    await payBill(GA, bill, {
      amountPaise: (10_000n * RS).toString(),
      paymentDate: D1,
      mode: "CASH",
    });
    await payBill(GA, bill, {
      amountPaise: (5_000n * RS).toString(),
      paymentDate: D2,
      mode: "CASH",
    });

    const [row] = await saleRows(GA);
    expect(row!.state.paidPaise).toBe(15_000n * RS);
    expect(row!.state.duePaise).toBe(10_000n * RS);
    expect(row!.state.status).toBe("PARTIAL");
    expect(await partyBalance(GA, G.customer)).toBe(10_000n * RS);

    // Customer ledger: the sale, then each collection on its own date, running balance.
    const ledger = await partyLedger(GA, G.customer);
    expect(ledger.rows.map((r) => [r.date, r.balancePaise])).toEqual([
      [D0, 25_000n * RS],
      [D1, 15_000n * RS],
      [D2, 10_000n * RS],
    ]);
    // Cashbook: received on D1 and D2 only (the sale date is untouched).
    const docs = (await db().vouchers.toArray()) as Doc[];
    expect(cashbookDay(docs, "CASH", D0).receivedPaise).toBe(0n);
    expect(cashbookDay(docs, "CASH", D1).receivedPaise).toBe(10_000n * RS);
    expect(cashbookDay(docs, "CASH", D2).receivedPaise).toBe(5_000n * RS);
    expect((await paymentsOf(bill._id)).map((p) => p.paymentDate)).toEqual([D1, D2]);

    // Stock left once.
    expect(await warehousePaddy()).toBe(10n * QTL);
    const totals = saleTotals(await saleRows(GA));
    expect(totals.amountPaise).toBe(25_000n * RS);
    expect(totals.duePaise).toBe(10_000n * RS);
    expect(totals.paddyG).toBe(10n * QTL);
    const [cust] = (await customerSummaries(GA)).filter((c) => c.party._id === G.customer);
    expect(cust!.balancePaise).toBe(10_000n * RS);
    await storedEqualsReplay();
  });

  it("an advance on the form is one op group with the sale (IN, isInitial)", async () => {
    await stockIn();
    const { bill, payment } = await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 4n * QTL, 2500n * RS, D1),
      { amountPaise: (3_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
    );
    expect(payment?.type === "PAYMENT" && payment.direction).toBe("IN");
    expect(payment?.type === "PAYMENT" && payment.isInitial).toBe(true);
    const ops = (await db().outbox.toArray()).filter(
      (o) => o.entityId === bill._id || o.entityId === payment?._id,
    );
    expect(new Set(ops.map((o) => o.opGroup)).size).toBe(1);
    expect((await godownBalances(GA)).get("CASH")).toBe(3_000n * RS);
  });

  it("voiding a sale with collections needs withPayments and restores stock and cash", async () => {
    await stockIn();
    const { bill } = await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 5n * QTL, 2500n * RS, D1),
      { amountPaise: (2_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
    );
    const err = await voidDoc(GA, bill._id, "wrong").catch((e: unknown) => e);
    expect((err as RepoError).code).toBe("LINKED_PAYMENTS");
    await voidDoc(GA, bill._id, "wrong", { withPayments: true });
    expect(await warehousePaddy()).toBe(20n * QTL);
    expect((await godownBalances(GA)).get("CASH") ?? 0n).toBe(0n);
    expect(await partyBalance(GA, G.customer)).toBe(0n);
    await storedEqualsReplay();
  });
});

describe("orders and delivery", () => {
  it("an ORDER moves no stock and owes nothing until confirmed; then exactly once", async () => {
    await stockIn();
    const { bill } = await saveBillWithInitialPayment(
      GA,
      {
        ...saleDraft(G.customer, G.variety.SWARNA!, 6n * QTL, 2500n * RS, D1),
        saleStatus: "ORDER",
      },
      null,
    );
    expect(await warehousePaddy()).toBe(20n * QTL);
    expect(await partyBalance(GA, G.customer)).toBe(0n);
    expect(saleTotals(await saleRows(GA)).orders).toBe(1);

    await confirmSaleOrder(GA, bill._id);
    expect(await warehousePaddy()).toBe(14n * QTL);
    expect(await partyBalance(GA, G.customer)).toBe(15_000n * RS);
    const again = await confirmSaleOrder(GA, bill._id).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(RepoError);
    expect(await warehousePaddy()).toBe(14n * QTL);
    await storedEqualsReplay();
  });

  it("delivery steps are time-stamped and filterable; no stock or money effect", async () => {
    await stockIn();
    const { bill } = await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 2n * QTL, 2500n * RS, D1),
      null,
    );
    await setDeliveryStatus(GA, bill._id, "LOADED");
    const s = await setDeliveryStatus(GA, bill._id, "IN_TRANSIT", "WB12AB3456");
    expect(s.deliveryStatus).toBe("IN_TRANSIT");
    expect(s.deliveryLog.map((l) => l.status)).toEqual(["LOADED", "IN_TRANSIT"]);
    expect(s.deliveryLog[1]!.note).toBe("WB12AB3456");
    expect(await saleRows(GA, { delivery: "IN_TRANSIT" })).toHaveLength(1);
    expect(await saleRows(GA, { delivery: "DELIVERED" })).toHaveLength(0);
    expect(await warehousePaddy()).toBe(18n * QTL);
    expect(await partyBalance(GA, G.customer)).toBe(5_000n * RS);
  });

  it("search finds a sale by buyer, invoice number and amount", async () => {
    await stockIn();
    const { bill } = await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 2n * QTL, 2500n * RS, D1),
      null,
    );
    expect(await saleRows(GA, { q: "gopal" })).toHaveLength(1);
    expect(await saleRows(GA, { q: bill.number })).toHaveLength(1);
    expect(await saleRows(GA, { q: "5000" })).toHaveLength(1);
    expect(await saleRows(GA, { q: "nobody" })).toHaveLength(0);
  });
});

describe("direct delivery (TRANSIT)", () => {
  it("a direct-delivery sale takes the purchase's transit paddy, never the warehouse", async () => {
    await stockIn();
    const { bill: p } = await saveBillWithInitialPayment(
      GA,
      {
        ...purchaseDraft(G.farmer, G.variety.SWARNA!, 8n * QTL, 2000n * RS, D1),
        storeAt: "TRANSIT",
      },
      null,
    );
    expect((await openTransitPurchases(GA)).map((r) => r.leftG)).toEqual([8n * QTL]);
    await saveBillWithInitialPayment(
      GA,
      {
        ...saleDraft(G.customer, G.variety.SWARNA!, 8n * QTL, 2600n * RS, D1),
        source: "TRANSIT",
        groupId: p.groupId ?? p._id,
      },
      null,
    );
    expect(await warehousePaddy()).toBe(20n * QTL);
    expect(await openTransitPurchases(GA)).toHaveLength(0);
    await storedEqualsReplay();
  });
});

describe("inter-Gola transfer", () => {
  it("sale in the sender + purchase in the receiver, one op group, books stay separate", async () => {
    await stockIn();
    const [sale, purchase] = await saveInterGolaTransfer({
      fromGodownId: GA,
      toGodownId: GB,
      date: D1,
      varietyId: G.variety.SWARNA!,
      weight: manualWeight(5n * QTL),
      ratePaisePerQtl: (2000n * RS).toString(),
    });
    expect(sale.godownId).toBe(GA);
    expect(purchase.godownId).toBe(GB);
    expect(purchase.type === "PURCHASE" && purchase.varietyId).toBe(H.variety.SWARNA);
    expect(sale.groupId).toBe(purchase.groupId);
    const ops = (await db().outbox.toArray()).filter(
      (o) => o.entityId === sale._id || o.entityId === purchase._id,
    );
    expect(ops.map((o) => o.godownId).sort()).toEqual([GA, GB]);
    expect(new Set(ops.map((o) => o.opGroup)).size).toBe(1);

    expect(await warehousePaddy(GA)).toBe(15n * QTL);
    expect(await warehousePaddy(GB, H.variety.SWARNA!)).toBe(5n * QTL);
    // Each Gola sees the other as a party: A is owed, B owes.
    expect(await partyBalance(GA, sale.partyId)).toBe(10_000n * RS);
    expect(await partyBalance(GB, (purchase as { partyId: string }).partyId)).toBe(-10_000n * RS);
    expect((await pairedTransferDoc(sale))?._id).toBe(purchase._id);

    // A second transfer reuses the same Gola parties.
    await saveInterGolaTransfer({
      fromGodownId: GA,
      toGodownId: GB,
      date: D2,
      varietyId: G.variety.SWARNA!,
      weight: manualWeight(1n * QTL),
      ratePaisePerQtl: (2000n * RS).toString(),
    });
    const golaParties = (await db().parties.toArray()).filter((p) => p.roles.includes("GOLA"));
    expect(golaParties).toHaveLength(2);

    // Reversal voids both halves together.
    await voidInterGolaTransfer(GB, purchase._id, "sent by mistake");
    expect((await db().vouchers.get(sale._id))?.status).toBe("void");
    expect((await db().vouchers.get(purchase._id))?.status).toBe("void");
    // Only the second transfer (1 qtl) is left.
    expect(await warehousePaddy(GA)).toBe(19n * QTL);
    expect(await warehousePaddy(GB, H.variety.SWARNA!)).toBe(1n * QTL);
    await storedEqualsReplay();
  });

  it("refuses the same Gola on both sides", async () => {
    const err = await saveInterGolaTransfer({
      fromGodownId: GA,
      toGodownId: GA,
      date: D1,
      varietyId: G.variety.SWARNA!,
      weight: manualWeight(1n * QTL),
      ratePaisePerQtl: "100",
    }).catch((e: unknown) => e);
    expect((err as RepoError).code).toBe("TRANSFER_SAME_GODOWN");
  });
});

/**
 * Phase 5 repo + queries: purchase with initial payment (one op group), later payments, overpayment
 * → advance only after confirmation, reversals, bank accounts with opening balance, variety merge,
 * purchase list / farmer summaries / party ledger. Numbers follow requirement_v2 §21 Test 1.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { godownBalances, partyBalance } from "@/client/queries/ledger";
import {
  bankRows,
  farmerSummaries,
  partyLedger,
  paymentsOf,
  purchaseRows,
  purchaseTotals,
  varietyRows,
} from "@/client/queries/purchases";
import {
  mergeVarieties,
  payAdvance,
  payBill,
  RepoError,
  saveBankAccount,
  saveBillWithInitialPayment,
  upsertMaster,
  voidDoc,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Doc } from "@/domain/schemas";
import { deriveAll } from "@/domain/v2/replay";
import { QTL, RS, TODAY, purchaseDraft, setupDevice, type LocalGodown } from "../helpers/local";

let G: LocalGodown;
const GA = "GA";
const D1 = addDays(TODAY, -5);
const D2 = addDays(TODAY, -3);
const D3 = addDays(TODAY, -1);

beforeEach(async () => {
  const gs = await setupDevice("repo-payments", { godowns: [{ id: GA, code: "RP" }] });
  G = gs[GA]!;
});

async function storedEqualsReplay(): Promise<void> {
  const want = deriveAll((await db().vouchers.toArray()) as Doc[]);
  const lines = (await db().ledgerLines.toArray()).map((l) => l._id).sort();
  expect(lines).toEqual(want.lines.map((l) => l._id).sort());
}

async function bank(openingRs = 0n) {
  return saveBankAccount(GA, {
    name: "SBI Current",
    bank: "SBI",
    last4: "1234",
    isUpiLinked: true,
    ...(openingRs ? { openingPaise: openingRs * RS } : {}),
  });
}

describe("purchase with payments (Test 1)", () => {
  it("₹1,34,400 → ₹84,400 → ₹54,400 → ₹34,400, cash and bank separate", async () => {
    const b = await bank(100_000n);
    const { bill, payment } = await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 56n * QTL, 2400n * RS, D1),
      {
        amountPaise: (50_000n * RS).toString(),
        paymentDate: D1,
        mode: "CASH",
      },
    );
    expect(bill.type === "PURCHASE" && bill.totalPaise).toBe((134_400n * RS).toString());
    expect(payment?.type === "PAYMENT" && payment.isInitial).toBe(true);
    // Both writes went out as one op group.
    const ops = (await db().outbox.toArray()).filter(
      (o) => o.entityId === bill._id || o.entityId === payment?._id,
    );
    expect(ops).toHaveLength(2);
    expect(new Set(ops.map((o) => o.opGroup)).size).toBe(1);

    await payBill(GA, bill, {
      amountPaise: (30_000n * RS).toString(),
      paymentDate: D2,
      mode: "BANK",
      bankAccountId: b._id,
      reference: "NEFT-1",
    });
    await payBill(GA, bill, {
      amountPaise: (20_000n * RS).toString(),
      paymentDate: D3,
      mode: "CASH",
    });

    const [row] = await purchaseRows(GA);
    expect(row!.state.paidPaise).toBe(100_000n * RS);
    expect(row!.state.duePaise).toBe(34_400n * RS);
    expect(row!.state.status).toBe("PARTIAL");
    expect(await partyBalance(GA, G.farmer)).toBe(-34_400n * RS);
    const bal = await godownBalances(GA);
    expect(bal.get("CASH") ?? 0n).toBe(-70_000n * RS);
    expect(bal.get(`BANK:${b._id}`)).toBe(70_000n * RS);
    expect((await bankRows(GA))[0]!.balancePaise).toBe(70_000n * RS);
    expect((await paymentsOf(bill._id)).map((p) => p.paymentDate)).toEqual([D1, D2, D3]);
    await storedEqualsReplay();
  });

  it("a full-credit purchase moves no cash", async () => {
    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 2000n * RS, D1),
      null,
    );
    const bal = await godownBalances(GA);
    expect(bal.get("CASH") ?? 0n).toBe(0n);
    const [row] = await purchaseRows(GA);
    expect(row!.state.status).toBe("UNPAID");
  });

  it("paying more than the due needs confirmation; the extra becomes an advance", async () => {
    const { bill } = await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 2000n * RS, D1),
      null,
    );
    const part = { amountPaise: (25_000n * RS).toString(), paymentDate: D2, mode: "CASH" as const };
    const err = await payBill(GA, bill, part).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepoError);
    expect((err as RepoError).code).toBe("OVERPAYMENT");
    expect((err as RepoError).detail).toBe((5_000n * RS).toString());
    expect(await paymentsOf(bill._id)).toHaveLength(0);

    await payBill(GA, bill, part, { extraAsAdvance: true });
    const [row] = await purchaseRows(GA);
    expect(row!.state.status).toBe("PAID");
    expect(row!.state.duePaise).toBe(0n);
    expect(await partyBalance(GA, G.farmer)).toBe(5_000n * RS);
    expect((await godownBalances(GA)).get("CASH")).toBe(-25_000n * RS);
    await storedEqualsReplay();
  });

  it("reversing a payment brings the due back; reversing the purchase reverses its payments", async () => {
    const { bill } = await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 2000n * RS, D1),
      {
        amountPaise: (5_000n * RS).toString(),
        paymentDate: D1,
        mode: "CASH",
      },
    );
    const [p2] = await payBill(GA, bill, {
      amountPaise: (3_000n * RS).toString(),
      paymentDate: D2,
      mode: "CASH",
    });
    await voidDoc(GA, p2!._id, "wrong amount");
    let [row] = await purchaseRows(GA);
    expect(row!.state.duePaise).toBe(15_000n * RS);
    const all = await paymentsOf(bill._id);
    expect(all.map((p) => p.status)).toEqual(["active", "void"]);

    await voidDoc(GA, bill._id, "entered twice", { withPayments: true });
    [row] = await purchaseRows(GA);
    expect(row!.doc.status).toBe("void");
    expect((await paymentsOf(bill._id)).every((p) => p.status === "void")).toBe(true);
    expect((await godownBalances(GA)).get("CASH") ?? 0n).toBe(0n);
    expect(await partyBalance(GA, G.farmer)).toBe(0n);
    expect(purchaseTotals(await purchaseRows(GA)).count).toBe(0);
    await storedEqualsReplay();
  });

  it("a voided purchase keeps its payments unless asked (LINKED_PAYMENTS)", async () => {
    const { bill } = await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 2000n * RS, D1),
      {
        amountPaise: (5_000n * RS).toString(),
        paymentDate: D1,
        mode: "CASH",
      },
    );
    const err = await voidDoc(GA, bill._id, "x").catch((e: unknown) => e);
    expect((err as RepoError).code).toBe("LINKED_PAYMENTS");
  });

  it("a BANK payment needs a bank account", async () => {
    const { bill } = await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 2000n * RS, D1),
      null,
    );
    await expect(
      payBill(GA, bill, { amountPaise: "100", paymentDate: D2, mode: "BANK" }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("farmer views", () => {
  it("summaries, ledger with running balance and advance", async () => {
    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 2000n * RS, D1),
      {
        amountPaise: (5_000n * RS).toString(),
        paymentDate: D1,
        mode: "CASH",
      },
    );
    await payAdvance(GA, G.farmer, "OUT", {
      amountPaise: (1_000n * RS).toString(),
      paymentDate: D3,
      mode: "CASH",
    });
    const [f] = (await farmerSummaries(GA)).filter((x) => x.party._id === G.farmer);
    expect(f!.qtyG).toBe(10n * QTL);
    expect(f!.amountPaise).toBe(20_000n * RS);
    expect(f!.balancePaise).toBe(-14_000n * RS);

    const led = await partyLedger(GA, G.farmer);
    expect(led.closing).toBe(-14_000n * RS);
    expect(led.rows.map((r) => r.balancePaise)).toEqual([
      -20_000n * RS,
      -15_000n * RS,
      -14_000n * RS,
    ]);
    const from = await partyLedger(GA, G.farmer, D2);
    expect(from.opening).toBe(-15_000n * RS);
    expect(from.rows).toHaveLength(1);
  });

  it("search finds a purchase by farmer name and by amount; filters by status", async () => {
    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 56n * QTL, 2400n * RS, D1),
      null,
    );
    const farmer = await db().parties.get(G.farmer);
    expect(await purchaseRows(GA, { q: farmer!.name.slice(0, 3) })).toHaveLength(1);
    expect(await purchaseRows(GA, { q: "134400" })).toHaveLength(1);
    expect(await purchaseRows(GA, { q: "999999" })).toHaveLength(0);
    expect(await purchaseRows(GA, { status: "PAID" })).toHaveLength(0);
    expect(await purchaseRows(GA, { status: "UNPAID" })).toHaveLength(1);
    expect(await purchaseRows(GA, { from: TODAY })).toHaveLength(0);
  });
});

describe("varieties", () => {
  it("recents follow use; merge repoints purchases and archives the dropped one", async () => {
    const dup = await upsertMaster(GA, "variety", {
      name: "Swarna New",
      product: "PADDY",
      normalizedKey: "",
      verified: false,
    });
    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, dup._id, 10n * QTL, 2000n * RS, D1),
      null,
    );
    let rows = await varietyRows(GA);
    expect(rows.recent[0]).toBe(dup._id);
    expect(rows.all.find((r) => r.variety._id === dup._id)!.uses).toBe(1);

    await mergeVarieties(GA, G.variety.SWARNA!, dup._id);
    const [row] = await purchaseRows(GA);
    expect(row!.doc.varietyId).toBe(G.variety.SWARNA);
    expect((await db().varieties.get(dup._id))!.status).toBe("void");
    rows = await varietyRows(GA);
    expect(rows.all.some((r) => r.variety._id === dup._id)).toBe(false);
    // Stock now sits under the kept variety only.
    const moves = await db().stockMoves.toArray();
    expect(moves.every((m) => m.varietyId !== dup._id)).toBe(true);
    await storedEqualsReplay();
  });

  it("refuses a duplicate variety name (case / spaces)", async () => {
    await upsertMaster(GA, "variety", {
      name: "Lalat",
      product: "PADDY",
      normalizedKey: "",
      verified: false,
    });
    await expect(
      upsertMaster(GA, "variety", {
        name: "  LALAT ",
        product: "PADDY",
        normalizedKey: "",
        verified: false,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_VARIETY" });
  });
});

describe("bank accounts", () => {
  it("opening balance is posted once as an OPENING entry", async () => {
    const b = await bank(25_000n);
    expect((await bankRows(GA))[0]!.balancePaise).toBe(25_000n * RS);
    const openings = (await db().vouchers.toArray()).filter((d) => d.type === "OPENING");
    expect(openings).toHaveLength(1);
    await saveBankAccount(GA, {
      _id: b._id,
      name: "SBI Main",
      bank: "SBI",
      last4: "1234",
      isUpiLinked: false,
    });
    expect((await bankRows(GA))[0]!.bank.name).toBe("SBI Main");
    expect((await db().vouchers.toArray()).filter((d) => d.type === "OPENING")).toHaveLength(1);
  });
});

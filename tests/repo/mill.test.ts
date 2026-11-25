/**
 * v2 Phase 9 repo + queries: Mill dispatch (MILLING / CONSIGNMENT), mill return (Test 3: paddy
 * back to the Gola, rice only to rice stock), milling conversion, consignment settlement (sale to
 * the mill; advances move onto it and back on reversal), duplicate returns, and the second-party
 * ledger. Stored rows always equal a full replay.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import {
  convertibleReturns,
  dispatchDetail,
  dispatchRows,
  returnRows,
  secondPartyEntries,
  secondPartySummaries,
} from "@/client/queries/mill";
import { partyLedger } from "@/client/queries/purchases";
import {
  findDuplicateReturn,
  payAdvance,
  payBill,
  RepoError,
  saveBillWithInitialPayment,
  saveDoc,
  saveMillReturn,
  saveOpeningStock,
  settleConsignment,
  upsertMaster,
  voidDoc,
  voidSettlement,
  type DraftOf,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Doc } from "@/domain/schemas";
import { deriveAll } from "@/domain/v2/replay";
import { millDay, paddyDay, productDay, qtyAt } from "@/domain/v2/stock";
import {
  QTL,
  RS,
  TODAY,
  manualWeight,
  purchaseDraft,
  saleDraft,
  setupDevice,
  useClock,
  type LocalGodown,
} from "../helpers/local";

let G: LocalGodown;
const GA = "GA";
const D0 = addDays(TODAY, -3);
const D1 = addDays(TODAY, -2);
const D2 = addDays(TODAY, -1);

beforeEach(async () => {
  const gs = await setupDevice("repo-mill", { godowns: [{ id: GA, code: "RP" }] });
  G = gs[GA]!;
});
afterEach(() => useClock(null));

async function storedEqualsReplay(): Promise<void> {
  const want = deriveAll((await db().vouchers.toArray()) as Doc[]);
  const lines = (await db().ledgerLines.toArray()).map((l) => l._id).sort();
  expect(lines).toEqual(want.lines.map((l) => l._id).sort());
  const moves = (await db().stockMoves.toArray()).map((m) => m._id).sort();
  expect(moves).toEqual(want.moves.map((m) => m._id).sort());
}

const moves = async () => (await db().stockMoves.toArray()).filter((m) => m.godownId === GA);

function dispatchDraft(
  type: "MILLING" | "CONSIGNMENT",
  g: bigint,
  ratePaise: bigint,
  date = D1,
): DraftOf<"MILL_DISPATCH"> {
  return {
    type: "MILL_DISPATCH",
    dispatchType: type,
    millPartyId: G.mill,
    dispatchDate: date,
    varietyId: G.variety.SWARNA!,
    weight: manualWeight(g),
    ratePaisePerQtl: ratePaise.toString(),
    totalValuePaise: "0",
  };
}

function returnDraft(
  dispatchId: string,
  product: "PADDY" | "RICE" | "OTHER",
  g: bigint,
  date = D2,
  other?: string,
): DraftOf<"MILL_RETURN"> {
  return {
    type: "MILL_RETURN",
    dispatchId,
    millPartyId: G.mill,
    returnDate: date,
    product,
    ...(product === "PADDY" ? { varietyId: G.variety.SWARNA! } : {}),
    ...(other ? { otherProductName: other } : {}),
    weight: manualWeight(g),
    dedupeKey: "",
  };
}

async function setupTest2(): Promise<Doc> {
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
  const r = await saveBillWithInitialPayment(GA, dispatchDraft("MILLING", 20n * QTL, 0n), null);
  return r.bill;
}

describe("mill dispatch and return (Tests 2 and 3)", () => {
  it("126 in the Gola and 20 at the mill; a 5 qtl paddy return → 131 and 15; rice goes to rice only", async () => {
    const dispatch = await setupTest2();
    let m = await moves();
    expect(qtyAt(m, { product: "PADDY", location: "WAREHOUSE" })).toBe(126n * QTL);
    expect(qtyAt(m, { product: "PADDY", location: "MILL" })).toBe(20n * QTL);

    await saveMillReturn(GA, returnDraft(dispatch._id, "PADDY", 5n * QTL), null);
    m = await moves();
    expect(qtyAt(m, { product: "PADDY", location: "WAREHOUSE" })).toBe(131n * QTL);
    expect(qtyAt(m, { product: "PADDY", location: "MILL" })).toBe(15n * QTL);
    expect(qtyAt(m, { product: "RICE", location: "WAREHOUSE" })).toBe(0n);
    expect(paddyDay(m, D2).returnedFromMillG).toBe(5n * QTL);
    expect(millDay(m, D2).returnedG).toBe(5n * QTL);

    // A rice return of 3 qtl goes only to rice stock (never offsets paddy).
    await saveMillReturn(GA, returnDraft(dispatch._id, "RICE", 3n * QTL), null);
    m = await moves();
    expect(qtyAt(m, { product: "PADDY", location: "WAREHOUSE" })).toBe(131n * QTL);
    expect(qtyAt(m, { product: "PADDY", location: "MILL" })).toBe(15n * QTL);
    expect(productDay(m, D2, "RICE").closingG).toBe(3n * QTL);

    const [row] = await dispatchRows(GA);
    expect(row!.balance.sentG).toBe(20n * QTL);
    expect(row!.balance.returnedPaddyG).toBe(5n * QTL);
    expect(row!.balance.remainingG).toBe(15n * QTL);
    await storedEqualsReplay();
  });

  it("the milling conversion takes the consumed paddy out of the mill; loss = consumed − outputs", async () => {
    const dispatch = await setupTest2();
    const [rice] = await saveMillReturn(
      GA,
      {
        ...returnDraft(dispatch._id, "RICE", 12n * QTL),
        totalValuePaise: (30_000n * RS).toString(),
      },
      null,
    );
    const [bran] = await saveMillReturn(
      GA,
      returnDraft(dispatch._id, "OTHER", QTL, D2, "তুষ"),
      null,
    );
    expect((await convertibleReturns(dispatch._id)).map((r) => r._id)).toEqual([
      rice!._id,
      bran!._id,
    ]);
    const conv = await saveDoc(GA, {
      type: "CONVERSION",
      dispatchId: dispatch._id,
      millPartyId: G.mill,
      varietyId: G.variety.SWARNA!,
      conversionDate: D2,
      paddyConsumedG: (20n * QTL).toString(),
      outputs: [
        {
          returnId: rice!._id,
          product: "RICE",
          qtyG: (12n * QTL).toString(),
          valuePaise: (30_000n * RS).toString(),
        },
        { returnId: bran!._id, product: "OTHER", name: "তুষ", qtyG: QTL.toString() },
      ],
      lossG: "0",
    } as DraftOf<"CONVERSION">);
    expect(conv.type === "CONVERSION" && conv.lossG).toBe((7n * QTL).toString());
    const m = await moves();
    expect(qtyAt(m, { product: "PADDY", location: "MILL" })).toBe(0n);
    expect(millDay(m, D2).consumedG).toBe(20n * QTL);
    expect(qtyAt(m, { product: "RICE", location: "WAREHOUSE" })).toBe(12n * QTL);
    expect(await convertibleReturns(dispatch._id)).toEqual([]);
    expect((await dispatchDetail(dispatch._id))!.balance.remainingG).toBe(0n);
    // A return used by a conversion can't be voided on its own.
    const err = await voidDoc(GA, rice!._id, "x").catch((e: unknown) => e);
    expect((err as RepoError).code).toBe("ALREADY_LINKED");
    await storedEqualsReplay();
  });

  it("a conversion needs a MILLING dispatch", async () => {
    await setupTest2();
    const cons = await saveBillWithInitialPayment(
      GA,
      dispatchDraft("CONSIGNMENT", 5n * QTL, 2600n * RS),
      null,
    );
    const err = await saveDoc(GA, {
      type: "CONVERSION",
      dispatchId: cons.bill._id,
      millPartyId: G.mill,
      varietyId: G.variety.SWARNA!,
      conversionDate: D2,
      paddyConsumedG: QTL.toString(),
      outputs: [],
      lossG: "0",
    } as DraftOf<"CONVERSION">).catch((e: unknown) => e);
    expect((err as RepoError).code).toBe("DISPATCH_TYPE_MISMATCH");
  });

  it("money received with a return is an IN payment from the mill, linked to the return", async () => {
    const dispatch = await setupTest2();
    const [ret, pay] = await saveMillReturn(GA, returnDraft(dispatch._id, "RICE", 3n * QTL), {
      amountPaise: (1_500n * RS).toString(),
      paymentDate: D2,
      mode: "CASH",
    });
    expect(pay).toMatchObject({
      type: "PAYMENT",
      direction: "IN",
      partyId: G.mill,
      source: { type: "MILL_RETURN", id: ret!._id },
    });
    const [row] = await returnRows(GA);
    expect(row!.receivedPaise).toBe(1_500n * RS);
    // The mill's ledger is credited (we received money from them).
    const ledger = await partyLedger(GA, G.mill);
    expect(ledger.closing).toBe(-1_500n * RS);
    // A wrong-direction payment against a return is refused.
    const bad = await saveDoc(GA, {
      type: "PAYMENT",
      direction: "OUT",
      amountPaise: "100",
      paymentDate: D2,
      mode: "CASH",
      partyId: G.mill,
      source: { type: "MILL_RETURN", id: ret!._id },
      isInitial: false,
    } as DraftOf<"PAYMENT">).catch((e: unknown) => e);
    expect((bad as RepoError).code).toBe("SOURCE_MISMATCH");
    // Voiding the return needs its payment voided too.
    const blocked = await voidDoc(GA, ret!._id, "ভুল").catch((e: unknown) => e);
    expect((blocked as RepoError).code).toBe("LINKED_PAYMENTS");
    await voidDoc(GA, ret!._id, "ভুল", { withPayments: true });
    expect((await partyLedger(GA, G.mill)).closing).toBe(0n);
    await storedEqualsReplay();
  });

  it("flags a possible duplicate return (same dispatch, date, product, quantity within 10 minutes)", async () => {
    const dispatch = await setupTest2();
    useClock("2026-11-25T05:00:00.000Z");
    const [first] = await saveMillReturn(GA, returnDraft(dispatch._id, "PADDY", 2n * QTL), null);
    const probe = {
      dispatchId: dispatch._id,
      returnDate: D2,
      product: "PADDY",
      netG: (2n * QTL).toString(),
    };
    const now = Date.parse("2026-11-25T05:05:00.000Z");
    expect((await findDuplicateReturn(GA, probe, undefined, now))?._id).toBe(first!._id);
    expect(await findDuplicateReturn(GA, probe, first!._id, now)).toBeUndefined();
    expect(
      await findDuplicateReturn(GA, probe, undefined, Date.parse("2026-11-25T05:11:00.000Z")),
    ).toBeUndefined();
    expect(
      await findDuplicateReturn(GA, { ...probe, netG: (3n * QTL).toString() }, undefined, now),
    ).toBeUndefined();
  });
});

describe("milling charges and consignment", () => {
  it("MILLING: the charges are payable to the mill and paid like any bill", async () => {
    await setupTest2();
    const r = await saveBillWithInitialPayment(GA, dispatchDraft("MILLING", 10n * QTL, 50n * RS), {
      amountPaise: (200n * RS).toString(),
      paymentDate: D1,
      mode: "CASH",
    });
    expect(r.bill.type === "MILL_DISPATCH" && r.bill.totalValuePaise).toBe((500n * RS).toString());
    expect(r.payment).toMatchObject({ direction: "OUT", partyId: G.mill });
    let row = (await dispatchRows(GA)).find((x) => x.doc._id === r.bill._id)!;
    expect(row.state.duePaise).toBe(300n * RS);
    await payBill(GA, r.bill, {
      amountPaise: (300n * RS).toString(),
      paymentDate: D2,
      mode: "CASH",
    });
    row = (await dispatchRows(GA)).find((x) => x.doc._id === r.bill._id)!;
    expect(row.state.status).toBe("PAID");
    expect((await partyLedger(GA, G.mill)).closing).toBe(0n);
    await storedEqualsReplay();
  });

  it("CONSIGNMENT: advance → settle to a sale (advance moves onto it) → reverse puts it back", async () => {
    await setupTest2();
    const cons = await saveBillWithInitialPayment(
      GA,
      dispatchDraft("CONSIGNMENT", 20n * QTL, 2500n * RS),
      { amountPaise: (10_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
    );
    // No sale yet: the expected value posts nothing; the advance is owed back to the mill.
    expect((await partyLedger(GA, G.mill)).closing).toBe(-10_000n * RS);
    let m = await moves();
    expect(qtyAt(m, { product: "PADDY", location: "MILL" })).toBe(40n * QTL);

    const { sale, moved } = await settleConsignment(GA, {
      dispatchId: cons.bill._id,
      date: D2,
      weight: manualWeight(18n * QTL),
      ratePaisePerQtl: (2600n * RS).toString(),
    });
    expect(moved).toBe(1);
    expect(sale).toMatchObject({
      partyId: G.mill,
      source: "MILL",
      sourceMillId: G.mill,
      consignmentDispatchId: cons.bill._id,
      saleStatus: "CONFIRMED",
      totalPaise: (46_800n * RS).toString(),
    });
    m = await moves();
    expect(qtyAt(m, { product: "PADDY", location: "MILL" })).toBe(22n * QTL);
    expect(millDay(m, D2).settledG).toBe(18n * QTL);
    const det = await dispatchDetail(cons.bill._id);
    expect(det!.balance.settledG).toBe(18n * QTL);
    expect(det!.balance.remainingG).toBe(2n * QTL);
    expect(det!.payments.filter((p) => p.status === "active")).toHaveLength(0);
    // The sale shows the advance as received; the mill owes the rest.
    const pays = (await db().vouchers.where("source.id").equals(sale._id).toArray()) as Doc[];
    expect(pays).toHaveLength(1);
    expect((await partyLedger(GA, G.mill)).closing).toBe(36_800n * RS);

    await voidSettlement(GA, sale._id, "দর ভুল");
    expect((await db().vouchers.get(sale._id))!.status).toBe("void");
    const back = await dispatchDetail(cons.bill._id);
    expect(back!.payments.filter((p) => p.status === "active")).toHaveLength(1);
    expect(back!.balance.remainingG).toBe(20n * QTL);
    expect((await partyLedger(GA, G.mill)).closing).toBe(-10_000n * RS);
    await storedEqualsReplay();
  });

  it("an advance larger than the settled sale stays on the dispatch", async () => {
    await setupTest2();
    const cons = await saveBillWithInitialPayment(
      GA,
      dispatchDraft("CONSIGNMENT", 5n * QTL, 2500n * RS),
      { amountPaise: (20_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
    );
    const { moved } = await settleConsignment(GA, {
      dispatchId: cons.bill._id,
      date: D2,
      weight: manualWeight(5n * QTL),
      ratePaisePerQtl: (2500n * RS).toString(),
    });
    expect(moved).toBe(0);
    expect((await partyLedger(GA, G.mill)).closing).toBe(-7_500n * RS);
    const notCons = await settleConsignment(GA, {
      dispatchId: (await dispatchRows(GA, { type: "MILLING" }))[0]!.doc._id,
      date: D2,
      weight: manualWeight(QTL),
      ratePaisePerQtl: "100",
    }).catch((e: unknown) => e);
    expect((notCons as RepoError).code).toBe("DISPATCH_TYPE_MISMATCH");
  });
});

describe("second party ledger (§12.8A)", () => {
  it("we owe / they owe entries with partial payments and on-account money", async () => {
    const sp = await upsertMaster(GA, "party", { name: "Bikash", roles: ["SECOND_PARTY"] });
    const weOwe = await saveBillWithInitialPayment(
      GA,
      {
        type: "SECOND_PARTY",
        partyId: sp._id,
        transactionDate: D1,
        kind: "WE_OWE",
        amountPaise: (5_000n * RS).toString(),
        dueDate: TODAY,
      } as DraftOf<"SECOND_PARTY">,
      { amountPaise: (2_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
    );
    expect(weOwe.payment).toMatchObject({ direction: "OUT", source: { type: "SECOND_PARTY" } });
    await saveBillWithInitialPayment(
      GA,
      {
        type: "SECOND_PARTY",
        partyId: sp._id,
        transactionDate: D2,
        kind: "THEY_OWE",
        amountPaise: (1_000n * RS).toString(),
      } as DraftOf<"SECOND_PARTY">,
      null,
    );
    await payBill(GA, weOwe.bill, {
      amountPaise: (1_000n * RS).toString(),
      paymentDate: D2,
      mode: "CASH",
    });
    await payAdvance(
      GA,
      sp._id,
      "IN",
      { amountPaise: (500n * RS).toString(), paymentDate: D2, mode: "CASH" },
      "SECOND_PARTY",
    );
    const rows = await secondPartyEntries(GA, sp._id);
    expect(rows.map((r) => [r.doc.kind, r.state.duePaise])).toEqual([
      ["THEY_OWE", 1_000n * RS],
      ["WE_OWE", 2_000n * RS],
    ]);
    const [sum] = await secondPartySummaries(GA);
    expect(sum!.weOwePaise).toBe(5_000n * RS);
    expect(sum!.theyOwePaise).toBe(1_000n * RS);
    // −5,000 + 3,000 paid + 1,000 they owe − 500 received = −1,500 (we owe them).
    expect(sum!.balancePaise).toBe(-1_500n * RS);
    await storedEqualsReplay();
  });
});

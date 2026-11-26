/**
 * Mill repo + queries (requirement_v2.1 §12.8): the mill PAYS us for the paddy it receives.
 *  - Dispatch: warehouse → mill stock (Tests 2 and 3), the mill owes us quantity × rate; money from
 *    the mill is an IN collection (cash goes UP); an OUT payment against a dispatch is refused.
 *  - Paddy return: a credit to the mill (no cash), stock back to the Gola; rice only to rice stock.
 *  - Final settlement: adjusts the same dispatch's receivable; no sale; one per dispatch.
 *  - Refund to a mill that paid too much: an explicit OUT payment (MILL_REFUND).
 *  - Milling conversion: stock only.
 * Stored rows always equal a full replay.
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
import { partyDues, reminderRows } from "@/client/queries/dues";
import { partyLedger } from "@/client/queries/purchases";
import {
  findDuplicateReturn,
  payAdvance,
  payBill,
  RepoError,
  saveBillWithInitialPayment,
  saveDoc,
  saveMillRefund,
  saveMillReturn,
  saveMillSettlement,
  saveOpeningStock,
  upsertMaster,
  voidDoc,
  type DraftOf,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Doc } from "@/domain/schemas";
import { balanceAt, cashbookDay } from "@/domain/v2/cashbook";
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
const docs = async () => (await db().vouchers.toArray()).filter((d) => d.godownId === GA) as Doc[];
const cash = async (date = TODAY) => balanceAt(await docs(), "CASH", date);
const millBalance = async () => (await partyLedger(GA, G.mill)).closing;

function dispatchDraft(g: bigint, ratePaise: bigint, date = D1): DraftOf<"MILL_DISPATCH"> {
  return {
    type: "MILL_DISPATCH",
    millPartyId: G.mill,
    dispatchDate: date,
    varietyId: G.variety.SWARNA!,
    weight: manualWeight(g),
    ratePaisePerQtl: ratePaise.toString(),
    totalValuePaise: "0",
  };
}

function returnDraft(
  dispatch: Doc,
  product: "PADDY" | "RICE" | "OTHER",
  g: bigint,
  date = D2,
  other?: string,
): DraftOf<"MILL_RETURN"> {
  return {
    type: "MILL_RETURN",
    dispatchId: dispatch._id,
    millPartyId: G.mill,
    returnDate: date,
    product,
    ...(product === "PADDY" && dispatch.type === "MILL_DISPATCH"
      ? { varietyId: G.variety.SWARNA!, ratePaisePerQtl: dispatch.ratePaisePerQtl }
      : {}),
    ...(other ? { otherProductName: other } : {}),
    weight: manualWeight(g),
    dedupeKey: "",
  };
}

async function setupTest2(rate = 2600n * RS): Promise<Doc> {
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
  const r = await saveBillWithInitialPayment(GA, dispatchDraft(20n * QTL, rate), null);
  return r.bill;
}

describe("mill dispatch and return (Tests 2 and 3)", () => {
  it("126 in the Gola and 20 at the mill; a 5 qtl paddy return → 131 and 15; rice goes to rice only", async () => {
    const dispatch = await setupTest2();
    let m = await moves();
    expect(qtyAt(m, { product: "PADDY", location: "WAREHOUSE" })).toBe(126n * QTL);
    expect(qtyAt(m, { product: "PADDY", location: "MILL" })).toBe(20n * QTL);

    await saveMillReturn(GA, returnDraft(dispatch, "PADDY", 5n * QTL));
    m = await moves();
    expect(qtyAt(m, { product: "PADDY", location: "WAREHOUSE" })).toBe(131n * QTL);
    expect(qtyAt(m, { product: "PADDY", location: "MILL" })).toBe(15n * QTL);
    expect(qtyAt(m, { product: "RICE", location: "WAREHOUSE" })).toBe(0n);
    expect(paddyDay(m, D2).returnedFromMillG).toBe(5n * QTL);
    expect(millDay(m, D2).returnedG).toBe(5n * QTL);

    // A rice return of 3 qtl goes only to rice stock (never offsets paddy) and moves no money.
    const before = await millBalance();
    await saveMillReturn(GA, returnDraft(dispatch, "RICE", 3n * QTL));
    m = await moves();
    expect(qtyAt(m, { product: "PADDY", location: "WAREHOUSE" })).toBe(131n * QTL);
    expect(qtyAt(m, { product: "PADDY", location: "MILL" })).toBe(15n * QTL);
    expect(productDay(m, D2, "RICE").closingG).toBe(3n * QTL);
    expect(await millBalance()).toBe(before);

    const [row] = await dispatchRows(GA);
    expect(row!.balance.sentG).toBe(20n * QTL);
    expect(row!.balance.returnedPaddyG).toBe(5n * QTL);
    expect(row!.balance.remainingG).toBe(15n * QTL);
    await storedEqualsReplay();
  });

  it("the milling conversion is stock-only: consumed paddy leaves the mill, money unchanged", async () => {
    const dispatch = await setupTest2();
    const rice = await saveMillReturn(GA, returnDraft(dispatch, "RICE", 12n * QTL));
    const bran = await saveMillReturn(GA, returnDraft(dispatch, "OTHER", QTL, D2, "তুষ"));
    expect((await convertibleReturns(dispatch._id)).map((r) => r._id)).toEqual([
      rice._id,
      bran._id,
    ]);
    const balance = await millBalance();
    const conv = await saveDoc(GA, {
      type: "CONVERSION",
      dispatchId: dispatch._id,
      millPartyId: G.mill,
      varietyId: G.variety.SWARNA!,
      conversionDate: D2,
      paddyConsumedG: (20n * QTL).toString(),
      outputs: [
        { returnId: rice._id, product: "RICE", qtyG: (12n * QTL).toString() },
        { returnId: bran._id, product: "OTHER", name: "তুষ", qtyG: QTL.toString() },
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
    // No ledger line at all; the mill still owes exactly the same.
    expect((await db().ledgerLines.toArray()).filter((l) => l.voucherId === conv._id)).toEqual([]);
    expect(await millBalance()).toBe(balance);
    // A return used by a conversion can't be voided on its own.
    const err = await voidDoc(GA, rice._id, "x").catch((e: unknown) => e);
    expect((err as RepoError).code).toBe("ALREADY_LINKED");
    await storedEqualsReplay();
  });

  it("flags a possible duplicate return (same dispatch, date, product, quantity within 10 minutes)", async () => {
    const dispatch = await setupTest2();
    useClock("2026-11-25T05:00:00.000Z");
    const first = await saveMillReturn(GA, returnDraft(dispatch, "PADDY", 2n * QTL));
    const probe = {
      dispatchId: dispatch._id,
      returnDate: D2,
      product: "PADDY",
      netG: (2n * QTL).toString(),
    };
    const now = Date.parse("2026-11-25T05:05:00.000Z");
    expect((await findDuplicateReturn(GA, probe, undefined, now))?._id).toBe(first._id);
    expect(await findDuplicateReturn(GA, probe, first._id, now)).toBeUndefined();
    expect(
      await findDuplicateReturn(GA, probe, undefined, Date.parse("2026-11-25T05:11:00.000Z")),
    ).toBeUndefined();
    expect(
      await findDuplicateReturn(GA, { ...probe, netG: (3n * QTL).toString() }, undefined, now),
    ).toBeUndefined();
  });
});

describe("money direction with mills (v2.1)", () => {
  it("a dispatch is a receivable: the mill owes us, collections are IN and raise cash", async () => {
    await setupTest2();
    const r = await saveBillWithInitialPayment(GA, dispatchDraft(10n * QTL, 2500n * RS), {
      amountPaise: (5_000n * RS).toString(),
      paymentDate: D1,
      mode: "CASH",
    });
    // Older dispatch from setupTest2: 20 × 2,600 = 52,000.
    expect(r.bill.type === "MILL_DISPATCH" && r.bill.totalValuePaise).toBe(
      (25_000n * RS).toString(),
    );
    expect(r.payment).toMatchObject({
      direction: "IN",
      partyId: G.mill,
      source: { type: "MILL_DISPATCH" },
    });
    expect(await millBalance()).toBe((52_000n + 25_000n - 5_000n) * RS);
    // Cash went UP by the collection, on its payment date, as "Cash received".
    const day = cashbookDay(await docs(), "CASH", D1);
    expect(day.receivedPaise).toBe(5_000n * RS);
    expect(day.paidPaise).toBe(0n);
    expect(await cash()).toBe(5_000n * RS);

    let row = (await dispatchRows(GA)).find((x) => x.doc._id === r.bill._id)!;
    expect(row.money.receivablePaise).toBe(20_000n * RS);
    await payBill(GA, r.bill, {
      amountPaise: (20_000n * RS).toString(),
      paymentDate: D2,
      mode: "CASH",
    });
    row = (await dispatchRows(GA)).find((x) => x.doc._id === r.bill._id)!;
    expect(row.state.status).toBe("PAID");
    expect(row.money.receivablePaise).toBe(0n);
    expect(await cash()).toBe(25_000n * RS);

    // Due & Advance: the mill is under "receivable from mills", never a payable.
    const due = (await partyDues(GA)).find((x) => x.party._id === G.mill)!;
    expect(due.category).toBe("mill");
    expect(due.balancePaise).toBe(52_000n * RS);
    await storedEqualsReplay();
  });

  it("an OUT payment against a dispatch or any payment against a return is refused", async () => {
    const dispatch = await setupTest2();
    const ret = await saveMillReturn(GA, returnDraft(dispatch, "PADDY", 2n * QTL));
    const pay = (type: "MILL_DISPATCH" | "MILL_RETURN", id: string, direction: "IN" | "OUT") =>
      saveDoc(GA, {
        type: "PAYMENT",
        direction,
        amountPaise: "100",
        paymentDate: D2,
        mode: "CASH",
        partyId: G.mill,
        source: { type, id },
        isInitial: false,
      } as DraftOf<"PAYMENT">).catch((e: unknown) => e);
    expect(((await pay("MILL_DISPATCH", dispatch._id, "OUT")) as RepoError).code).toBe(
      "PAYMENT_DIRECTION_MISMATCH",
    );
    expect(((await pay("MILL_RETURN", ret._id, "IN")) as RepoError).code).toBe(
      "PAYMENT_DIRECTION_MISMATCH",
    );
    expect(((await pay("MILL_RETURN", ret._id, "OUT")) as RepoError).code).toBe(
      "PAYMENT_DIRECTION_MISMATCH",
    );
  });

  it("a paddy return is a credit (qty × dispatch rate): receivable down, cash unchanged", async () => {
    const dispatch = await setupTest2();
    expect(await millBalance()).toBe(52_000n * RS);
    const ret = await saveMillReturn(GA, returnDraft(dispatch, "PADDY", 5n * QTL));
    expect(ret.type === "MILL_RETURN" && ret.totalValuePaise).toBe((13_000n * RS).toString());
    expect(await millBalance()).toBe(39_000n * RS);
    expect(await cash()).toBe(0n);
    const [r] = await returnRows(GA);
    expect(r!.creditPaise).toBe(13_000n * RS);
    // A typed credit (no rate) is kept as typed.
    const typed = await saveMillReturn(GA, {
      ...returnDraft(dispatch, "PADDY", QTL),
      ratePaisePerQtl: undefined,
      totalValuePaise: (2_000n * RS).toString(),
    } as DraftOf<"MILL_RETURN">);
    expect(typed.type === "MILL_RETURN" && typed.totalValuePaise).toBe((2_000n * RS).toString());
    expect(await millBalance()).toBe(37_000n * RS);
    const det = await dispatchDetail(dispatch._id);
    expect(det!.money.returnCreditPaise).toBe(15_000n * RS);
    expect(det!.money.receivablePaise).toBe(37_000n * RS);
    await storedEqualsReplay();
  });

  it("final settlement adjusts the dispatch's receivable (no sale), once; reversal restores it", async () => {
    const dispatch = await setupTest2();
    await saveMillReturn(GA, returnDraft(dispatch, "PADDY", 5n * QTL)); // 15 qtl left at mill
    const salesBefore = (await docs()).filter((d) => d.type === "SALE").length;
    // The mill accepts 14 qtl at 2,550 with a ₹500 moisture cut; 1 qtl short (weighing).
    const s = await saveMillSettlement(GA, {
      dispatchId: dispatch._id,
      date: D2,
      acceptedG: (14n * QTL).toString(),
      finalRatePaisePerQtl: (2550n * RS).toString(),
      deductionPaise: (500n * RS).toString(),
      shortfallG: QTL.toString(),
      shortfallReason: "WEIGHING",
    });
    // billed = 15 × 2,600 = 39,000; final = 14 × 2,550 − 500 = 35,200; cut = 3,800.
    expect(s.billedPaise).toBe((39_000n * RS).toString());
    expect(s.finalValuePaise).toBe((35_200n * RS).toString());
    expect(s.adjustmentPaise).toBe((3_800n * RS).toString());
    expect(await millBalance()).toBe(35_200n * RS);
    expect((await docs()).filter((d) => d.type === "SALE").length).toBe(salesBefore);
    const m = await moves();
    expect(qtyAt(m, { product: "PADDY", location: "MILL" })).toBe(0n);
    expect(millDay(m, D2).settledG).toBe(15n * QTL);
    const det = await dispatchDetail(dispatch._id);
    expect(det!.balance.acceptedG).toBe(14n * QTL);
    expect(det!.balance.shortfallG).toBe(QTL);
    expect(det!.money.receivablePaise).toBe(35_200n * RS);
    // Reminders / dues use the settled (net) amount.
    const due = (await partyDues(GA)).find((x) => x.party._id === G.mill)!;
    expect(due.open[0]!.state.duePaise).toBe(35_200n * RS);

    // Second settlement, a new return or a rate change on the settled dispatch → refused.
    const again = await saveMillSettlement(GA, {
      dispatchId: dispatch._id,
      date: D2,
      acceptedG: QTL.toString(),
      finalRatePaisePerQtl: "1",
      deductionPaise: "0",
      shortfallG: "0",
    }).catch((e: unknown) => e);
    expect((again as RepoError).code).toBe("ALREADY_LINKED");
    const ret = await saveMillReturn(GA, returnDraft(dispatch, "PADDY", QTL, TODAY)).catch(
      (e: unknown) => e,
    );
    expect((ret as RepoError).code).toBe("ALREADY_LINKED");

    await voidDoc(GA, s._id, "ভুল দর");
    expect(await millBalance()).toBe(39_000n * RS);
    expect(qtyAt(await moves(), { product: "PADDY", location: "MILL" })).toBe(15n * QTL);
    await storedEqualsReplay();
  });

  it("a shortfall needs a reason; extra value raises the receivable", async () => {
    const dispatch = await setupTest2();
    const noReason = await saveMillSettlement(GA, {
      dispatchId: dispatch._id,
      date: D2,
      acceptedG: (19n * QTL).toString(),
      finalRatePaisePerQtl: (2600n * RS).toString(),
      deductionPaise: "0",
      shortfallG: QTL.toString(),
    }).catch((e: unknown) => e);
    expect((noReason as RepoError).code).toBe("VALIDATION_FAILED");
    await saveMillSettlement(GA, {
      dispatchId: dispatch._id,
      date: D2,
      acceptedG: (20n * QTL).toString(),
      finalRatePaisePerQtl: (2700n * RS).toString(),
      deductionPaise: "0",
      shortfallG: "0",
    });
    expect(await millBalance()).toBe(54_000n * RS);
    await storedEqualsReplay();
  });

  it("overpaid mill → 'to refund' (never a receivable tab); an explicit refund is Cash paid", async () => {
    const dispatch = await setupTest2();
    // The mill pays 60,000 against 52,000: the extra 8,000 is kept as the mill's advance.
    await payBill(
      GA,
      dispatch,
      { amountPaise: (60_000n * RS).toString(), paymentDate: D2, mode: "CASH" },
      { extraAsAdvance: true },
    );
    expect(await millBalance()).toBe(-8_000n * RS);
    let due = (await partyDues(GA)).find((x) => x.party._id === G.mill)!;
    expect(due.category).toBe("other");
    await saveMillRefund(
      GA,
      G.mill,
      { amountPaise: (8_000n * RS).toString(), paymentDate: TODAY, mode: "CASH" },
      null,
    );
    expect(await millBalance()).toBe(0n);
    const day = cashbookDay(await docs(), "CASH", TODAY);
    expect(day.paidPaise).toBe(8_000n * RS);
    expect(day.expensesPaise).toBe(0n);
    expect(await cash()).toBe(52_000n * RS);
    due = (await partyDues(GA)).find((x) => x.party._id === G.mill)!;
    expect(due).toBeUndefined();
    await storedEqualsReplay();
  });

  it("a due date on a dispatch creates a COLLECT reminder", async () => {
    await setupTest2();
    await saveBillWithInitialPayment(
      GA,
      { ...dispatchDraft(QTL, 2000n * RS), dueDate: TODAY } as DraftOf<"MILL_DISPATCH">,
      null,
    );
    const rem = (await reminderRows(GA)).filter((r) => r.source?.type === "MILL_DISPATCH");
    expect(rem.map((r) => [r.kind, r.amountPaise])).toEqual([["COLLECT", 2_000n * RS]]);
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

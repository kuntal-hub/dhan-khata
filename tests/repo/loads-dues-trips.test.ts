/**
 * v2 Phase 10 repo + queries:
 *  - Load Khata: a load moves nothing by itself; a sale / dispatch created from it or linked to it
 *    moves the stock exactly once; 1:1 links both ways; editing a linked load updates the record
 *    (still one deduction); a voided record leaves the load "not linked".
 *  - Due & Advance: remaining = ledger balance for every party (Due totals == ledger); categories;
 *    a consignment's expected value is not a due; paying across bills oldest first under one group;
 *    automatic reminders with the owner's state.
 *  - Vehicle trips: income + costs, advance and costs paid now in one op group, net profit, later
 *    payments, a paid cost can't be removed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { dueSummary, openBillsOf, partyDues, reminderRows } from "@/client/queries/dues";
import { godownBalances } from "@/client/queries/ledger";
import { groupLoads, linkCandidates, loadRows } from "@/client/queries/loads";
import { pnlByPeriod, tripRows, vehicleSummaries } from "@/client/queries/vehicles";
import {
  linkFromLoadItem,
  linkLoad,
  newId,
  payBill,
  payParty,
  RepoError,
  saveBillWithInitialPayment,
  saveDoc,
  saveLoad,
  saveTrip,
  setReminderState,
  unlinkLoad,
  upsertMaster,
  voidDoc,
  type DraftOf,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Doc } from "@/domain/schemas";
import { allocateFifo, vehicleCostSourceId } from "@/domain/v2/payments";
import { deriveAll } from "@/domain/v2/replay";
import { qtyAt } from "@/domain/v2/stock";
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
const GA = "GA";
const D0 = addDays(TODAY, -40);
const D1 = addDays(TODAY, -2);
const D2 = addDays(TODAY, -1);

beforeEach(async () => {
  const gs = await setupDevice("repo-p10", { godowns: [{ id: GA, code: "RP" }] });
  G = gs[GA]!;
});

async function storedEqualsReplay(): Promise<void> {
  const want = deriveAll((await db().vouchers.toArray()) as Doc[]);
  expect((await db().ledgerLines.toArray()).map((l) => l._id).sort()).toEqual(
    want.lines.map((l) => l._id).sort(),
  );
  expect((await db().stockMoves.toArray()).map((m) => m._id).sort()).toEqual(
    want.moves.map((m) => m._id).sort(),
  );
}

const paddy = async () =>
  qtyAt(
    (await db().stockMoves.toArray()).filter((m) => m.godownId === GA),
    { product: "PADDY", location: "WAREHOUSE" },
  );

function loadDraft(g: bigint, date = D1): DraftOf<"LOAD"> {
  return {
    type: "LOAD",
    transactionDate: date,
    fromPartyId: G.farmer,
    destinationMillId: G.mill,
    varietyId: G.variety.SWARNA!,
    weight: manualWeight(g),
    ratePaisePerQtl: (2500n * RS).toString(),
    totalPaise: "0",
    vehicleNumber: "WB12AB3456",
  };
}

describe("Daily Load Khata (§12.5)", () => {
  it("a linked load never double-deducts; links are 1:1 both ways", async () => {
    await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 50n * QTL, 2000n * RS, D0),
      null,
    );
    expect(await paddy()).toBe(50n * QTL);
    const [load] = await saveLoad(GA, loadDraft(20n * QTL));
    // The load alone moves no stock and no money.
    expect(await paddy()).toBe(50n * QTL);
    expect(await db().ledgerLines.where("voucherId").equals(load!._id).count()).toBe(0);
    expect(load!.type === "LOAD" && load.totalPaise).toBe((50_000n * RS).toString());

    // Create a sale from the load: the sale is the only record that moves stock.
    const saleId = newId();
    const extra = await linkFromLoadItem(GA, load!._id, { type: "SALE", id: saleId });
    await saveBillWithInitialPayment(
      GA,
      {
        ...saleDraft(G.mill, G.variety.SWARNA!, 20n * QTL, 2500n * RS, D1),
        _id: saleId,
        linkedLoadId: load!._id,
      },
      null,
      { extra: [extra] },
    );
    expect(await paddy()).toBe(30n * QTL);
    const stored = await db().vouchers.get(load!._id);
    expect(stored!.type === "LOAD" && stored.link).toEqual({ type: "SALE", id: saleId });
    const [row] = await loadRows(GA);
    expect(row!.linked?._id).toBe(saleId);

    // A second load can't take the same sale; the first load can't take another record.
    const [load2] = await saveLoad(GA, loadDraft(5n * QTL));
    const e1 = await linkLoad(GA, load2!._id, { type: "SALE", id: saleId }).catch(
      (e: unknown) => e,
    );
    expect((e1 as RepoError).code).toBe("ALREADY_LINKED");
    const other = await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 5n * QTL, 2500n * RS, D1),
      null,
    );
    const e2 = await linkLoad(GA, load!._id, { type: "SALE", id: other.bill._id }).catch(
      (e: unknown) => e,
    );
    expect((e2 as RepoError).code).toBe("ALREADY_LINKED");
    // The free load links to the other sale; candidates rank the same-vehicle / same-date one.
    expect((await linkCandidates(GA, load2 as never, "SALE")).map((c) => c.doc._id)).toEqual([
      other.bill._id,
    ]);
    await linkLoad(GA, load2!._id, { type: "SALE", id: other.bill._id });
    expect(await paddy()).toBe(25n * QTL);

    // Editing a linked load's quantity with "update the linked record too": still one deduction.
    await saveLoad(GA, loadDraft(22n * QTL), { id: load!._id, updateLinked: true });
    expect(await paddy()).toBe(23n * QTL);
    const sale = await db().vouchers.get(saleId);
    expect(sale!.type === "SALE" && sale.weight.netG).toBe((22n * QTL).toString());

    // Unlink: both sides cleared; voiding a linked record leaves the load "not linked".
    await unlinkLoad(GA, load2!._id);
    const o = await db().vouchers.get(other.bill._id);
    expect((o as { linkedLoadId?: string }).linkedLoadId).toBeUndefined();
    await voidDoc(GA, saleId, "ভুল");
    expect((await loadRows(GA, { unlinked: true })).map((r) => r.doc._id).sort()).toEqual(
      [load!._id, load2!._id].sort(),
    );
    const groups = groupLoads(await loadRows(GA), "date");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.totalG).toBe(27n * QTL);
    expect(groups[0]!.unlinked).toBe(2);
    await storedEqualsReplay();
  });

  it("links a load to a mill dispatch", async () => {
    const [load] = await saveLoad(GA, loadDraft(10n * QTL));
    const dispatch = await saveDoc(GA, {
      type: "MILL_DISPATCH",
      dispatchType: "MILLING",
      millPartyId: G.mill,
      dispatchDate: D1,
      varietyId: G.variety.SWARNA!,
      weight: manualWeight(10n * QTL),
      ratePaisePerQtl: "0",
      totalValuePaise: "0",
      vehicleNumber: "WB12AB3456",
    } as DraftOf<"MILL_DISPATCH">);
    const c = await linkCandidates(GA, load as never, "MILL_DISPATCH");
    expect(c[0]!.score).toBe(11);
    await linkLoad(GA, load!._id, { type: "MILL_DISPATCH", id: dispatch._id });
    const d = await db().vouchers.get(dispatch._id);
    expect((d as { linkedLoadId?: string }).linkedLoadId).toBe(load!._id);
    await storedEqualsReplay();
  });
});

describe("Due & Advance (§12.6)", () => {
  it("remaining = ledger balance for every party; categories by sign; a mill dispatch is owed by the mill", async () => {
    const p1 = await saveBillWithInitialPayment(
      GA,
      { ...purchaseDraft(G.farmer, G.variety.SWARNA!, 10n * QTL, 2000n * RS, D0), dueDate: D1 },
      { amountPaise: (5_000n * RS).toString(), paymentDate: D0, mode: "CASH" },
    );
    await saveBillWithInitialPayment(
      GA,
      saleDraft(G.customer, G.variety.SWARNA!, 4n * QTL, 2500n * RS, D1),
      null,
    );
    await saveBillWithInitialPayment(
      GA,
      {
        type: "MILL_DISPATCH",
        dispatchType: "CONSIGNMENT",
        millPartyId: G.mill,
        dispatchDate: D1,
        varietyId: G.variety.SWARNA!,
        weight: manualWeight(2n * QTL),
        ratePaisePerQtl: (2500n * RS).toString(),
        totalValuePaise: "0",
      } as DraftOf<"MILL_DISPATCH">,
      { amountPaise: (1_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
    );
    const rows = await partyDues(GA);
    const bal = await godownBalances(GA);
    for (const r of rows) expect(r.balancePaise).toBe(bal.get(`PARTY:${r.party._id}`));
    const byId = new Map(rows.map((r) => [r.party._id, r]));
    expect(byId.get(G.farmer)).toMatchObject({
      category: "payable",
      balancePaise: -15_000n * RS,
      totalPaise: 20_000n * RS,
      paidPaise: 5_000n * RS,
      earliestDue: D1,
      overdueDays: 2,
    });
    expect(byId.get(G.customer)).toMatchObject({
      category: "receivable",
      balancePaise: 10_000n * RS,
    });
    // v2.1: the mill pays for the paddy (an old "consignment" type is ignored): 2 qtl × ₹2,500
    // = ₹5,000 owed, ₹1,000 already received → the mill owes ₹4,000 (পাওনা, never দেনা).
    expect(byId.get(G.mill)).toMatchObject({ category: "mill", balancePaise: 4_000n * RS });
    expect(byId.get(G.mill)!.open.map((o) => o.state.duePaise)).toEqual([4_000n * RS]);
    const sum = dueSummary(rows);
    expect(sum.totals.payable).toBe(15_000n * RS);
    expect(sum.totals.receivable).toBe(10_000n * RS);
    expect(sum.totals.mill).toBe(4_000n * RS);
    expect(sum.aging.pay.D31_60).toBe(15_000n * RS);
    expect(sum.aging.collect.D0_30).toBe(14_000n * RS);

    // Automatic reminder from the due date; mark done.
    let rem = await reminderRows(GA);
    expect(rem.map((r) => [r.id, r.kind, r.amountPaise])).toEqual([
      [`auto:${p1.bill._id}`, "PAY", 15_000n * RS],
    ]);
    await setReminderState(
      GA,
      { source: { type: "PURCHASE", id: p1.bill._id }, kind: "PAY", dueDate: D1 },
      "done",
    );
    rem = await reminderRows(GA);
    expect(rem[0]!.status).toBe("done");
  });

  it("pays across bills oldest first under one group; the rest is an advance", async () => {
    const a = await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 2n * QTL, 2000n * RS, D0),
      null,
    );
    const b = await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, 3n * QTL, 2000n * RS, D1),
      null,
    );
    const open = await openBillsOf(GA, G.farmer, "OUT");
    expect(open.map((o) => o.doc._id)).toEqual([a.bill._id, b.bill._id]);
    const plan = allocateFifo(
      12_000n * RS,
      open.map((o) => o.state),
    );
    expect(plan.allocations.map((x) => x.amountPaise)).toEqual([4_000n * RS, 6_000n * RS]);
    expect(plan.advancePaise).toBe(2_000n * RS);
    const saved = await payParty(
      GA,
      G.farmer,
      "OUT",
      { amountPaise: (12_000n * RS).toString(), paymentDate: D2, mode: "CASH" },
      plan.allocations.map((x) => ({
        source: open.find((o) => o.state.bill.sourceId === x.sourceId)!.doc,
        sourceId: x.sourceId,
        amountPaise: x.amountPaise,
      })),
    );
    expect(saved).toHaveLength(3);
    expect(new Set(saved.map((s) => s.groupId)).size).toBe(1);
    expect(saved[2]).toMatchObject({ source: { type: "PARTY_ADVANCE", id: null } });
    expect(await openBillsOf(GA, G.farmer, "OUT")).toEqual([]);
    expect((await godownBalances(GA)).get(`PARTY:${G.farmer}`)).toBe(2_000n * RS);
    expect((await partyDues(GA))[0]).toMatchObject({ category: "advance" });
    // More than a bill's due on one line is refused.
    const c = await saveBillWithInitialPayment(
      GA,
      purchaseDraft(G.farmer, G.variety.SWARNA!, QTL, 2000n * RS, D2),
      null,
    );
    const err = await payParty(
      GA,
      G.farmer,
      "OUT",
      { amountPaise: (5_000n * RS).toString(), paymentDate: D2, mode: "CASH" },
      [{ source: c.bill, sourceId: c.bill._id, amountPaise: 5_000n * RS }],
    ).catch((e: unknown) => e);
    expect((err as RepoError).code).toBe("OVERPAYMENT");
    await storedEqualsReplay();
  });
});

describe("Vehicle trips (§12.7)", () => {
  it("income, costs paid now, net profit, later payments", async () => {
    const vehicle = await upsertMaster(GA, "vehicle", { number: "WB11C2222", ownership: "own" });
    const cust = await upsertMaster(GA, "party", {
      name: "Paul Transport",
      roles: ["VEHICLE_CUSTOMER"],
    });
    const tripId = newId();
    const saved = await saveTrip(
      GA,
      {
        type: "TRIP",
        _id: tripId,
        transactionDate: D1,
        customerPartyId: cust._id,
        vehicleId: vehicle._id,
        driverName: "Sanjay",
        loadingLocation: "Rampur",
        destination: "Bardhaman",
        rateMode: "FIXED",
        ratePaise: (8_000n * RS).toString(),
        totalIncomePaise: "0",
        dueDate: TODAY,
        costs: [
          { id: "c1", kind: "DRIVER", amountPaise: (1_000n * RS).toString() },
          { id: "c2", kind: "DIESEL", amountPaise: (2_500n * RS).toString(), litresMl: "25000" },
          { id: "c3", kind: "OTHER", amountPaise: (300n * RS).toString(), payeeText: "Toll" },
        ],
      } as DraftOf<"TRIP">,
      {
        advance: { amountPaise: (3_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
        costs: {
          c1: { amountPaise: (1_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
          c2: { amountPaise: (2_000n * RS).toString(), paymentDate: D1, mode: "CASH" },
        },
      },
    );
    expect(saved).toHaveLength(4);
    let [row] = await tripRows(GA);
    expect(row!.netPaise).toBe(4_200n * RS);
    expect(row!.income!.duePaise).toBe(5_000n * RS);
    expect(row!.costs.map((c) => c.state.duePaise)).toEqual([0n, 500n * RS, 300n * RS]);
    // Pay the diesel rest later.
    await payBill(
      GA,
      row!.doc,
      { amountPaise: (500n * RS).toString(), paymentDate: D2, mode: "CASH" },
      { sourceId: vehicleCostSourceId(row!.doc, "c2") },
    );
    [row] = await tripRows(GA);
    expect(row!.costs[1]!.state.status).toBe("PAID");
    // A cost with payments can't be removed by editing.
    const { _id: _x, ...rest } = row!.doc;
    const err = await saveTrip(
      GA,
      { ...rest, costs: row!.doc.costs.filter((c) => c.id !== "c1") } as DraftOf<"TRIP">,
      {},
      { id: tripId },
    ).catch((e: unknown) => e);
    expect((err as RepoError).code).toBe("LINKED_PAYMENTS");
    const [vs] = await vehicleSummaries(GA);
    expect(vs!.pnl).toMatchObject({
      trips: 1,
      incomePaise: 8_000n * RS,
      receivedPaise: 3_000n * RS,
      netPaise: 4_200n * RS,
    });
    const months = await pnlByPeriod(GA, "month");
    expect(months[0]!.pnl.cost.DIESEL).toBe(2_500n * RS);
    await storedEqualsReplay();
  });
});

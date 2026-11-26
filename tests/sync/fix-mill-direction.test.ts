/**
 * The v2.1 mill-direction data repair (scripts/fix-mill-direction.ts) on a database holding v2.0
 * mill data: dry run writes nothing; undecided items block their Gola; with the owner's decisions
 * it repairs payments, rates, returns and consignment sales, rebuilds the derived rows, keeps
 * every stock quantity, changes cash only by 2 × the flipped payment, and is idempotent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBusinessWithOwner } from "@/server/business";
import { closeMongo, cols, getDb, type UserDoc } from "@/server/db";
import { toDbLine, toDbMove } from "@/server/convert";
import {
  fixMillDirection,
  reconciliationMarkdown,
  reviewMarkdown,
} from "@/server/fixMillDirection";
import { createGodown } from "@/server/godownService";
import { deriveAll } from "@/domain/v2/replay";
import type { Doc } from "@/domain/v2/schemas";
import { useTestServer } from "../helpers/server";
import { doc, manual, opening, payment, QTL, RS } from "../helpers/v2";

const TODAY = "2026-11-26";
const d = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;
let owner: UserDoc;
let G: string;
let V: string;
const M = "mill-party-1";
let docs: Doc[];
let ids: {
  a: string;
  aOut: string;
  b: string;
  ret: string;
  retPay: string;
  sale: string;
  adv: string;
};

beforeAll(async () => {
  useTestServer("fixmill");
  const db = await getDb();
  owner = (
    await createBusinessWithOwner(db, {
      ownerName: "Owner",
      mobile: "9830000201",
      password: "owner-pass-1",
      businessName: "Fix Test",
    })
  ).owner;
  G = (await createGodown(db, owner, { name: "Rampur", code: "RP" }))._id;
  V = (await cols(db).varieties.findOne({ godownId: G }))!._id as string;
  await cols(db).parties.insertOne({
    _id: M,
    businessId: owner.businessId,
    godownId: G,
    name: "Mill One",
    roles: ["MILL"],
    searchKey: "mill one",
    status: "active",
  } as never);

  const o = { godownId: G, businessId: owner.businessId };
  const op = opening(
    d(1),
    [
      { kind: "CASH", amountPaise: (50_000n * RS).toString() },
      {
        kind: "STOCK",
        product: "PADDY",
        location: "WAREHOUSE",
        varietyId: V,
        qtyG: (100n * QTL).toString(),
        amountPaise: (2_00_000n * RS).toString(),
      },
    ],
    o,
  );
  // v2.0 MILLING dispatch: rate = milling charge ₹50/qtl, "paid to the mill" ₹1,000 (OUT).
  const a = doc(
    "MILL_DISPATCH",
    d(10),
    {
      dispatchType: "MILLING",
      millPartyId: M,
      dispatchDate: d(10),
      varietyId: V,
      weight: manual(20n * QTL),
      ratePaisePerQtl: (50n * RS).toString(),
      totalValuePaise: "0",
    },
    o,
  );
  const aOut = payment(
    d(11),
    "OUT",
    1_000n * RS,
    { type: "MILL_DISPATCH", id: a._id },
    { partyId: M },
    o,
  );
  // v2.0 CONSIGNMENT dispatch 10 qtl @ ₹2,500, 2 qtl paddy back (money received with the return),
  // settled by a SALE of 8 qtl @ ₹2,550 that carries the ₹5,000 advance.
  const b = doc(
    "MILL_DISPATCH",
    d(12),
    {
      dispatchType: "CONSIGNMENT",
      millPartyId: M,
      dispatchDate: d(12),
      varietyId: V,
      weight: manual(10n * QTL),
      ratePaisePerQtl: (2500n * RS).toString(),
      totalValuePaise: "0",
    },
    o,
  );
  const ret = doc(
    "MILL_RETURN",
    d(13),
    {
      dispatchId: b._id,
      millPartyId: M,
      returnDate: d(13),
      product: "PADDY",
      varietyId: V,
      weight: manual(2n * QTL),
      dedupeKey: "",
    },
    o,
  );
  const retPay = payment(
    d(13),
    "IN",
    1_000n * RS,
    { type: "MILL_RETURN", id: ret._id },
    { partyId: M },
    o,
  );
  const sale = doc(
    "SALE",
    d(14),
    {
      transactionDate: d(14),
      partyId: M,
      product: "PADDY",
      varietyId: V,
      source: "MILL",
      sourceMillId: M,
      weight: manual(8n * QTL),
      ratePaisePerQtl: (2550n * RS).toString(),
      amountPaise: "0",
      roundOffPaise: "0",
      totalPaise: "0",
      saleStatus: "CONFIRMED",
      deliveryStatus: "DELIVERED",
      deliveryLog: [],
      consignmentDispatchId: b._id,
    },
    o,
  );
  const adv = payment(d(12), "IN", 5_000n * RS, { type: "SALE", id: sale._id }, { partyId: M }, o);
  docs = [op, a, aOut, b, ret, retPay, sale, adv];
  ids = {
    a: a._id,
    aOut: aOut._id,
    b: b._id,
    ret: ret._id,
    retPay: retPay._id,
    sale: sale._id,
    adv: adv._id,
  };
  const k = cols(db);
  await k.vouchers.insertMany(docs as never[]);
  const derived = deriveAll(docs);
  await k.ledgerLines.insertMany(derived.lines.map(toDbLine));
  await k.stockMoves.insertMany(derived.moves.map(toDbMove));
});

afterAll(async () => {
  await closeMongo();
});

const run = async (apply: boolean, decisions = {}) =>
  fixMillDirection(await getDb(), {
    apply,
    decisions,
    actorId: owner._id,
    today: TODAY,
    godownIds: [G],
  });

describe("mill-direction data repair", () => {
  it("dry run: lists the review items, blocks the Gola, writes nothing", async () => {
    const before = await (await getDb()).collection("vouchers").countDocuments();
    const r = await run(true); // even with --apply, an undecided blocking item stops the Gola
    const g = r.golas[0]!;
    expect(g.status).toBe("blocked");
    expect(g.review.map((x) => [x.kind, x.docId]).sort()).toEqual(
      [
        ["MILLING_RATE", ids.a],
        ["PAYMENT_DIRECTION", ids.aOut],
      ].sort(),
    );
    expect(await (await getDb()).collection("vouchers").countDocuments()).toBe(before);
    const md = reviewMarkdown(r, new Map([[M, "Mill One"]]));
    expect(md).toContain("Mill One");
    expect(md).toContain(ids.aOut);
  });

  it("with decisions: repairs everything, keeps stock, cash changes only by 2 × the flip", async () => {
    const r = await run(true, { payments: { [ids.aOut]: "IN" }, rates: { [ids.a]: "2600" } });
    const g = r.golas[0]!;
    expect(g.problems).toEqual([]);
    expect(g.status).toBe("applied");
    expect(g.checks.filter((c) => c.startsWith("FAIL"))).toEqual([]);
    // Stock quantities unchanged.
    expect(g.after!.warehousePaddyG).toBe(72n * QTL);
    expect(g.after!.millPaddyG).toBe(20n * QTL);
    expect(g.before.warehousePaddyG).toBe(g.after!.warehousePaddyG);
    expect(g.before.millPaddyG).toBe(g.after!.millPaddyG);
    // Cash: 50,000 − 1,000 + 5,000 + 1,000 = 55,000 → +2 × 1,000 = 57,000.
    expect(g.before.cashPaise).toBe(55_000n * RS);
    expect(g.after!.cashPaise).toBe(57_000n * RS);
    // Mill owes: A 52,000 − 1,000; B 25,000 − 5,000 (return credit) + 400 (settlement extra)
    // − 6,000 collected → 51,000 + 14,400.
    expect(g.after!.mills[M]).toBe(65_400n * RS);

    const k = cols(await getDb());
    const sale = await k.vouchers.findOne({ _id: ids.sale });
    expect(sale).toMatchObject({ status: "void" });
    const st = await k.vouchers.findOne({ type: "MILL_SETTLEMENT", dispatchId: ids.b });
    expect(st).toMatchObject({
      acceptedG: (8n * QTL).toString(),
      adjustmentPaise: (-400n * RS).toString(),
    });
    expect(await k.vouchers.findOne({ _id: ids.retPay })).toMatchObject({
      source: { type: "MILL_DISPATCH", id: ids.b },
    });
    expect(await k.vouchers.findOne({ _id: ids.adv })).toMatchObject({
      source: { type: "MILL_DISPATCH", id: ids.b },
    });
    expect(await k.vouchers.findOne({ _id: ids.aOut })).toMatchObject({ direction: "IN" });
    const a = await k.vouchers.findOne({ _id: ids.a });
    expect(a).toMatchObject({ ratePaisePerQtl: (2600n * RS).toString() });
    expect(a).not.toHaveProperty("dispatchType");
    // Devices re-download: every voucher of the Gola got a fresh serverSeq.
    expect(await k.vouchers.countDocuments({ godownId: G, serverSeq: { $exists: false } })).toBe(0);
    // No mill payable line remains anywhere.
    expect(await k.ledgerLines.countDocuments({ godownId: G, account: "MILLING_CHARGES" })).toBe(0);
    expect(reconciliationMarkdown(r, new Map([[M, "Mill One"]]))).toContain("OK CASH");
  });

  it("is idempotent: a second run finds nothing to change", async () => {
    const r = await run(true, { payments: { [ids.aOut]: "IN" }, rates: { [ids.a]: "2600" } });
    expect(r.golas[0]!.changedDocs).toBe(0);
    expect(r.golas[0]!.status).toBe("unchanged");
  });
});

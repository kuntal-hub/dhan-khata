import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { META, getMeta } from "@/client/db/meta";
import {
  RepoError,
  createVoucher,
  createVoucherGroup,
  editVoucher,
  newId,
  rebuildDailyAgg,
  upsertMaster,
  voidVoucher,
  voidVoucherGroup,
} from "@/client/repo";
import { accountBalance, godownTrialBalance, partyBalance } from "@/client/queries/ledger";
import { stockOf } from "@/client/queries/stock";
import { allGodownsTotals, godownTotals } from "@/client/queries/consolidated";
import { addDays } from "@/domain/dates";
import { ACC } from "@/domain/posting/accounts";
import { replay } from "@/domain/posting/replay";
import { toLedgerLineDocs } from "@/domain/posting/replay";
import {
  TODAY,
  expenseDraft,
  paymentDraft,
  purchaseDraft,
  saleDraft,
  setupDevice,
  useClock,
  userDoc,
  type LocalGodown,
} from "../helpers/local";

const QTL = 100_000n; // grams per quintal

let A: LocalGodown;
let B: LocalGodown;

beforeEach(async () => {
  useClock(null);
  const w = await setupDevice("repo-test", {
    godowns: [
      { id: "GA", code: "RP" },
      { id: "GB", code: "SP" },
    ],
  });
  A = w.GA!;
  B = w.GB!;
});

afterEach(() => useClock(null));

async function counts() {
  const d = db();
  return {
    vouchers: await d.vouchers.count(),
    lines: await d.ledgerLines.count(),
    moves: await d.stockMoves.count(),
    outbox: await d.outbox.count(),
    audit: await d.auditLocal.count(),
    agg: await d.dailyAgg.count(),
    seq: await getMeta<number>("voucherSeq:GA:PURCHASE"),
  };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof RepoError && e.code === code);
}

describe("createVoucher", () => {
  it("writes voucher, balanced lines, stock, dailyAgg, outbox op and audit in one go", async () => {
    const v = await createVoucher(
      "GA",
      purchaseDraft(A.farmer, A.variety.SWARNA!, 10n * QTL, 200000n),
    );
    expect(v.number).toBe("RP-A-PUR-000001");
    expect(v.rev).toBe(1);
    expect((v as { totalPaise: string }).totalPaise).toBe("2000000");
    expect(v.fy).toMatch(/^\d{4}-\d{2}$/);

    const tb = await godownTrialBalance("GA");
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(2000000n);
    expect(await partyBalance("GA", A.farmer)).toBe(-2000000n);
    expect(await stockOf("GA", A.variety.SWARNA!)).toEqual({
      qtyG: 1_000_000n,
      valuePaise: 2000000n,
    });

    const ops = await db().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      entity: "voucher",
      entityId: v._id,
      op: "upsert",
      baseRev: 0,
      status: "pending",
      godownId: "GA",
    });
    expect((ops[0]!.payload as { serverSeq?: number }).serverSeq).toBeUndefined();
    expect(await db().auditLocal.count()).toBe(1);
    const agg = await db().dailyAgg.get(["GA", TODAY]);
    expect(agg?.accounts[ACC.STOCK]).toEqual({ dr: "2000000", cr: "0" });
  });

  it("numbers per godown, per device, per type", async () => {
    const p1 = await createVoucher("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 200000n));
    const p2 = await createVoucher("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 200000n));
    const pay = await createVoucher("GA", paymentDraft(A.farmer, 1000n));
    const b1 = await createVoucher("GB", purchaseDraft(B.farmer, B.variety.SWARNA!, QTL, 200000n));
    expect([p1.number, p2.number, pay.number, b1.number]).toEqual([
      "RP-A-PUR-000001",
      "RP-A-PUR-000002",
      "RP-A-PAY-000001",
      "SP-A-PUR-000001",
    ]);
  });

  it("writes nothing when anything fails (cross-godown reference)", async () => {
    await createVoucher("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 200000n));
    const before = await counts();
    await expectCode(
      createVoucher("GA", purchaseDraft(B.farmer, A.variety.SWARNA!, QTL, 200000n)),
      "CROSS_GODOWN_REFERENCE",
    );
    expect(await counts()).toEqual(before);
  });

  it("a group is all-or-nothing and shares one groupId", async () => {
    const before = await counts();
    await expectCode(
      createVoucherGroup("GA", [
        purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 200000n),
        paymentDraft("NO-SUCH-PARTY", 500n),
      ]),
      "INVALID_REFERENCE",
    );
    expect(await counts()).toEqual(before);

    const [p, pay] = await createVoucherGroup("GA", [
      purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 200000n),
      paymentDraft(A.farmer, 50000n),
    ]);
    expect(p!.groupId).toBeDefined();
    expect(pay!.groupId).toBe(p!.groupId);
    expect(await partyBalance("GA", A.farmer)).toBe(-200000n + 50000n);
  });

  it("rejects schema-invalid input and business-rule violations", async () => {
    await expectCode(
      createVoucher("GA", { ...expenseDraft(100n), description: "" } as never),
      "VALIDATION_FAILED",
    );
    await expectCode(
      createVoucher("GA", { ...paymentDraft(A.farmer, 100n), mode: "UPI" } as never),
      "BANK_ACCOUNT_REQUIRED",
    );
  });

  it("refuses unknown and archived godowns", async () => {
    await expectCode(createVoucher("NOPE", expenseDraft(100n)), "GODOWN_NOT_FOUND");
    await db().godowns.update("GB", { status: "archived" });
    await expectCode(createVoucher("GB", expenseDraft(100n)), "GODOWN_ARCHIVED");
  });
});

describe("editVoucher / voidVoucher", () => {
  it("edit writes rev n+1, replaces lines, queues an op with baseRev n; edit back restores amounts", async () => {
    const draft = purchaseDraft(A.farmer, A.variety.SWARNA!, 10n * QTL, 200000n);
    const v1 = await createVoucher("GA", draft);
    const linesV1 = await db().ledgerLines.where("voucherId").equals(v1._id).toArray();

    const v2 = await editVoucher(
      "GA",
      v1._id,
      purchaseDraft(A.farmer, A.variety.SWARNA!, 12n * QTL, 210000n),
      "weight fixed",
    );
    expect(v2.rev).toBe(2);
    expect(v2.number).toBe(v1.number);
    expect(v2.editReason).toBe("weight fixed");
    const linesV2 = await db().ledgerLines.where("voucherId").equals(v1._id).toArray();
    expect(linesV2.every((l) => l.voucherRev === 2)).toBe(true);
    expect(await partyBalance("GA", A.farmer)).toBe(-2520000n);
    const ops = await db().outbox.orderBy("seq").toArray();
    expect(ops.map((o) => o.baseRev)).toEqual([0, 1]);

    const v3 = await editVoucher("GA", v1._id, draft);
    expect(v3.rev).toBe(3);
    const linesV3 = await db().ledgerLines.where("voucherId").equals(v1._id).toArray();
    const amounts = (ls: typeof linesV1) =>
      ls.map((l) => [l.account, l.debitPaise, l.creditPaise]).sort();
    expect(amounts(linesV3)).toEqual(amounts(linesV1));
    expect(await stockOf("GA", A.variety.SWARNA!)).toEqual({
      qtyG: 1_000_000n,
      valuePaise: 2000000n,
    });
  });

  it("an edit can never change godownId or type", async () => {
    const v = await createVoucher("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 200000n));
    await expectCode(
      editVoucher("GB", v._id, purchaseDraft(B.farmer, B.variety.SWARNA!, QTL, 1n)),
      "GODOWN_IMMUTABLE",
    );
    await expectCode(
      editVoucher("GA", v._id, {
        ...purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 1n),
        godownId: "GB",
      } as never),
      "GODOWN_IMMUTABLE",
    );
    await expectCode(editVoucher("GA", v._id, expenseDraft(100n)), "TYPE_IMMUTABLE");
  });

  it("void removes postings and stock; a void voucher can't be edited", async () => {
    const v = await createVoucher("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 200000n));
    const vv = await voidVoucher("GA", v._id, "wrong party");
    expect(vv.status).toBe("void");
    expect(vv.rev).toBe(2);
    expect(await db().ledgerLines.count()).toBe(0);
    expect(await db().stockMoves.count()).toBe(0);
    expect(await db().dailyAgg.count()).toBe(0);
    const ops = await db().outbox.orderBy("seq").toArray();
    expect(ops[1]).toMatchObject({ op: "void", baseRev: 1 });
    await expectCode(
      editVoucher("GA", v._id, purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 1n)),
      "VOUCHER_VOID",
    );
    await expectCode(voidVoucher("GA", v._id, " "), "NOTE_REQUIRED");
  });

  it("voids a whole group together", async () => {
    const [p] = await createVoucherGroup("GA", [
      purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 200000n),
      paymentDraft(A.farmer, 50000n),
    ]);
    const voided = await voidVoucherGroup("GA", p!.groupId!, "duplicate entry");
    expect(voided).toHaveLength(2);
    expect(await partyBalance("GA", A.farmer)).toBe(0n);
  });
});

describe("cost of goods re-posting", () => {
  it("a back-dated purchase re-posts later sales so stored lines equal a full replay", async () => {
    const d1 = addDays(TODAY, -2);
    const d2 = addDays(TODAY, -1);
    const sw = A.variety.SWARNA!;
    await createVoucher("GA", purchaseDraft(A.farmer, sw, 10n * QTL, 200000n, d1));
    const sale = await createVoucher("GA", saleDraft(A.mill, sw, 5n * QTL, 250000n, d2));
    const cogs1 = await accountBalance("GA", ACC.COGS);
    expect(cogs1).toBe(1000000n);

    // Back-dated purchase at a different rate changes the average cost before the sale.
    await createVoucher("GA", purchaseDraft(A.farmer, sw, 10n * QTL, 300000n, addDays(TODAY, -3)));
    const cogs2 = await accountBalance("GA", ACC.COGS);
    expect(cogs2).toBe(1250000n);

    const vouchers = await db().vouchers.where("godownId").equals("GA").toArray();
    const { results } = replay(vouchers);
    const expected = results.flatMap((r) => toLedgerLineDocs(r.voucher, r.lines));
    const stored = await db().ledgerLines.toArray();
    const canon = (ls: typeof stored) =>
      ls.map((l) => `${l._id}|${l.account}|${l.debitPaise}|${l.creditPaise}`).sort();
    expect(canon(stored)).toEqual(canon(expected));
    expect(sale.type).toBe("SALE");
  });
});

describe("dailyAgg", () => {
  it("incremental aggregates equal a rebuild from scratch", async () => {
    const sw = A.variety.SWARNA!;
    const p = await createVoucher("GA", purchaseDraft(A.farmer, sw, 7n * QTL, 210000n));
    await createVoucher("GA", saleDraft(A.mill, sw, 3n * QTL, 260000n));
    await createVoucher("GA", expenseDraft(15000n, addDays(TODAY, -1)));
    await editVoucher("GA", p._id, purchaseDraft(A.farmer, sw, 8n * QTL, 210000n));
    const incremental = await db().dailyAgg.toArray();
    await rebuildDailyAgg("GA");
    const rebuilt = await db().dailyAgg.toArray();
    expect(rebuilt).toEqual(incremental);
  });
});

describe("godown isolation (G10)", () => {
  it("entries in godown A never change any balance, stock or total in godown B", async () => {
    await createVoucher("GB", purchaseDraft(B.farmer, B.variety.SWARNA!, 4n * QTL, 200000n));
    const bBefore = await godownTotals("GB");
    const linesB = await db()
      .ledgerLines.where("[godownId+date]")
      .between(["GB", ""], ["GB", "￿"])
      .toArray();

    await createVoucher("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, 9n * QTL, 200000n));
    await createVoucher("GA", saleDraft(A.mill, A.variety.SWARNA!, 2n * QTL, 250000n));
    await createVoucher("GA", paymentDraft(A.farmer, 10000n));
    await createVoucher("GA", expenseDraft(5000n));

    expect(await godownTotals("GB")).toEqual(bBefore);
    const linesBAfter = await db()
      .ledgerLines.where("[godownId+date]")
      .between(["GB", ""], ["GB", "￿"])
      .toArray();
    expect(linesBAfter).toEqual(linesB);

    const all = await allGodownsTotals(["GA", "GB"]);
    const a = await godownTotals("GA");
    expect(all.total.cashPaise).toBe(a.cashPaise + bBefore.cashPaise);
    expect(all.total.payablePaise).toBe(a.payablePaise + bBefore.payablePaise);
    expect(all.total.stockQtyG).toBe(a.stockQtyG + bBefore.stockQtyG);
  });
});

describe("roles and day locks", () => {
  it("entry role: own entry types only; 30-minute / unsynced edit window", async () => {
    await setupDevice("repo-test", {
      user: userDoc("U-ENTRY", { isOwner: false, access: [{ godownId: "GA", role: "entry" }] }),
      godowns: [{ id: "GA", code: "RP" }],
    });
    const w = { farmer: "GA-P-FARMER", mill: "GA-P-MILL", sw: "GA-V-SWARNA" };
    await expectCode(createVoucher("GA", saleDraft(w.mill, w.sw, QTL, 1n)), "FORBIDDEN");
    await expectCode(createVoucher("GB", expenseDraft(100n)), "GODOWN_NOT_FOUND");

    useClock("2026-11-23T05:00:00.000Z");
    const p = await createVoucher("GA", purchaseDraft(w.farmer, w.sw, QTL, 200000n, "2026-11-23"));
    useClock("2026-11-23T05:20:00.000Z");
    const e = await editVoucher(
      "GA",
      p._id,
      purchaseDraft(w.farmer, w.sw, 2n * QTL, 200000n, "2026-11-23"),
    );
    expect(e.rev).toBe(2);
    useClock("2026-11-23T05:31:00.000Z");
    await expectCode(
      editVoucher("GA", p._id, purchaseDraft(w.farmer, w.sw, 3n * QTL, 200000n, "2026-11-23")),
      "EDIT_WINDOW_EXPIRED",
    );
    // A synced entry can't be edited by `entry` even inside the window.
    useClock("2026-11-23T05:00:00.000Z");
    const q = await createVoucher("GA", purchaseDraft(w.farmer, w.sw, QTL, 200000n, "2026-11-23"));
    await db().vouchers.update(q._id, { serverSeq: 42 });
    await expectCode(voidVoucher("GA", q._id, "x"), "EDIT_WINDOW_EXPIRED");
  });

  it("manager can't write to a locked day; the owner can", async () => {
    await setupDevice("repo-test", {
      user: userDoc("U-MGR", { isOwner: false, access: [{ godownId: "GA", role: "manager" }] }),
      godowns: [{ id: "GA", code: "RP" }],
    });
    const old = addDays(TODAY, -8); // default lockAfterDays = 7
    await expectCode(createVoucher("GA", expenseDraft(100n, old)), "DAY_LOCKED");
    await db().dayStatus.put({ _id: `GA:${TODAY}`, godownId: "GA", date: TODAY, closed: true });
    await expectCode(createVoucher("GA", expenseDraft(100n)), "DAY_LOCKED");
    await expectCode(
      createVoucher("GA", { ...expenseDraft(100n), type: "JOURNAL" } as never),
      "FORBIDDEN",
    );

    await setupDevice("repo-test", { godowns: [{ id: "GA", code: "RP" }] });
    const v = await createVoucher("GA", expenseDraft(100n, old));
    expect(v.status).toBe("active");
  });

  it("viewer can't write at all", async () => {
    await setupDevice("repo-test", {
      user: userDoc("U-V", { isOwner: false, access: [{ godownId: "GA", role: "viewer" }] }),
      godowns: [{ id: "GA", code: "RP" }],
    });
    await expectCode(createVoucher("GA", expenseDraft(100n)), "FORBIDDEN");
    await expectCode(upsertMaster("GA", "place", { name: "Ghat" }), "FORBIDDEN");
  });
});

describe("masters", () => {
  it("party upsert generates searchKey, queues op, edit sends changed fields", async () => {
    const p = await upsertMaster("GA", "party", {
      name: "রমেশ মণ্ডল",
      roles: ["farmer"],
      village: "রামপুর",
    });
    expect(p.searchKey.length).toBeGreaterThan(0);
    const edited = await upsertMaster("GA", "party", {
      _id: p._id,
      name: p.name,
      roles: p.roles,
      village: "রামপুর",
      phone: "9830012345",
    });
    expect(edited.rev).toBe(2);
    const ops = await db().outbox.orderBy("seq").toArray();
    expect(ops[1]).toMatchObject({ entity: "party", baseRev: 1 });
    expect(ops[1]!.fields).toEqual(["phone", "searchKey"]);
  });

  it("vehicle numbers are normalized; cross-godown owner party is rejected", async () => {
    const v = await upsertMaster("GA", "vehicle", { number: "wb 12 ab 3456", ownership: "own" });
    expect(v.number).toBe("WB12AB3456");
    await expectCode(
      upsertMaster("GA", "vehicle", {
        number: "WB11",
        ownership: "external",
        ownerPartyId: B.farmer,
      }),
      "CROSS_GODOWN_REFERENCE",
    );
    await expectCode(
      upsertMaster("GB", "vehicle", { _id: v._id, number: "WB12AB3456", ownership: "own" }),
      "GODOWN_IMMUTABLE",
    );
  });

  it("vouchers can link to vouchers created in the same group", async () => {
    const purchaseId = newId();
    const [p, e] = await createVoucherGroup("GA", [
      { ...purchaseDraft(A.farmer, A.variety.SWARNA!, QTL, 200000n), _id: purchaseId },
      { ...expenseDraft(500n), loadId: purchaseId } as never,
    ]);
    expect(p!._id).toBe(purchaseId);
    expect((e as { loadId?: string }).loadId).toBe(purchaseId);
    expect(await getMeta(META.session)).toBeDefined();
  });
});

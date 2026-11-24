/**
 * Phase 4 local write path + queries: expenses, contra, day close & day locks per role, stock
 * adjustment, inter-godown transfers, dashboard cards, consolidated totals.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { META, getMeta, setMeta, type SessionMeta } from "@/client/db/meta";
import { accountBook, chequesInHand } from "@/client/queries/cashbank";
import {
  allGodownsTotals,
  consolidatedDashboard,
  godownTotals,
  searchAllGodowns,
} from "@/client/queries/consolidated";
import { dashboardData } from "@/client/queries/dashboard";
import { dailyExpense, monthlyExpenses, previousMonth } from "@/client/queries/expenses";
import { accountBalance, partyBalance } from "@/client/queries/ledger";
import { amountQuery, searchGodown } from "@/client/queries/search";
import { stockOf, stockRegister, stockSummary } from "@/client/queries/stock";
import { vehicleKhata, vehicleSummary } from "@/client/queries/vehicles";
import {
  RepoError,
  acceptTransfer,
  closeDay,
  createVoucher,
  editVoucher,
  saveSimple,
  saveTransfer,
  unlockDay,
  upsertMaster,
  voidTransfer,
  voidVoucher,
  type VoucherDraft,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import { ACC } from "@/domain/posting/accounts";
import type { GodownRole, Voucher } from "@/domain/schemas";
import {
  TODAY,
  expenseDraft,
  paymentDraft,
  purchaseDraft,
  saleDraft,
  setupDevice,
  userDoc,
  type LocalGodown,
} from "../helpers/local";

const QTL = 100_000n;
const YESTERDAY = addDays(TODAY, -1);
let A: LocalGodown;
let B: LocalGodown;

beforeEach(async () => {
  const w = await setupDevice("daily-test", {
    godowns: [
      { id: "GA", code: "RP" },
      { id: "GB", code: "SP" },
    ],
  });
  A = w.GA!;
  B = w.GB!;
});

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof RepoError && e.code === code);
}

async function asRole(role: GodownRole | "owner") {
  const s = (await getMeta<SessionMeta>(META.session))!;
  const user =
    role === "owner"
      ? userDoc("U-OWNER")
      : userDoc("U-STAFF", {
          isOwner: false,
          access: [
            { godownId: "GA", role },
            { godownId: "GB", role },
          ],
        });
  await setMeta(META.session, { ...s, user });
}

function contra(kind: string, amount: bigint, extra: Record<string, unknown> = {}): VoucherDraft {
  return {
    type: "CONTRA",
    date: TODAY,
    kind,
    amountPaise: amount.toString(),
    ...extra,
  } as VoucherDraft;
}

async function cashOpening(godownId: string, rupees: bigint, date = YESTERDAY) {
  await saveSimple(godownId, {
    type: "OPENING",
    date,
    items: [{ kind: "CASH", amountPaise: (rupees * 100n).toString() }],
  } as VoucherDraft);
}

describe("expenses (§9.4)", () => {
  it("daily screen: farmer payments block, category blocks, grand total and cash outflow", async () => {
    await saveSimple("GA", expenseDraft(120_000n));
    await saveSimple("GA", {
      ...expenseDraft(30_000n),
      categoryCode: "OTHERS",
      mode: "UPI",
      bankAccountId: undefined,
    } as unknown as VoucherDraft).catch((e: RepoError) => {
      expect(e.code).toBe("BANK_ACCOUNT_REQUIRED");
    });
    await saveSimple("GA", { ...expenseDraft(30_000n), categoryCode: "OTHERS" } as VoucherDraft);
    await saveSimple("GA", paymentDraft(A.farmer, 2_000_000n));
    await saveSimple("GA", paymentDraft(A.mill, 500_000n)); // not a farmer: not in the block
    const d = await dailyExpense("GA", TODAY);
    expect(d.farmerPayments).toHaveLength(1);
    expect(d.farmerTotalPaise).toBe(2_000_000n);
    expect(d.categories.map((c) => [c.code, c.totalPaise])).toEqual([
      ["LABOUR", 120_000n],
      ["OTHERS", 30_000n],
    ]);
    expect(d.expenseTotalPaise).toBe(150_000n);
    expect(d.grandTotalPaise).toBe(2_150_000n);
    expect(d.cashOutflowPaise).toBe(2_150_000n);
    // Description is required.
    await expectCode(
      saveSimple("GA", { ...expenseDraft(100n), description: " " } as VoucherDraft),
      "VALIDATION_FAILED",
    );
  });

  it("monthly view compares with the previous month", async () => {
    const ym = TODAY.slice(0, 7);
    const lastMonthDay = `${previousMonth(ym)}-15`;
    await saveSimple("GA", expenseDraft(100_000n));
    await saveSimple("GA", expenseDraft(40_000n, lastMonthDay));
    const rows = await monthlyExpenses("GA", ym);
    expect(rows).toEqual([{ code: "LABOUR", thisMonthPaise: 100_000n, lastMonthPaise: 40_000n }]);
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

describe("cash & bank (§9.9)", () => {
  it("contra kinds post correctly; cash book has running balance; cheques in hand clear/bounce", async () => {
    const bank = await upsertMaster("GA", "bankAccount", {
      name: "SBI",
      bank: "SBI",
      last4: "1234",
      isUpiLinked: false,
      openingBalancePaise: "0",
    });
    const bank2 = await upsertMaster("GA", "bankAccount", {
      name: "PNB",
      bank: "PNB",
      last4: "9876",
      isUpiLinked: false,
      openingBalancePaise: "0",
    });
    await saveSimple("GA", contra("CAPITAL_IN", 10_000_000n));
    await saveSimple("GA", contra("CASH_DEPOSIT", 4_000_000n, { bankAccountId: bank._id }));
    await saveSimple("GA", contra("CASH_WITHDRAWAL", 500_000n, { bankAccountId: bank._id }));
    await saveSimple(
      "GA",
      contra("BANK_TRANSFER", 1_000_000n, { bankAccountId: bank._id, toBankAccountId: bank2._id }),
    );
    await saveSimple("GA", contra("DRAWINGS", 200_000n));
    expect(await accountBalance("GA", ACC.CASH)).toBe(
      10_000_000n - 4_000_000n + 500_000n - 200_000n,
    );
    expect(await accountBalance("GA", `BANK:${bank._id}`)).toBe(2_500_000n);
    expect(await accountBalance("GA", `BANK:${bank2._id}`)).toBe(1_000_000n);
    expect(await accountBalance("GA", ACC.DRAWINGS)).toBe(200_000n);

    const book = await accountBook("GA", ACC.CASH, { from: TODAY, to: TODAY });
    expect(book.openingPaise).toBe(0n);
    expect(book.rows.map((r) => r.balancePaise)).toEqual([
      10_000_000n,
      6_000_000n,
      6_500_000n,
      6_300_000n,
    ]);
    expect(book.closingPaise).toBe(6_300_000n);

    // Two cheques from the mill: one clears into SBI, one bounces back onto the mill.
    const chq = (n: string) =>
      saveSimple("GA", {
        type: "RECEIPT",
        date: TODAY,
        partyId: A.mill,
        amountPaise: "1000000",
        mode: "CHEQUE",
        chequeNo: n,
        purpose: "BILL",
      } as VoucherDraft);
    const c1 = (await chq("111")).primary;
    const c2 = (await chq("222")).primary;
    expect((await chequesInHand("GA")).map((c) => c.receipt._id)).toEqual([c1._id, c2._id]);
    await saveSimple(
      "GA",
      contra("CHEQUE_CLEAR", 1_000_000n, { bankAccountId: bank._id, receiptVoucherId: c1._id }),
    );
    await saveSimple(
      "GA",
      contra("CHEQUE_BOUNCE", 1_000_000n, { partyId: A.mill, receiptVoucherId: c2._id }),
    );
    expect(await chequesInHand("GA")).toEqual([]);
    expect(await accountBalance("GA", ACC.CHEQUE_IN_HAND)).toBe(0n);
    expect(await accountBalance("GA", `BANK:${bank._id}`)).toBe(3_500_000n);
    expect(await partyBalance("GA", A.mill)).toBe(-1_000_000n); // only the cleared cheque counts
  });
});

describe("day close (§9.10)", () => {
  it("G5: expected cash, counted difference posts CASH_DIFF, day locks", async () => {
    await cashOpening("GA", 50_000n);
    await saveSimple("GA", paymentDraft(A.farmer, 2_000_000n));
    await saveSimple("GA", expenseDraft(120_000n));
    await saveSimple("GA", {
      type: "RECEIPT",
      date: TODAY,
      partyId: A.mill,
      amountPaise: "7500000",
      mode: "CASH",
      cashVia: { vehicleNumber: "WB12AB3456" },
      purpose: "BILL",
    } as VoucherDraft);
    const dash = await dashboardData("GA", TODAY);
    expect(dash.openingCashPaise).toBe(5_000_000n);
    expect(dash.expectedClosingCashPaise).toBe(10_380_000n); // ₹1,03,800.00

    await expectCode(
      closeDay("GA", { date: TODAY, countedCashPaise: 10_350_000n }),
      "NOTE_REQUIRED",
    );
    const dc = await closeDay("GA", {
      date: TODAY,
      countedCashPaise: 10_350_000n,
      denominations: { "500": 207 },
      notes: "₹300 short",
    });
    expect(dc.type === "DAY_CLOSE" && dc.differencePaise).toBe("-30000");
    expect(await accountBalance("GA", ACC.CASH_DIFF)).toBe(30_000n);
    expect(await accountBalance("GA", ACC.CASH)).toBe(10_350_000n);
    const ds = await db().dayStatus.get(`GA:${TODAY}`);
    expect(ds?.closed).toBe(true);
    expect((await dashboardData("GA", TODAY)).dayStatus?.closed).toBe(true);
    // Tomorrow's opening = counted cash.
    expect((await dashboardData("GA", addDays(TODAY, 1))).openingCashPaise).toBe(10_350_000n);
    // A second close of the same day is refused (owner too).
    await expectCode(
      closeDay("GA", { date: TODAY, countedCashPaise: 10_350_000n }),
      "DAY_ALREADY_CLOSED",
    );
    // Day close is per godown: B is still open.
    expect(await db().dayStatus.get(`GB:${TODAY}`)).toBeUndefined();
  });

  it("day lock enforcement for each role; owner unlock is audited and reopens the day", async () => {
    await closeDay("GA", { date: TODAY, countedCashPaise: 0n });

    await asRole("manager");
    await expectCode(saveSimple("GA", expenseDraft(100n)), "DAY_LOCKED");
    await expectCode(unlockDay("GA", TODAY, "recount"), "FORBIDDEN");
    await saveSimple("GB", expenseDraft(100n)); // the other godown's day is open

    await asRole("entry");
    await expectCode(saveSimple("GA", expenseDraft(100n)), "DAY_LOCKED");

    await asRole("viewer");
    await expectCode(saveSimple("GA", expenseDraft(100n)), "FORBIDDEN");

    await asRole("owner");
    const e = await saveSimple("GA", expenseDraft(100n)); // the owner may write a closed day
    expect(e.primary.status).toBe("active");
    await expectCode(unlockDay("GA", TODAY, " "), "NOTE_REQUIRED");
    await unlockDay("GA", TODAY, "recount");
    expect((await db().dayStatus.get(`GA:${TODAY}`))?.closed).toBe(false);
    expect(
      (await db().auditLocal.toArray()).some(
        (a) => a.action === "unlock" && a.reason === "recount",
      ),
    ).toBe(true);
    await expectCode(unlockDay("GA", TODAY, "again"), "DAY_NOT_CLOSED");

    await asRole("manager");
    await saveSimple("GA", expenseDraft(100n)); // open again
    // lockAfterDays (7): older days are locked for non-owners, open for the owner.
    const old = addDays(TODAY, -8);
    await expectCode(saveSimple("GA", expenseDraft(100n, old)), "DAY_LOCKED");
    await asRole("owner");
    await saveSimple("GA", expenseDraft(100n, old));
  });

  it("a day close can't be edited; voiding it (owner) reverses CASH_DIFF", async () => {
    const dc = await closeDay("GA", { date: TODAY, countedCashPaise: 5_000n, notes: "found" });
    expect(await accountBalance("GA", ACC.CASH_DIFF)).toBe(-5_000n);
    await expectCode(editVoucher("GA", dc._id, dc as unknown as VoucherDraft), "TYPE_IMMUTABLE");
    await voidVoucher("GA", dc._id, "wrong count");
    expect(await accountBalance("GA", ACC.CASH_DIFF)).toBe(0n);
    expect((await db().dayStatus.get(`GA:${TODAY}`))?.closed).toBe(false);
  });
});

describe("stock (§9.11)", () => {
  it("physical count → STOCK_ADJUST at average cost; summary and register", async () => {
    const swarna = A.variety.SWARNA!;
    await saveSimple("GA", {
      ...purchaseDraft(A.farmer, swarna, 10n * QTL, 200_000n),
      lines: [
        {
          varietyId: swarna,
          bags: 20,
          grossG: (10n * QTL).toString(),
          netG: (10n * QTL).toString(),
          ratePaisePerQtl: "200000",
          amountPaise: "0",
        },
      ],
    } as VoucherDraft);
    await saveSimple("GA", purchaseDraft(A.farmer, swarna, 10n * QTL, 220_000n));
    // 20 qtl worth ₹42,000 → avg ₹2,100/qtl. Count shows 50 kg less (drying).
    await saveSimple("GA", {
      type: "STOCK_ADJUST",
      date: TODAY,
      lines: [{ varietyId: swarna, qtyG: "-50000", reason: "DRYING" }],
    } as VoucherDraft);
    const s = await stockOf("GA", swarna);
    expect(s.qtyG).toBe(20n * QTL - 50_000n);
    expect(s.valuePaise).toBe(4_200_000n - 105_000n);
    expect(await accountBalance("GA", ACC.STOCK_ADJ)).toBe(105_000n);

    const [row] = await stockSummary("GA");
    expect(row!.varietyId).toBe(swarna);
    expect(row!.avgCostPerQtl).toBe(210_000n);
    expect(row!.bagsEstimate).toBe(39n); // 1,950 kg ÷ (1,000 kg / 20 bags) = 39

    const reg = await stockRegister("GA", swarna);
    expect(reg.map((r) => r.balanceQtyG)).toEqual([10n * QTL, 20n * QTL, 20n * QTL - 50_000n]);

    // Excess found (positive) comes in at the average cost too.
    await saveSimple("GA", {
      type: "STOCK_ADJUST",
      date: TODAY,
      lines: [{ varietyId: swarna, qtyG: "50000", reason: "COUNT" }],
    } as VoucherDraft);
    expect(await accountBalance("GA", ACC.STOCK_ADJ)).toBe(0n);
    await expectCode(
      saveSimple("GA", {
        type: "STOCK_ADJUST",
        date: TODAY,
        lines: [{ varietyId: swarna, qtyG: "0", reason: "COUNT" }],
      } as VoucherDraft),
      "VALIDATION_FAILED",
    );
  });
});

describe("inter-godown transfer (§1.4 rule 5)", () => {
  it("paddy: SALE in A + PURCHASE in B against godown parties, same group; voided together", async () => {
    await saveSimple("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, 10n * QTL, 200_000n));
    const t = await saveTransfer({
      kind: "PADDY",
      date: TODAY,
      fromGodownId: "GA",
      toGodownId: "GB",
      qtyG: 4n * QTL,
      ratePaisePerQtl: 200_000n,
      from: { varietyId: A.variety.SWARNA! },
      to: { varietyId: B.variety.SWARNA! },
    });
    expect(t.send.type).toBe("SALE");
    expect(t.receive?.type).toBe("PURCHASE");
    expect(t.send.groupId).toBe(t.groupId);
    expect(t.receive?.groupId).toBe(t.groupId);
    expect(t.send.godownId).toBe("GA");
    expect(t.receive?.godownId).toBe("GB");

    const pA = await db()
      .parties.where("godownId")
      .equals("GA")
      .filter((p) => p.roles.includes("godown"))
      .toArray();
    const pB = await db()
      .parties.where("godownId")
      .equals("GB")
      .filter((p) => p.roles.includes("godown"))
      .toArray();
    expect(pA.map((p) => p.linkedGodownId)).toEqual(["GB"]);
    expect(pB.map((p) => p.linkedGodownId)).toEqual(["GA"]);
    expect(await partyBalance("GA", pA[0]!._id)).toBe(800_000n); // B owes A
    expect(await partyBalance("GB", pB[0]!._id)).toBe(-800_000n); // B owes A
    expect((await stockOf("GA", A.variety.SWARNA!)).qtyG).toBe(6n * QTL);
    expect((await stockOf("GB", B.variety.SWARNA!)).qtyG).toBe(4n * QTL);
    // One outbox op per godown for the pair.
    const ops = await db().outbox.where("entityId").anyOf([t.send._id, t.receive!._id]).toArray();
    expect(ops.map((o) => o.godownId).sort()).toEqual(["GA", "GB"]);

    // A second transfer reuses the same godown parties.
    await saveTransfer({
      kind: "MONEY",
      date: TODAY,
      fromGodownId: "GB",
      toGodownId: "GA",
      amountPaise: 800_000n,
      from: { mode: "CASH" },
      to: { mode: "CASH" },
    });
    expect(await partyBalance("GA", pA[0]!._id)).toBe(0n);
    expect(await partyBalance("GB", pB[0]!._id)).toBe(0n);
    expect(
      await db()
        .parties.filter((p) => p.roles.includes("godown"))
        .count(),
    ).toBe(2);

    // Edit together.
    await saveTransfer(
      {
        kind: "PADDY",
        date: TODAY,
        fromGodownId: "GA",
        toGodownId: "GB",
        qtyG: 5n * QTL,
        ratePaisePerQtl: 200_000n,
        from: { varietyId: A.variety.SWARNA! },
        to: { varietyId: B.variety.SWARNA! },
      },
      { groupId: t.groupId },
    );
    expect((await stockOf("GB", B.variety.SWARNA!)).qtyG).toBe(5n * QTL);
    // Linked sides can't be changed on their own.
    await expectCode(voidVoucher("GB", t.receive!._id, "x"), "LINKED_READ_ONLY");

    // Void from the receiving side voids both books.
    const voided = await voidTransfer("GB", t.receive!._id, "wrong");
    expect(voided.map((v) => v.godownId).sort()).toEqual(["GA", "GB"]);
    expect((await stockOf("GA", A.variety.SWARNA!)).qtyG).toBe(10n * QTL);
    expect((await stockOf("GB", B.variety.SWARNA!)).qtyG).toBe(0n);
  });

  it("without access to the receiver only the SEND side is written; pending receipt is accepted there", async () => {
    // A manager of A only.
    const s = (await getMeta<SessionMeta>(META.session))!;
    await setMeta(META.session, {
      ...s,
      user: userDoc("U-MA", { isOwner: false, access: [{ godownId: "GA", role: "manager" }] }),
    });
    const t = await saveTransfer({
      kind: "MONEY",
      date: TODAY,
      fromGodownId: "GA",
      toGodownId: "GB",
      amountPaise: 300_000n,
      from: { mode: "CASH" },
      to: { mode: "CASH" },
    });
    expect(t.receive).toBeUndefined();
    expect("interGodown" in t.send && t.send.interGodown?.paired).toBe(false);

    // The server publishes the pending receipt to B; a B user accepts it.
    await db().transfers.put({
      _id: t.groupId,
      godownId: "GB",
      fromGodownId: "GA",
      fromGodownName: "RP",
      fromGodownCode: "RP",
      kind: "MONEY",
      date: TODAY,
      amountPaise: "300000",
      sendVoucherId: t.send._id,
      sendNumber: t.send.number,
      status: "pending",
      rev: 1,
      updatedAt: new Date().toISOString(),
    });
    await setMeta(META.session, {
      ...s,
      user: userDoc("U-MB", { isOwner: false, access: [{ godownId: "GB", role: "manager" }] }),
    });
    const r = await acceptTransfer("GB", t.groupId, { mode: "CASH" });
    expect(r.type).toBe("RECEIPT");
    expect(r.groupId).toBe(t.groupId);
    expect(await accountBalance("GB", ACC.CASH)).toBe(300_000n);
    expect((await db().transfers.get(t.groupId))?.status).toBe("accepted");
    await expectCode(acceptTransfer("GB", t.groupId, { mode: "CASH" }), "TRANSFER_NOT_PENDING");
    await expectCode(
      saveTransfer({
        kind: "MONEY",
        date: TODAY,
        fromGodownId: "GB",
        toGodownId: "GB",
        amountPaise: 1n,
        from: {},
        to: {},
      }),
      "TRANSFER_SAME_GODOWN",
    );
  });
});

describe("vehicles (§9.7)", () => {
  it("trip P&L, own-trade loads earn nothing, khata running net", async () => {
    const own = await upsertMaster("GA", "vehicle", { number: "WB11X1111", ownership: "own" });
    const trip = (over: Record<string, unknown>) =>
      saveSimple("GA", {
        type: "TRIP",
        date: TODAY,
        vehicleId: own._id,
        hirerPartyId: A.mill,
        loadingPlace: "Rampur",
        unloadingPlace: "Burdwan",
        qtyG: (100n * QTL).toString(),
        rateMode: "PER_QUINTAL",
        ratePaise: "5000",
        freightPaise: "0",
        advanceReceivedPaise: "100000",
        advanceMode: "CASH",
        expenses: [
          { kind: "DIESEL", amountPaise: "150000", litresMl: "16000", mode: "CASH" },
          { kind: "DRIVER", amountPaise: "50000", mode: "CASH" },
        ],
        duePaise: "0",
        odometerStartKm: 1000,
        odometerEndKm: 1100,
        ...over,
      } as VoucherDraft);
    await trip({});
    await trip({
      ownTradeLoadId: undefined,
      rateMode: "FIXED",
      ratePaise: "300000",
      qtyG: undefined,
    });
    await saveSimple("GA", {
      ...expenseDraft(20_000n),
      categoryCode: "OTHERS",
      vehicleId: own._id,
    } as VoucherDraft);
    const s = (await vehicleSummary("GA", own._id, { from: TODAY, to: TODAY }))!;
    expect(s.pnl.tripCount).toBe(2);
    expect(s.pnl.freightPaise).toBe(500_000n + 300_000n);
    expect(s.pnl.expensesByKind.DIESEL).toBe(300_000n);
    expect(s.pnl.otherExpensesPaise).toBe(20_000n);
    expect(s.pnl.totalExpensesPaise).toBe(420_000n);
    expect(s.pnl.netProfitPaise).toBe(380_000n);
    expect(s.pnl.dueFromHirersPaise).toBe(400_000n + 200_000n);
    expect(s.pnl.dieselMl).toBe(32_000n);
    expect(s.pnl.km).toBe(200n);
    expect(s.pnl.perKmPaise).toBe(2_000n);
    const khata = await vehicleKhata("GA", own._id);
    expect(khata.at(-1)!.netPaise).toBe(380_000n);
    // Dashboard counts own-vehicle expenses in today's expenses.
    expect((await dashboardData("GA", TODAY)).expenseByCategory.get("VEHICLE")).toBe(400_000n);
  });
});

describe("dashboard + consolidated (§9.1, §1.4 rule 4)", () => {
  it("cards come from dailyAgg/ledger; consolidated totals == Σ per-godown", async () => {
    await cashOpening("GA", 50_000n);
    await cashOpening("GB", 20_000n);
    await saveSimple("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, 10n * QTL, 200_000n));
    await saveSimple("GA", saleDraft(A.mill, A.variety.SWARNA!, 4n * QTL, 250_000n));
    await saveSimple("GB", purchaseDraft(B.farmer, B.variety.SWARNA!, 3n * QTL, 210_000n));
    await saveSimple("GB", expenseDraft(50_000n));
    await createVoucher("GA", {
      type: "PAYMENT",
      date: TODAY,
      partyId: A.farmer,
      amountPaise: "500000",
      mode: "CASH",
      purpose: "ADVANCE",
      dueDate: TODAY,
    } as VoucherDraft);
    const a = await dashboardData("GA", TODAY);
    expect(a.purchaseQtyG).toBe(10n * QTL);
    expect(a.purchaseAmountPaise).toBe(2_000_000n);
    expect(a.saleQtyG).toBe(4n * QTL);
    expect(a.saleAmountPaise).toBe(1_000_000n);
    expect(a.stockQtyG).toBe(6n * QTL);
    expect(a.stockByVariety).toHaveLength(1);
    expect(a.receivablePaise).toBe(1_000_000n);
    expect(a.payablePaise).toBe(1_500_000n);
    expect(a.openingCashPaise).toBe(5_000_000n);
    expect(a.expectedClosingCashPaise).toBe(4_500_000n);
    // Profit: sales 10,000 − COGS 8,000.
    expect(a.profitPaise).toBe(200_000n);

    const ids = ["GA", "GB"];
    const total = await allGodownsTotals(ids);
    const parts = await Promise.all(ids.map((g) => godownTotals(g)));
    for (const k of ["cashPaise", "receivablePaise", "payablePaise", "stockQtyG"] as const) {
      expect(total.total[k]).toBe(parts.reduce((s, p) => s + p[k], 0n));
    }
    const cd = await consolidatedDashboard(ids, TODAY);
    expect(cd.columns.map((c) => c.godownId)).toEqual(ids);
    expect(cd.total.cashPaise).toBe(4_500_000n + 2_000_000n - 50_000n);
    expect(cd.total.purchaseQtyG).toBe(13n * QTL);
    expect(cd.total.expensePaise).toBe(50_000n);
    for (const k of ["saleAmountPaise", "receivablePaise", "payablePaise", "stockQtyG"] as const) {
      expect(cd.total[k]).toBe(cd.columns.reduce((s, c) => s + c[k], 0n));
    }
  });

  it("search finds parties, vehicles, voucher numbers and amounts in either script", async () => {
    const p = await saveSimple(
      "GA",
      purchaseDraft(A.farmer, A.variety.SWARNA!, 13034n * 100n, 200_000n),
    );
    const total = BigInt((p.primary as Voucher & { totalPaise: string }).totalPaise);
    expect(total).toBe(2_606_800n);
    expect(amountQuery("২৬০৬৮")).toBe(2_606_800n);
    expect(amountQuery("26,068")).toBe(2_606_800n);
    expect(amountQuery("abc")).toBeNull();
    const byAmount = await searchGodown("GA", "২৬০৬৮");
    expect(byAmount.vouchers.map((h) => h.voucher._id)).toEqual([p.primary._id]);
    const byNumber = await searchGodown("GA", p.primary.number.slice(-6));
    expect(byNumber.vouchers.some((h) => h.voucher._id === p.primary._id)).toBe(true);
    expect((await searchGodown("GA", "ramesh")).parties.map((x) => x.party._id)).toEqual([
      A.farmer,
    ]);
    expect((await searchGodown("GB", "26068")).vouchers).toEqual([]); // other godown: nothing
    await upsertMaster("GA", "vehicle", { number: "wb 12 ab 3456", ownership: "external" });
    expect((await searchGodown("GA", "ab34")).vehicles).toHaveLength(1);
    const all = await searchAllGodowns(["GA", "GB"], "Ramesh");
    expect(all.map((g) => g.godownId)).toEqual(["GA", "GB"]);
  });
});

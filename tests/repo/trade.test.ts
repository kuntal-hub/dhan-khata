/**
 * Phase 3 trade-flow integration tests (local write path): loads, linked groups, bill
 * allocation, mill settlement, reminders, and a hand-computed end-to-end flow.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { partyBills, partyStatement } from "@/client/queries/parties";
import { accountBalance, godownTrialBalance, partyBalance } from "@/client/queries/ledger";
import { stockOf } from "@/client/queries/stock";
import {
  RepoError,
  editVoucher,
  newId,
  saveLoad,
  saveMillSettlement,
  saveMoney,
  savePurchase,
  saveSale,
  voidVoucher,
  type VoucherDraft,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import { ACC } from "@/domain/posting/accounts";
import type { Voucher } from "@/domain/schemas";
import {
  TODAY,
  paymentDraft,
  purchaseDraft,
  saleDraft,
  setupDevice,
  type LocalGodown,
} from "../helpers/local";

const QTL = 100_000n;
let A: LocalGodown;

beforeEach(async () => {
  const w = await setupDevice("trade-test", { godowns: [{ id: "GA", code: "RP" }] });
  A = w.GA!;
});

async function active(type: string): Promise<Voucher[]> {
  return db()
    .vouchers.filter((v) => v.type === type && v.status === "active")
    .toArray();
}

function loadDraft(over: Partial<Record<string, unknown>> = {}): VoucherDraft {
  return {
    type: "LOAD",
    mode: "OWN_TRADE",
    date: TODAY,
    fromPartyId: A.farmer,
    toMillPartyId: A.mill,
    vehicleNumber: "WB12AB3456",
    varietyId: A.variety.SWARNA!,
    grossG: (20n * QTL).toString(),
    netG: (20n * QTL).toString(),
    partySellRatePaisePerQtl: "210000",
    millRatePaisePerQtl: "230000",
    totalAmountPaise: "0",
    ...over,
  } as VoucherDraft;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof RepoError && e.code === code);
}

describe("load khata", () => {
  it("OWN_TRADE load creates exactly one SALE + a TRANSIT purchase in one group", async () => {
    const { primary, linked } = await saveLoad("GA", loadDraft());
    expect(linked.map((v) => v.type).sort()).toEqual(["PURCHASE", "SALE"]);
    expect(new Set([primary, ...linked].map((v) => v.groupId)).size).toBe(1);
    const sales = await active("SALE");
    expect(sales).toHaveLength(1);
    const sale = sales[0]!;
    expect(sale.type === "SALE" && sale.totalPaise).toBe("4600000");
    expect(sale.type === "SALE" && sale.source).toBe("TRANSIT");
    expect(await partyBalance("GA", A.farmer)).toBe(-4200000n);
    expect(await partyBalance("GA", A.mill)).toBe(4600000n);
    // TRANSIT in and out: no store stock, specific cost → COGS = purchase amount.
    expect(await stockOf("GA", A.variety.SWARNA!, "STORE")).toEqual({ qtyG: 0n, valuePaise: 0n });
    expect(await accountBalance("GA", ACC.COGS)).toBe(4200000n);
    expect((await godownTrialBalance("GA")).balanced).toBe(true);
  });

  it("editing the load updates its linked vouchers (still exactly one sale)", async () => {
    const { primary } = await saveLoad("GA", loadDraft());
    await saveLoad(
      "GA",
      loadDraft({ netG: (19n * QTL).toString(), millRatePaisePerQtl: "240000" }),
      { id: primary._id },
    );
    const sales = await active("SALE");
    expect(sales).toHaveLength(1);
    expect(sales[0]!.type === "SALE" && sales[0]!.totalPaise).toBe("4560000");
    expect(sales[0]!.rev).toBe(2);
    expect(await partyBalance("GA", A.farmer)).toBe(-(19n * 210000n));
    // From the godown's own stock: the purchase is voided, the sale comes from STORE.
    await savePurchase("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, 30n * QTL, 200000n));
    await saveLoad(
      "GA",
      loadDraft({ fromStore: true, fromPartyId: undefined, partySellRatePaisePerQtl: undefined }),
      { id: primary._id },
    );
    const purchases = (
      await db()
        .vouchers.filter((v) => v.type === "PURCHASE")
        .toArray()
    ).filter((v) => v.groupId === primary.groupId);
    expect(purchases.every((p) => p.status === "void")).toBe(true);
    const sale = (await active("SALE"))[0]!;
    expect(sale.type === "SALE" && sale.source).toBe("STORE");
    expect(await active("SALE")).toHaveLength(1);
  });

  it("linked vouchers are read-only; voiding the load voids the group", async () => {
    const { primary, linked } = await saveLoad("GA", loadDraft());
    const sale = linked.find((v) => v.type === "SALE")!;
    await expectCode(
      editVoucher("GA", sale._id, saleDraft(A.mill, A.variety.SWARNA!, QTL, 1n)),
      "LINKED_READ_ONLY",
    );
    await expectCode(voidVoucher("GA", sale._id, "x"), "LINKED_READ_ONLY");
    await voidVoucher("GA", primary._id, "wrong truck");
    expect(await active("SALE")).toHaveLength(0);
    expect(await active("PURCHASE")).toHaveLength(0);
    expect(await partyBalance("GA", A.mill)).toBe(0n);
  });

  it("AGENT mode books commission only", async () => {
    await saveLoad(
      "GA",
      loadDraft({
        mode: "AGENT",
        commission: { ratePaisePerQtl: "1000", amountPaise: "0", payer: "MILL" },
        partySellRatePaisePerQtl: undefined,
        millRatePaisePerQtl: undefined,
      }),
    );
    expect(await active("SALE")).toHaveLength(0);
    expect(await accountBalance("GA", ACC.COMMISSION_INCOME)).toBe(-20000n);
    expect(await partyBalance("GA", A.mill)).toBe(20000n);
  });
});

describe("purchase with paid-now", () => {
  it("is atomic: an invalid linked payment writes nothing", async () => {
    const d = {
      ...purchaseDraft(A.farmer, A.variety.SWARNA!, 10n * QTL, 200000n),
      paidNow: { amountPaise: "500000", mode: "UPI" },
    } as VoucherDraft;
    await expectCode(savePurchase("GA", d), "BANK_ACCOUNT_REQUIRED");
    expect(await db().vouchers.count()).toBe(0);
    expect(await db().outbox.count()).toBe(0);
  });

  it("creates PURCHASE + PAYMENT in one group; removing paid-now voids the payment", async () => {
    const d = {
      ...purchaseDraft(A.farmer, A.variety.SWARNA!, 10n * QTL, 200000n),
      paidNow: { amountPaise: "500000", mode: "CASH" },
      dueDate: addDays(TODAY, 7),
    } as VoucherDraft;
    const { primary, linked } = await savePurchase("GA", d);
    expect(linked).toHaveLength(1);
    expect(linked[0]!.type).toBe("PAYMENT");
    expect(linked[0]!.groupId).toBe(primary.groupId);
    expect(await partyBalance("GA", A.farmer)).toBe(-1500000n);
    expect(await accountBalance("GA", ACC.CASH)).toBe(-500000n);
    const rem = await db().reminders.toArray();
    expect(rem).toHaveLength(1);
    expect(rem[0]).toMatchObject({
      kind: "PAY_DUE",
      status: "open",
      amountPaise: "1500000",
      dueDate: addDays(TODAY, 7),
    });
    expect((await db().outbox.toArray()).some((o) => o.entity === "reminder")).toBe(true);

    const noPay = {
      ...purchaseDraft(A.farmer, A.variety.SWARNA!, 10n * QTL, 200000n),
    } as VoucherDraft;
    await savePurchase("GA", noPay, { id: primary._id });
    expect((await db().vouchers.get(linked[0]!._id))?.status).toBe("void");
    expect(await partyBalance("GA", A.farmer)).toBe(-2000000n);
    expect((await db().reminders.toArray())[0]!.status).toBe("done");
  });
});

describe("bill allocation (FIFO / manual)", () => {
  it("payments settle the oldest bills first; manual picks are honoured", async () => {
    const p1 = (
      await savePurchase(
        "GA",
        purchaseDraft(A.farmer, A.variety.SWARNA!, 5n * QTL, 200000n, addDays(TODAY, -3)),
      )
    ).primary;
    const p2 = (
      await savePurchase(
        "GA",
        purchaseDraft(A.farmer, A.variety.SWARNA!, 5n * QTL, 200000n, addDays(TODAY, -2)),
      )
    ).primary;
    const p3 = (
      await savePurchase(
        "GA",
        purchaseDraft(A.farmer, A.variety.SWARNA!, 5n * QTL, 200000n, addDays(TODAY, -1)),
      )
    ).primary;
    await saveMoney("GA", paymentDraft(A.farmer, 1500000n));
    let bills = await partyBills("GA", A.farmer);
    const status = (id: string) => bills.purchases.find((b) => b.voucherId === id)?.status;
    expect([status(p1._id), status(p2._id), status(p3._id)]).toEqual([
      "SETTLED",
      "PARTIAL",
      "OPEN",
    ]);
    // Manual: a payment explicitly for bill 3.
    await saveMoney("GA", {
      ...paymentDraft(A.farmer, 300000n),
      allocations: [{ voucherId: p3._id, amountPaise: "300000" }],
    } as VoucherDraft);
    bills = await partyBills("GA", A.farmer);
    expect(bills.purchases.find((b) => b.voucherId === p3._id)?.paidPaise).toBe(300000n);
    expect(bills.advanceGivenPaise).toBe(0n);
    // Overpayment becomes an advance.
    await saveMoney("GA", paymentDraft(A.farmer, 2000000n));
    bills = await partyBills("GA", A.farmer);
    expect(bills.purchases.every((b) => b.status === "SETTLED")).toBe(true);
    // Bills 3 × ₹10,000 = ₹30,000; payments ₹15,000 + ₹3,000 + ₹20,000 = ₹38,000 → ₹8,000 advance.
    expect(bills.advanceGivenPaise).toBe(800000n);
  });
});

describe("sale linked vouchers and settlement", () => {
  it("advance receipt, vehicle advance and loading expense are linked; removing them voids", async () => {
    await savePurchase("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, 20n * QTL, 200000n));
    const transporter = newId();
    await db().parties.put({
      ...(await db().parties.get(A.farmer))!,
      _id: transporter,
      name: "Truck owner",
      searchKey: "truck",
      roles: ["transporter"],
    });
    const d = {
      ...saleDraft(A.mill, A.variety.SWARNA!, 10n * QTL, 250000n),
      advanceReceived: { amountPaise: "500000", mode: "CASH" },
      vehicleAdvance: { amountPaise: "100000", mode: "CASH" },
      loading: { ratePaisePerQtl: "1500", amountPaise: "0", payTo: "CASH_NOW" },
      delivery: {
        ratePaisePerQtl: "5000",
        amountPaise: "0",
        payer: "US",
        transporterPartyId: transporter,
      },
    } as VoucherDraft;
    const { primary, linked } = await saveSale("GA", d);
    expect(linked.map((v) => v.type).sort()).toEqual(["EXPENSE", "PAYMENT", "RECEIPT"]);
    expect(await partyBalance("GA", A.mill)).toBe(2500000n - 500000n);
    expect(await partyBalance("GA", transporter)).toBe(-50000n + 100000n);
    expect(await accountBalance("GA", ACC.CASH)).toBe(500000n - 100000n - 15000n);
    await saveSale("GA", saleDraft(A.mill, A.variety.SWARNA!, 10n * QTL, 250000n), {
      id: primary._id,
    });
    expect(
      (await db().vouchers.bulkGet(linked.map((l) => l._id))).every((v) => v?.status === "void"),
    ).toBe(true);
    expect(await accountBalance("GA", ACC.CASH)).toBe(0n);
  });

  it("mill settlement posts the difference, shows shortage and settles the sale", async () => {
    await savePurchase("GA", purchaseDraft(A.farmer, A.variety.SWARNA!, 20n * QTL, 200000n));
    const sale = (await saveSale("GA", saleDraft(A.mill, A.variety.SWARNA!, 10n * QTL, 230000n)))
      .primary;
    const st = await saveMillSettlement("GA", sale._id, {
      type: "MILL_SETTLEMENT",
      date: TODAY,
      saleId: sale._id,
      partyId: A.mill,
      dispatchedNetG: "1",
      saleTotalPaise: "0",
      millReceivedGrossG: (995n * 1000n).toString(),
      millDeductions: [{ label: "moisture", bps: 100 }],
      millNetG: "1",
      finalRatePaisePerQtl: "230000",
      finalAmountPaise: "0",
      differencePaise: "0",
      shortageG: "0",
    } as VoucherDraft);
    // 995 kg − 1 % = 985.05 kg; × ₹2,300/qtl = ₹22,656.15; sale ₹23,000 → −₹343.85; shortage 14.95 kg.
    expect(st.type === "MILL_SETTLEMENT" && st.millNetG).toBe("985050");
    expect(st.type === "MILL_SETTLEMENT" && st.differencePaise).toBe("-34385");
    expect(st.type === "MILL_SETTLEMENT" && st.shortageG).toBe("14950");
    expect(
      (await db().vouchers.get(sale._id))?.type === "SALE" &&
        ((await db().vouchers.get(sale._id)) as { settlementStatus: string }).settlementStatus,
    ).toBe("SETTLED");
    expect(await partyBalance("GA", A.mill)).toBe(2300000n - 34385n);
    expect(await accountBalance("GA", ACC.SALES_DEDUCTION)).toBe(34385n);
    // Voiding the settlement puts the sale back to PENDING.
    await voidVoucher("GA", st._id, "wrong weight");
    const s2 = (await db().vouchers.get(sale._id)) as { settlementStatus: string };
    expect(s2.settlementStatus).toBe("PENDING");
    expect(await partyBalance("GA", A.mill)).toBe(2300000n);
  });
});

describe("trade flow (hand-computed, same as the e2e)", () => {
  it("purchase + paid-now → payment → load → store sale → cash receipt via driver → settlement", async () => {
    const sw = A.variety.SWARNA!;
    const f2 = newId();
    await db().parties.put({
      ...(await db().parties.get(A.farmer))!,
      _id: f2,
      name: "Second farmer",
      searchKey: "second",
      roles: ["farmer"],
    });
    // 1. Purchase 10 qtl @ ₹2,000 = ₹20,000, paid ₹5,000 cash now.
    await savePurchase("GA", {
      ...purchaseDraft(A.farmer, sw, 10n * QTL, 200000n),
      paidNow: { amountPaise: "500000", mode: "CASH" },
    } as VoucherDraft);
    // 2. Payment ₹3,000 cash.
    await saveMoney("GA", paymentDraft(A.farmer, 300000n));
    // 3. Load: F2 → mill, 20 qtl, sell ₹2,100, mill ₹2,300.
    const load = await saveLoad("GA", loadDraft({ fromPartyId: f2 }));
    const loadSale = load.linked.find((v) => v.type === "SALE")!;
    // 4. Store sale 5 qtl @ ₹2,400 = ₹12,000.
    await saveSale("GA", saleDraft(A.mill, sw, 5n * QTL, 240000n));
    // 5. Mill sends ₹40,000 cash with the driver.
    await saveMoney("GA", {
      type: "RECEIPT",
      date: TODAY,
      partyId: A.mill,
      amountPaise: "4000000",
      mode: "CASH",
      cashVia: { vehicleNumber: "WB12AB3456" },
      purpose: "BILL",
    } as VoucherDraft);
    // 6. Mill received 19.9 qtl of the load at ₹2,300 → ₹45,770 (−₹230), shortage 10 kg.
    const st = await saveMillSettlement("GA", loadSale._id, {
      type: "MILL_SETTLEMENT",
      date: TODAY,
      saleId: loadSale._id,
      partyId: A.mill,
      dispatchedNetG: "1",
      saleTotalPaise: "0",
      millReceivedGrossG: (1990n * 1000n).toString(),
      millDeductions: [],
      millNetG: "1",
      finalRatePaisePerQtl: "230000",
      finalAmountPaise: "0",
      differencePaise: "0",
      shortageG: "0",
    } as VoucherDraft);
    expect(await partyBalance("GA", A.farmer)).toBe(-1200000n);
    expect(await partyBalance("GA", f2)).toBe(-4200000n);
    expect(await partyBalance("GA", A.mill)).toBe(1777000n);
    expect(await accountBalance("GA", ACC.CASH)).toBe(3200000n);
    expect(st.type === "MILL_SETTLEMENT" && st.shortageG).toBe("10000");
    expect(await stockOf("GA", sw, "STORE")).toEqual({ qtyG: 5n * QTL, valuePaise: 1000000n });
    expect((await godownTrialBalance("GA")).balanced).toBe(true);
    const stmt = await partyStatement("GA", A.mill);
    expect(stmt.closingPaise).toBe(1777000n);
  });
});

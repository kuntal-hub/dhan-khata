/**
 * The Rampur Godown story: ~30 days of an Aman-season paddy broker's business, plus the
 * inter-godown transfers with Sonapur. Everything goes through the app's own repo functions.
 */
import { partyBalance } from "@/client/queries/ledger";
import {
  acceptTransfer,
  closeDay,
  createManualReminder,
  saveLoad,
  saveMillSettlement,
  saveMoney,
  savePurchase,
  saveSale,
  saveSimple,
  saveTransfer,
  setReminderState,
  updateGodownSettings,
  type VoucherDraft,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Voucher } from "@/domain/schemas";
import type { DemoDevice } from "./harness";
import {
  R,
  cashBalance,
  contraDraft,
  day,
  expenseDraft,
  kg,
  moneyDraft,
  purchaseDraft,
  rate,
  saleDraft,
  storeStock,
  tl,
  type Pay,
} from "./helpers";
import type { Book } from "./masters";
import type { Timeline } from "./timeline";

export interface Devices {
  own: DemoDevice;
  mgr: DemoDevice;
  ent: DemoDevice;
  snm: DemoDevice;
}

type Who = "o" | "m" | "e";
type PayCode = "C" | "U" | "B";

export function rampurStory(
  t: Timeline,
  b: Book,
  sn: Book,
  dev: Devices,
  log: (s: string) => void,
) {
  const gid = b.gid;
  const P = (k: string) => b.party[k]!;
  const V = (k: string) => b.variety[k]!;
  const who = (w: Who) => (w === "o" ? dev.own : w === "m" ? dev.mgr : dev.ent);
  const sales: Record<string, Voucher> = {};
  const receipts: Record<string, Voucher> = {};
  const loads: Record<string, Voucher> = {};

  const pay = (code: PayCode, rs?: number): Pay => ({
    ...(rs !== undefined ? { amountRs: rs } : {}),
    mode: code === "C" ? "CASH" : code === "U" ? "UPI" : "BANK_TRANSFER",
    ...(code === "U" ? { bankId: b.bank.uco! } : code === "B" ? { bankId: b.bank.sbi! } : {}),
  });

  /** Amount (whole rupees, in paise) = `pct`% of an outstanding balance. */
  const part = (bal: bigint, pct: number): bigint => ((bal * BigInt(pct)) / 100n / 100n) * 100n;

  // ── Go-live: settings + opening balances (owner) ───────────────────────────
  t.add(30, dev.own, "settings", async () => {
    await updateGodownSettings(gid, {
      defaults: {
        deductions: { tarePerBagG: "500", dhaltaMode: "PER_QUINTAL", dhaltaValueG: "1000" },
      },
    });
  });
  t.add(30, dev.own, "opening balances", async () => {
    const stock = (k: string, qtl: number, rsPerQtl: number) => ({
      kind: "STOCK" as const,
      varietyId: V(k),
      qtyG: kg(qtl * 100),
      amountPaise: R(qtl * rsPerQtl),
    });
    await saveSimple(gid, {
      type: "OPENING",
      date: day(30),
      notes: "গো-লাইভ ব্যালেন্স",
      items: [
        { kind: "CASH", amountPaise: R(150_000) },
        { kind: "BANK", refId: b.bank.sbi!, amountPaise: R(320_000) },
        { kind: "BANK", refId: b.bank.uco!, amountPaise: R(85_000) },
        stock("SWARNA", 150, 2200),
        stock("MINIKIT", 100, 2250),
        stock("LAL_SWARNA", 80, 2150),
        { kind: "PARTY", refId: P("f2"), amountPaise: R(-18_500) },
        { kind: "PARTY", refId: P("f4"), amountPaise: R(-42_000) },
        { kind: "PARTY", refId: P("m1"), amountPaise: R(65_000) },
        { kind: "PARTY", refId: P("t1"), amountPaise: R(30_000) },
      ],
    } as VoucherDraft);
  });

  // ── Purchases from farmers ─────────────────────────────────────────────────
  // [daysAgo, by, farmer, variety, grossKg, ₹/qtl, bags, moistBps, paid, mode, dueInDays]
  type PRow = [
    number,
    Who,
    string,
    string,
    number,
    number,
    number,
    number,
    number,
    PayCode,
    number,
  ];
  const purchases: PRow[] = [
    [28, "o", "f1", "SWARNA", 4200, 2280, 84, 0, 20_000, "C", 10],
    [28, "o", "f2", "MINIKIT", 3600, 2350, 72, 100, 30_000, "C", 7],
    [27, "o", "f3", "LAL_SWARNA", 5100, 2210, 102, 150, 0, "C", 15],
    [26, "m", "f4", "SWARNA", 6000, 2290, 120, 0, 50_000, "U", 5],
    [25, "o", "f5", "GOBINDOBHOG", 1800, 4650, 36, 0, 40_000, "B", 12],
    [24, "o", "f6", "SWARNA", 4500, 2190, 90, 200, 25_000, "C", 8],
    [22, "o", "f1", "SWARNA", 5500, 2300, 110, 0, 60_000, "C", 6],
    [21, "e", "f2", "MINIKIT", 4800, 2360, 96, 0, 0, "C", 14],
    [20, "o", "f3", "SWARNA", 3900, 2295, 78, 100, 20_000, "C", 9],
    [19, "o", "f4", "LAL_SWARNA", 6200, 2215, 124, 0, 70_000, "B", 10],
    [17, "m", "f5", "SATABDI", 3000, 2320, 60, 0, 30_000, "C", 7],
    [16, "o", "f6", "MINIKIT", 5200, 2370, 104, 0, 40_000, "C", 12],
    [15, "o", "f1", "SWARNA", 7000, 2310, 140, 0, 100_000, "B", 5],
    [14, "e", "f7", "SWARNA", 3400, 2300, 68, 150, 15_000, "C", 8],
    [12, "o", "f2", "SWARNA", 4600, 2315, 92, 0, 0, "C", 10],
    [11, "o", "f3", "LAL_SWARNA", 4000, 2220, 80, 0, 25_000, "U", 6],
    [10, "m", "f4", "MINIKIT", 5800, 2380, 116, 0, 90_000, "B", 4],
    [8, "o", "f5", "SWARNA", 6400, 2320, 128, 0, 60_000, "C", 7],
    [7, "o", "f6", "LAL_SWARNA", 4200, 2225, 84, 100, 20_000, "C", 5],
    [5, "o", "f1", "MINIKIT", 5000, 2390, 100, 0, 50_000, "C", 6],
    [4, "e", "f7", "SWARNA", 3800, 2325, 76, 0, 30_000, "C", 4],
    [3, "o", "f8", "SWARNA", 5400, 2330, 108, 200, 40_000, "B", 3],
    [2, "o", "f2", "LAL_SWARNA", 3600, 2230, 72, 0, 0, "C", 3],
    [1, "m", "f4", "SWARNA", 4400, 2335, 88, 0, 35_000, "C", 2],
    [0, "o", "f1", "MINIKIT", 3000, 2395, 60, 0, 25_000, "C", 2],
  ];
  for (const [back, w, f, v, gKg, rs, bags, moist, paid, code, due] of purchases) {
    t.add(back, who(w), `purchase ${f} ${v}`, async () => {
      const date = day(back);
      await savePurchase(
        gid,
        purchaseDraft({
          date,
          partyId: P(f),
          lines: [tl(V(v), gKg, rs, { bags, tareG: 500, dhaltaG: 1000, moistBps: moist })],
          ...(paid > 0 ? { paid: pay(code, paid) } : {}),
          dueDate: addDays(date, due),
          ...(bags >= 120
            ? {
                charges: [
                  { label: "হামালি (বোঝাই খরচ)", kind: "deduct" as const, amountRs: bags * 2 },
                ],
              }
            : {}),
        }),
      );
    });
  }

  // ── Sales to mills / traders ───────────────────────────────────────────────
  const capKg = async (varietyId: string, planned: number): Promise<bigint> => {
    const spare = (await storeStock(gid, varietyId)) / 1000n - 200n;
    const want = BigInt(planned);
    return want <= spare ? want : (spare / 100n) * 100n;
  };

  interface SaleSpec {
    id: string;
    back: number;
    by: Who;
    buyer: string;
    variety: string;
    kg: number;
    rs: number;
    vehicle: "own1" | "own2" | "ext1";
    loading?: { rs: number; labour?: boolean };
    delivery?: { rsPerQtl?: number; fixedRs?: number; payer: "US" | "MILL" | "BUYER" };
    vehicleAdvanceRs?: number;
    advance?: { rs: number; code: PayCode };
    expectInDays: number;
  }
  const saleSpecs: SaleSpec[] = [
    {
      id: "S1",
      back: 26,
      by: "o",
      buyer: "t1",
      variety: "SWARNA",
      kg: 14_000,
      rs: 2345,
      vehicle: "own1",
      loading: { rs: 10 },
      advance: { rs: 100_000, code: "U" },
      expectInDays: 8,
    },
    {
      id: "S2",
      back: 23,
      by: "o",
      buyer: "m1",
      variety: "MINIKIT",
      kg: 16_000,
      rs: 2410,
      vehicle: "ext1",
      loading: { rs: 12, labour: true },
      delivery: { rsPerQtl: 35, payer: "US" },
      vehicleAdvanceRs: 5000,
      advance: { rs: 150_000, code: "B" },
      expectInDays: 7,
    },
    {
      id: "S3",
      back: 20,
      by: "o",
      buyer: "m2",
      variety: "LAL_SWARNA",
      kg: 15_000,
      rs: 2285,
      vehicle: "ext1",
      loading: { rs: 10 },
      delivery: { fixedRs: 6000, payer: "MILL" },
      expectInDays: 10,
    },
    {
      id: "S4",
      back: 17,
      by: "m",
      buyer: "m3",
      variety: "SWARNA",
      kg: 18_000,
      rs: 2370,
      vehicle: "own1",
      loading: { rs: 12, labour: true },
      expectInDays: 6,
    },
    {
      id: "S5",
      back: 13,
      by: "o",
      buyer: "m1",
      variety: "MINIKIT",
      kg: 14_000,
      rs: 2440,
      vehicle: "ext1",
      loading: { rs: 10 },
      delivery: { rsPerQtl: 30, payer: "US" },
      vehicleAdvanceRs: 4000,
      advance: { rs: 100_000, code: "B" },
      expectInDays: 7,
    },
    {
      id: "S6",
      back: 9,
      by: "o",
      buyer: "t2",
      variety: "SWARNA",
      kg: 17_000,
      rs: 2395,
      vehicle: "own1",
      advance: { rs: 50_000, code: "C" },
      expectInDays: 5,
    },
    {
      id: "S7",
      back: 6,
      by: "o",
      buyer: "m2",
      variety: "LAL_SWARNA",
      kg: 12_000,
      rs: 2300,
      vehicle: "ext1",
      delivery: { payer: "BUYER" },
      expectInDays: 8,
    },
    {
      id: "S8",
      back: 4,
      by: "o",
      buyer: "m3",
      variety: "SWARNA",
      kg: 15_000,
      rs: 2410,
      vehicle: "own1",
      loading: { rs: 12, labour: true },
      expectInDays: 5,
    },
    {
      id: "S9",
      back: 2,
      by: "o",
      buyer: "t1",
      variety: "MINIKIT",
      kg: 10_000,
      rs: 2455,
      vehicle: "own1",
      advance: { rs: 100_000, code: "U" },
      expectInDays: 3,
    },
    {
      id: "S10",
      back: 0,
      by: "o",
      buyer: "m1",
      variety: "SWARNA",
      kg: 12_000,
      rs: 2425,
      vehicle: "own1",
      loading: { rs: 10 },
      expectInDays: 7,
    },
  ];
  const vehNo = { own1: "WB44A1234", own2: "WB44B5678", ext1: "WB52C9012" } as const;
  for (const s of saleSpecs) {
    t.add(s.back, who(s.by), `sale ${s.id}`, async () => {
      const date = day(s.back);
      const useKg = await capKg(V(s.variety), s.kg);
      if (useKg < 1000n) {
        log(`    (skipped ${s.id}: not enough stock)`);
        return;
      }
      const saved = await saveSale(
        gid,
        saleDraft({
          date,
          partyId: P(s.buyer),
          vehicleNumber: vehNo[s.vehicle],
          vehicleId: b.vehicle[s.vehicle]!,
          lines: [tl(V(s.variety), useKg, s.rs, { bags: Number(useKg / 50n) })],
          ...(s.loading
            ? {
                loading: {
                  ratePerQtlRs: s.loading.rs,
                  payTo: s.loading.labour ? ("LABOUR_PARTY" as const) : ("CASH_NOW" as const),
                  ...(s.loading.labour ? { labourPartyId: P("l1") } : {}),
                },
              }
            : {}),
          ...(s.delivery
            ? {
                delivery: {
                  ...(s.delivery.rsPerQtl !== undefined
                    ? { ratePerQtlRs: s.delivery.rsPerQtl }
                    : {}),
                  ...(s.delivery.fixedRs !== undefined ? { fixedRs: s.delivery.fixedRs } : {}),
                  payer: s.delivery.payer,
                  ...(s.delivery.payer === "US" ? { transporterPartyId: P("tr1") } : {}),
                },
              }
            : {}),
          ...(s.vehicleAdvanceRs ? { vehicleAdvance: pay("C", s.vehicleAdvanceRs) } : {}),
          ...(s.advance ? { advance: pay(s.advance.code, s.advance.rs) } : {}),
          expectedPaymentDate: addDays(date, s.expectInDays),
        }),
      );
      sales[s.id] = saved.primary;
    });
  }

  // ── Mill settlements (the mill's own weighment & cuts) ─────────────────────
  const settle = (back: number, id: string, shortKg: number, moistBps: number, cutRs: number) =>
    t.add(back, dev.own, `mill settlement ${id}`, async () => {
      const s = sales[id];
      if (!s || s.type !== "SALE") return;
      const line = s.lines[0]!;
      const net = BigInt(line.netG);
      await saveMillSettlement(gid, s._id, {
        type: "MILL_SETTLEMENT",
        date: day(back),
        partyId: s.partyId,
        saleId: s._id,
        dispatchedNetG: net.toString(),
        saleTotalPaise: s.totalPaise,
        millReceivedGrossG: (net - BigInt(shortKg) * 1000n).toString(),
        millDeductions: [
          { label: "আর্দ্রতা কর্তন", bps: moistBps },
          { label: "নমুনা / কাঁটা", g: "20000" },
        ],
        millNetG: "1",
        finalRatePaisePerQtl: (BigInt(line.ratePaisePerQtl) - BigInt(cutRs) * 100n).toString(),
        finalAmountPaise: "0",
        differencePaise: "0",
        shortageG: "0",
      } as VoucherDraft);
    });
  settle(16, "S2", 60, 50, 15);
  settle(11, "S3", 40, 80, 20);
  settle(10, "S4", 55, 0, 10);
  settle(5, "S5", 35, 40, 12);

  // ── Direct loads (khata for trucks that never touch the godown) ────────────
  t.add(18, dev.own, "load L1", async () => {
    const saved = await saveLoad(gid, {
      type: "LOAD",
      mode: "OWN_TRADE",
      date: day(18),
      loadPlaceId: b.place.P1!,
      fromPartyId: P("f3"),
      toMillPartyId: P("m2"),
      vehicleNumber: "WB52C9012",
      varietyId: V("LAL_SWARNA"),
      bags: 400,
      grossG: kg(20_000),
      netG: kg(19_700),
      partySellRatePaisePerQtl: rate(2215),
      millRatePaisePerQtl: rate(2290),
      totalAmountPaise: "0",
    } as VoucherDraft);
    loads.L1 = saved.primary;
  });
  t.add(9, dev.own, "load L2", async () => {
    const saved = await saveLoad(gid, {
      type: "LOAD",
      mode: "OWN_TRADE",
      date: day(9),
      loadPlaceId: b.place.P2!,
      fromPartyId: P("f6"),
      toMillPartyId: P("m3"),
      vehicleNumber: "WB44A1234",
      varietyId: V("MINIKIT"),
      bags: 360,
      grossG: kg(18_000),
      netG: kg(17_800),
      partySellRatePaisePerQtl: rate(2370),
      millRatePaisePerQtl: rate(2455),
      totalAmountPaise: "0",
    } as VoucherDraft);
    loads.L2 = saved.primary;
  });
  t.add(5, dev.own, "load L3 (agent)", async () => {
    await saveLoad(gid, {
      type: "LOAD",
      mode: "AGENT",
      date: day(5),
      loadPlaceId: b.place.P4!,
      fromPartyId: P("f5"),
      toMillPartyId: P("m1"),
      vehicleNumber: "WB52C9012",
      varietyId: V("GOBINDOBHOG"),
      bags: 240,
      grossG: kg(12_000),
      netG: kg(11_900),
      commission: { ratePaisePerQtl: rate(20), amountPaise: "0", payer: "MILL" },
      totalAmountPaise: "0",
    } as VoucherDraft);
  });
  t.add(1, dev.own, "load L4 (from godown stock)", async () => {
    const useKg = await capKg(V("SWARNA"), 15_000);
    if (useKg < 2000n) return;
    await saveLoad(gid, {
      type: "LOAD",
      mode: "OWN_TRADE",
      date: day(1),
      loadPlaceId: b.place.P1!,
      fromStore: true,
      toMillPartyId: P("m2"),
      vehicleNumber: "WB44A1234",
      varietyId: V("SWARNA"),
      bags: Number(useKg / 50n),
      grossG: kg(useKg),
      netG: kg(useKg - 100n),
      millRatePaisePerQtl: rate(2415),
      totalAmountPaise: "0",
    } as VoucherDraft);
  });

  // ── Collections from buyers ────────────────────────────────────────────────
  const collect = (
    back: number,
    by: Who,
    key: string,
    pct: number,
    code: PayCode,
    extra: {
      cheque?: { no: string; dateBack: number; bank: string };
      ref?: string;
      id?: string;
    } = {},
  ) =>
    t.add(back, who(by), `receipt ${key}`, async () => {
      const bal = await partyBalance(gid, P(key));
      const amount = part(bal, pct);
      if (amount <= 0n) return;
      const date = day(back);
      const p: Pay = extra.cheque
        ? { amountPaise: amount, mode: "CHEQUE", bankId: b.bank.sbi! }
        : { ...pay(code), amountPaise: amount, ...(extra.ref ? { ref: extra.ref } : {}) };
      const saved = await saveMoney(
        gid,
        moneyDraft({
          type: "RECEIPT",
          date,
          partyId: P(key),
          pay: p,
          ...(extra.cheque
            ? {
                chequeNo: extra.cheque.no,
                chequeDate: day(extra.cheque.dateBack),
                theirBank: extra.cheque.bank,
              }
            : {}),
        }),
      );
      if (extra.id) receipts[extra.id] = saved.primary;
    });
  collect(19, "o", "t1", 60, "C", {
    cheque: { no: "003412", dateBack: 19, bank: "Bandhan Bank, Bolpur" },
    id: "CHQ1",
  });
  collect(15, "o", "m1", 100, "B", { ref: "SBIN526114820931" });
  collect(12, "o", "m2", 100, "B", { ref: "ICIC526117702254" });
  collect(8, "o", "m3", 100, "B", { ref: "UTIB526120118833" });
  collect(7, "o", "t2", 40, "C", {
    cheque: { no: "771209", dateBack: 7, bank: "UBI, Durgapur" },
    id: "CHQ2",
  });
  collect(3, "o", "m3", 50, "U", { ref: "UPI/526128844120" });
  collect(1, "o", "t1", 45, "U", { ref: "UPI/526130077314" });
  // Post-dated cheque from Maa Tara (clears in 5 days): shows in the cheque reminders.
  collect(4, "o", "m1", 55, "B", {
    cheque: { no: "118830", dateBack: -5, bank: "HDFC Bank, Bolpur" },
    id: "CHQ3",
  });

  // Cheque lifecycle: CHQ1 clears, CHQ2 bounces and the trader pays cash instead.
  t.add(17, dev.own, "cheque clears", async () => {
    const r = receipts.CHQ1;
    if (!r || r.type !== "RECEIPT") return;
    await saveSimple(
      gid,
      contraDraft({
        date: day(17),
        kind: "CHEQUE_CLEAR",
        amountPaise: BigInt(r.amountPaise),
        bankId: b.bank.sbi!,
        receiptVoucherId: r._id,
        notes: "চেক নং 003412 ক্লিয়ার হয়েছে",
      }),
    );
  });
  t.add(4, dev.own, "cheque bounces", async () => {
    const r = receipts.CHQ2;
    if (!r || r.type !== "RECEIPT") return;
    await saveSimple(
      gid,
      contraDraft({
        date: day(4),
        kind: "CHEQUE_BOUNCE",
        amountPaise: BigInt(r.amountPaise),
        partyId: P("t2"),
        receiptVoucherId: r._id,
        notes: "চেক ফেরত — অপর্যাপ্ত ব্যালেন্স",
      }),
    );
  });
  t.add(3, dev.own, "bounced cheque re-paid in cash", async () => {
    const bal = await partyBalance(gid, P("t2"));
    const amount = part(bal, 30);
    if (amount <= 0n) return;
    await saveMoney(
      gid,
      moneyDraft({
        type: "RECEIPT",
        date: day(3),
        partyId: P("t2"),
        pay: { amountPaise: amount, mode: "CASH" },
      }),
    );
  });

  // ── Payments to farmers, transporter, pump, labour ─────────────────────────
  const payOut = (back: number, by: Who, key: string, pct: number, code: PayCode) =>
    t.add(back, who(by), `payment ${key}`, async () => {
      const bal = await partyBalance(gid, P(key));
      const amount = part(-bal, pct);
      if (amount <= 0n) return;
      await saveMoney(
        gid,
        moneyDraft({
          type: "PAYMENT",
          date: day(back),
          partyId: P(key),
          pay: { ...pay(code), amountPaise: amount },
        }),
      );
    });
  payOut(21, "o", "f1", 50, "C");
  payOut(18, "o", "f2", 60, "B");
  payOut(14, "o", "f3", 40, "C");
  payOut(12, "o", "f6", 100, "C");
  payOut(10, "m", "f4", 50, "B");
  payOut(9, "o", "f5", 100, "B");
  payOut(6, "o", "f1", 70, "C");
  payOut(5, "o", "f2", 40, "U");
  payOut(3, "o", "f7", 100, "C");
  payOut(2, "o", "tr1", 100, "C");
  payOut(2, "o", "p1", 100, "C");
  payOut(8, "o", "l1", 100, "C");

  // ── Day-to-day expenses ────────────────────────────────────────────────────
  type ERow = [number, Who, string, number, string, "CASH" | "UPI" | "BANK_TRANSFER", boolean?];
  const expenses: ERow[] = [
    [25, "o", "GODOWN_RENT", 25_000, "গোডাউন ভাড়া — নভেম্বর", "BANK_TRANSFER"],
    [24, "o", "BAGS", 12_000, "চটের বস্তা ৪০০ পিস", "CASH"],
    [22, "o", "LABOUR", 3_200, "৩ ট্রাক নামানোর মজুরি", "CASH"],
    [21, "o", "LABOUR", 8_500, "বোঝাই মজুরি — ৩য় সপ্তাহ (হারু সর্দার)", "CASH", true],
    [20, "o", "TRANSPORT", 2_400, "পিকআপ ভাড়া — মাঠ থেকে গোডাউন", "CASH"],
    [18, "o", "ELECTRICITY", 4_820, "বিদ্যুৎ বিল (WBSEDCL)", "UPI"],
    [16, "o", "MOBILE", 599, "মোবাইল রিচার্জ", "UPI"],
    [15, "e", "FOOD", 1_850, "শ্রমিকদের চা-জলখাবার", "CASH"],
    [13, "o", "REPAIR", 3_600, "ওজন কাঁটা মেরামত", "CASH"],
    [12, "o", "CUSTOM", 2_500, "বৃষ্টির জন্য ত্রিপল ভাড়া", "CASH"],
    [10, "o", "LABOUR", 4_100, "ধান ঝাড়াই ও বস্তাবন্দি", "CASH"],
    [7, "o", "FOOD", 1_200, "শ্রমিকদের চা-জলখাবার", "CASH"],
    [5, "o", "LABOUR", 3_800, "ট্রাক বোঝাই মজুরি", "CASH"],
    [3, "o", "TRANSPORT", 1_800, "পিকআপ ভাড়া", "CASH"],
    [1, "e", "LABOUR", 2_900, "ধান নামানোর মজুরি", "CASH"],
    [0, "e", "FOOD", 650, "শ্রমিকদের চা-জলখাবার", "CASH"],
    [0, "o", "LABOUR", 2_100, "ট্রাক বোঝাই মজুরি", "CASH"],
  ];
  for (const [back, w, code, rs, desc, mode, credit] of expenses) {
    t.add(back, who(w), `expense ${code}`, async () => {
      await saveSimple(
        gid,
        expenseDraft({
          date: day(back),
          code: code === "CUSTOM" ? b.customCategory! : code,
          amountRs: rs,
          description: desc,
          mode,
          ...(mode === "UPI"
            ? { bankId: b.bank.uco! }
            : mode === "BANK_TRANSFER"
              ? { bankId: b.bank.sbi! }
              : {}),
          ...(credit ? { onCredit: true, payeePartyId: P("l1") } : {}),
          ...(code === "GODOWN_RENT" ? { payeeText: "শ্রী হরিদাস রায় (গোডাউন মালিক)" } : {}),
        }),
      );
    });
  }

  // ── Bank & owner entries (contra) ──────────────────────────────────────────
  t.add(20, dev.own, "cash deposit", async () => {
    await saveSimple(
      gid,
      contraDraft({
        date: day(20),
        kind: "CASH_DEPOSIT",
        amountRs: 100_000,
        bankId: b.bank.sbi!,
        notes: "বিক্রির নগদ ব্যাংকে জমা",
      }),
    );
  });
  t.add(11, dev.own, "bank to bank", async () => {
    await saveSimple(
      gid,
      contraDraft({
        date: day(11),
        kind: "BANK_TRANSFER",
        amountRs: 50_000,
        bankId: b.bank.sbi!,
        toBankId: b.bank.uco!,
        notes: "UPI-র জন্য UCO-তে স্থানান্তর",
      }),
    );
  });
  t.add(6, dev.own, "drawings", async () => {
    await saveSimple(
      gid,
      contraDraft({ date: day(6), kind: "DRAWINGS", amountRs: 15_000, notes: "মালিকের সংসার খরচ" }),
    );
  });

  // ── Stock adjustments ──────────────────────────────────────────────────────
  const adjust = (
    back: number,
    v: string,
    grams: string,
    reason: "DRYING" | "RODENT" | "COUNT",
    note: string,
  ) =>
    t.add(back, dev.own, `stock adjust ${v}`, async () => {
      await saveSimple(gid, {
        type: "STOCK_ADJUST",
        date: day(back),
        lines: [{ varietyId: V(v), qtyG: grams, reason, note }],
      } as VoucherDraft);
    });
  adjust(12, "SWARNA", "-150000", "DRYING", "রোদে শুকিয়ে ওজন কমেছে");
  adjust(6, "LAL_SWARNA", "-80000", "RODENT", "ইঁদুরে নষ্ট");
  adjust(2, "MINIKIT", "40000", "COUNT", "গণনায় বেশি পাওয়া গেছে");

  // ── Own vehicles on hire (trips) ───────────────────────────────────────────
  t.add(14, dev.own, "trip hire", async () => {
    await saveSimple(gid, {
      type: "TRIP",
      date: day(14),
      vehicleId: b.vehicle.own1!,
      driverPartyId: P("d1"),
      hirerPartyId: P("t2"),
      loadingPlace: "দুর্গাপুর",
      unloadingPlace: "সাঁইথিয়া",
      qtyG: kg(12_000),
      rateMode: "PER_QUINTAL",
      ratePaise: R(55),
      freightPaise: "0",
      advanceReceivedPaise: R(2_000),
      advanceMode: "CASH",
      expenses: [
        { kind: "DIESEL", amountPaise: R(6_500), litresMl: "70000", mode: "CASH" },
        { kind: "DRIVER", amountPaise: R(800), mode: "CASH", note: "ড্রাইভার ভাতা" },
        { kind: "TOLL", amountPaise: R(420), mode: "CASH" },
      ],
      duePaise: "0",
      odometerStartKm: 84_210,
      odometerEndKm: 84_398,
    } as VoucherDraft);
  });
  t.add(7, dev.own, "trip fixed freight", async () => {
    await saveSimple(gid, {
      type: "TRIP",
      date: day(7),
      vehicleId: b.vehicle.own1!,
      driverPartyId: P("d1"),
      hirerPartyId: P("t1"),
      loadingPlace: "বোলপুর",
      unloadingPlace: "রামপুরহাট",
      qtyG: kg(9_000),
      rateMode: "FIXED",
      ratePaise: R(4_000),
      freightPaise: "0",
      expenses: [
        {
          kind: "DIESEL",
          amountPaise: R(3_100),
          litresMl: "34000",
          mode: "CASH",
          creditPartyId: P("p1"),
          note: "ধারে ডিজেল",
        },
        { kind: "DRIVER", amountPaise: R(500), mode: "CASH" },
        { kind: "LOADING", amountPaise: R(600), mode: "CASH" },
      ],
      duePaise: "0",
      odometerStartKm: 84_398,
      odometerEndKm: 84_452,
    } as VoucherDraft);
  });
  t.add(3, dev.own, "trip pickup", async () => {
    await saveSimple(gid, {
      type: "TRIP",
      date: day(3),
      vehicleId: b.vehicle.own2!,
      driverPartyId: P("d2"),
      hirerPartyId: P("t1"),
      loadingPlace: "নলহাটি হাট",
      unloadingPlace: "রামপুরহাট গোডাউন",
      qtyG: kg(2_400),
      rateMode: "FIXED",
      ratePaise: R(1_500),
      freightPaise: "0",
      expenses: [{ kind: "DIESEL", amountPaise: R(700), litresMl: "8000", mode: "CASH" }],
      duePaise: "0",
    } as VoucherDraft);
  });
  t.add(9, dev.own, "trip on own load", async () => {
    const l = loads.L2;
    if (!l) return;
    await saveSimple(gid, {
      type: "TRIP",
      date: day(9),
      vehicleId: b.vehicle.own1!,
      driverPartyId: P("d1"),
      loadingPlace: "বোলপুর বাজার",
      unloadingPlace: "দুর্গাপুর — শ্রী গণেশ রাইস মিল",
      qtyG: kg(17_800),
      rateMode: "FIXED",
      ratePaise: "0",
      freightPaise: "0",
      ownTradeLoadId: l._id,
      expenses: [
        { kind: "DIESEL", amountPaise: R(8_200), litresMl: "90000", mode: "CASH" },
        { kind: "DRIVER", amountPaise: R(1_000), mode: "CASH" },
        { kind: "UNLOADING", amountPaise: R(1_400), mode: "CASH" },
      ],
      duePaise: "0",
      odometerStartKm: 84_452,
      odometerEndKm: 84_611,
    } as VoucherDraft);
  });

  // ── Reminders (manual) ─────────────────────────────────────────────────────
  t.add(8, dev.own, "reminder: weighbridge", async () => {
    await createManualReminder(gid, { title: "ওজন কাঁটার ক্যালিব্রেশন করাতে হবে", dueDate: day(3) });
  });
  t.add(6, dev.own, "reminder: licence", async () => {
    await createManualReminder(gid, { title: "ট্রেড লাইসেন্স নবীকরণ", dueDate: day(-12) });
  });
  t.add(5, dev.own, "reminder: GST (snoozed)", async () => {
    const r = await createManualReminder(gid, {
      title: "GST রিটার্ন জমা দিতে হবে",
      dueDate: day(-1),
    });
    await setReminderState(gid, r._id, { snoozeUntil: day(-3) });
  });
  t.add(4, dev.own, "reminder: old (done)", async () => {
    const r = await createManualReminder(gid, { title: "বিদ্যুৎ বিল মেটানো", dueDate: day(2) });
    await setReminderState(gid, r._id, { done: true });
  });
  t.add(2, dev.own, "reminder: call mill", async () => {
    await createManualReminder(gid, {
      title: "মা তারা মিলে ফোন করে চেকের কথা জানতে হবে",
      dueDate: day(0),
      partyId: P("m1"),
      kind: "COLLECT_DUE",
    });
  });

  // ── Inter-godown transfers (Rampur → Sonapur) ──────────────────────────────
  t.add(11, dev.own, "transfer paddy (paired)", async () => {
    await saveTransfer({
      kind: "PADDY",
      date: day(11),
      fromGodownId: gid,
      toGodownId: sn.gid,
      qtyG: BigInt(kg(5_000)),
      ratePaisePerQtl: BigInt(rate(2310)),
      from: { varietyId: V("SWARNA") },
      to: { varietyId: sn.variety.SWARNA! },
      notes: "সোনাপুর গোডাউনে ধান পাঠানো হয়েছে",
    });
  });
  t.add(8, dev.own, "transfer money (paired)", async () => {
    await saveTransfer({
      kind: "MONEY",
      date: day(8),
      fromGodownId: gid,
      toGodownId: sn.gid,
      amountPaise: BigInt(R(200_000)),
      from: { mode: "BANK_TRANSFER", bankAccountId: b.bank.sbi! },
      to: { mode: "BANK_TRANSFER", bankAccountId: sn.bank.bob! },
      notes: "সোনাপুরে ধান কেনার জন্য টাকা",
    });
  });
  let acceptedTransferId: string | undefined;
  t.add(6, dev.mgr, "transfer money (unpaired → accepted)", async () => {
    const r = await saveTransfer({
      kind: "MONEY",
      date: day(6),
      fromGodownId: gid,
      toGodownId: sn.gid,
      amountPaise: BigInt(R(75_000)),
      from: { mode: "CASH" },
      to: { mode: "CASH" },
      notes: "নগদ পাঠানো — ম্যানেজার",
    });
    acceptedTransferId = r.groupId;
  });
  t.add(5, dev.snm, "accept transfer at Sonapur", async () => {
    if (!acceptedTransferId) return;
    await acceptTransfer(sn.gid, acceptedTransferId, { mode: "CASH" });
  });
  // Two receipts left pending at Sonapur for the demo ("pending receipts" screen).
  t.add(1, dev.mgr, "transfer money (pending)", async () => {
    await saveTransfer({
      kind: "MONEY",
      date: day(1),
      fromGodownId: gid,
      toGodownId: sn.gid,
      amountPaise: BigInt(R(50_000)),
      from: { mode: "CASH" },
      to: { mode: "CASH" },
      notes: "খরচের জন্য নগদ",
    });
  });
  t.add(1, dev.mgr, "transfer paddy (pending)", async () => {
    await saveTransfer({
      kind: "PADDY",
      date: day(1),
      fromGodownId: gid,
      toGodownId: sn.gid,
      qtyG: BigInt(kg(3_000)),
      ratePaisePerQtl: BigInt(rate(2335)),
      from: { varietyId: V("SWARNA") },
      to: { varietyId: sn.variety.SWARNA! },
      notes: "সোনাপুরের জন্য ৩০ কুইন্টাল",
    });
  });

  // ── Day close (evening, owner): most past days, a short and an excess day ──
  const closeDays = [
    29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5,
    4, 3,
  ];
  for (const back of closeDays) {
    t.close(back, dev.own, "day close", async () => {
      const date = day(back);
      const expected = await cashBalance(gid, date);
      let counted = expected;
      let notes: string | undefined;
      if (back === 20) {
        counted = expected - 50_000n;
        notes = "ছোট খুচরো গরমিল — ₹৫০০ কম";
      } else if (back === 9) {
        counted = expected + 20_000n;
        notes = "খুচরো ফেরত এসেছে — ₹২০০ বেশি";
      }
      await closeDay(gid, {
        date,
        countedCashPaise: counted,
        ...(notes ? { notes } : {}),
      });
    });
  }
}

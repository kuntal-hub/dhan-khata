/**
 * The Sonapur Godown story: a smaller second business run mostly by its own manager (Anwar),
 * so the demo can show two independent books, role-limited staff and the consolidated view.
 */
import { partyBalance } from "@/client/queries/ledger";
import {
  closeDay,
  saveMoney,
  savePurchase,
  saveSale,
  saveSimple,
  type VoucherDraft,
} from "@/client/repo";
import { addDays } from "@/domain/dates";
import type { Devices } from "./rampur";
import {
  R,
  cashBalance,
  contraDraft,
  day,
  expenseDraft,
  kg,
  moneyDraft,
  purchaseDraft,
  saleDraft,
  storeStock,
  tl,
  type Pay,
} from "./helpers";
import type { Book } from "./masters";
import type { Timeline } from "./timeline";

export function sonapurStory(t: Timeline, b: Book, dev: Devices) {
  const gid = b.gid;
  const P = (k: string) => b.party[k]!;
  const V = (k: string) => b.variety[k]!;
  const bob = b.bank.bob!;
  const part = (bal: bigint, pct: number): bigint => ((bal * BigInt(pct)) / 100n / 100n) * 100n;
  const upi = (rs?: number): Pay => ({
    ...(rs !== undefined ? { amountRs: rs } : {}),
    mode: "UPI",
    bankId: bob,
  });
  const cash = (rs?: number): Pay => ({
    ...(rs !== undefined ? { amountRs: rs } : {}),
    mode: "CASH",
  });
  const neft = (rs?: number): Pay => ({
    ...(rs !== undefined ? { amountRs: rs } : {}),
    mode: "BANK_TRANSFER",
    bankId: bob,
  });

  t.add(29, dev.own, "SN opening balances", async () => {
    await saveSimple(gid, {
      type: "OPENING",
      date: day(29),
      notes: "গো-লাইভ ব্যালেন্স",
      items: [
        { kind: "CASH", amountPaise: R(80_000) },
        { kind: "BANK", refId: bob, amountPaise: R(150_000) },
        { kind: "STOCK", varietyId: V("SWARNA"), qtyG: kg(4_000), amountPaise: R(90_000) },
        { kind: "STOCK", varietyId: V("MINIKIT"), qtyG: kg(2_500), amountPaise: R(57_500) },
        { kind: "PARTY", refId: P("s2"), amountPaise: R(-12_000) },
      ],
    } as VoucherDraft);
  });

  // [daysAgo, owner?, farmer, variety, grossKg, ₹/qtl, bags, paid, due]
  type Row = [number, boolean, string, string, number, number, number, Pay | null, number];
  const purchases: Row[] = [
    [27, false, "s1", "SWARNA", 3200, 2285, 64, cash(20_000), 7],
    [24, false, "s2", "MINIKIT", 4100, 2360, 82, upi(25_000), 8],
    [21, false, "s3", "SWARNA", 5000, 2300, 100, cash(40_000), 9],
    [18, true, "s4", "SWARNA", 3800, 2310, 76, null, 10],
    [15, false, "s1", "MINIKIT", 4500, 2380, 90, cash(30_000), 6],
    [11, false, "s2", "SWARNA", 6000, 2320, 120, neft(60_000), 7],
    [8, false, "s3", "MINIKIT", 3000, 2390, 60, cash(20_000), 5],
    [5, false, "s4", "SWARNA", 4800, 2335, 96, cash(35_000), 4],
    [2, false, "s1", "SWARNA", 3600, 2340, 72, cash(25_000), 3],
    [0, false, "s2", "MINIKIT", 2800, 2400, 56, upi(20_000), 2],
  ];
  for (const [back, owner, f, v, gKg, rs, bags, paid, due] of purchases) {
    t.add(back, owner ? dev.own : dev.snm, `SN purchase ${f}`, async () => {
      const date = day(back);
      await savePurchase(
        gid,
        purchaseDraft({
          date,
          partyId: P(f),
          lines: [tl(V(v), gKg, rs, { bags, tareG: 500, dhaltaG: 1000 })],
          ...(paid ? { paid } : {}),
          dueDate: addDays(date, due),
        }),
      );
    });
  }

  // [daysAgo, buyer, variety, kg, ₹/qtl, vehicle#, loading?, advance?, expect]
  type SRow = [number, string, string, number, number, string, boolean, Pay | null, number];
  const sales: SRow[] = [
    [22, "sm1", "SWARNA", 6000, 2350, "WB59E7788", false, neft(50_000), 6],
    [16, "sm1", "MINIKIT", 7000, 2430, "WB59E7788", true, null, 8],
    [10, "st1", "SWARNA", 8000, 2395, "WB59F2210", true, cash(40_000), 7],
    [4, "sm1", "MINIKIT", 6000, 2460, "WB59E7788", false, null, 6],
    [1, "st1", "SWARNA", 6500, 2420, "WB59F2210", true, null, 5],
  ];
  for (const [back, buyer, v, plannedKg, rs, veh, loading, adv, expect] of sales) {
    t.add(back, dev.snm, `SN sale ${buyer}`, async () => {
      const date = day(back);
      const spare = (await storeStock(gid, V(v))) / 1000n - 200n;
      const want = BigInt(plannedKg);
      const useKg = want <= spare ? want : (spare / 100n) * 100n;
      if (useKg < 1000n) return;
      await saveSale(
        gid,
        saleDraft({
          date,
          partyId: P(buyer),
          vehicleNumber: veh,
          lines: [tl(V(v), useKg, rs, { bags: Number(useKg / 50n) })],
          ...(loading
            ? {
                loading: {
                  ratePerQtlRs: 10,
                  payTo: "LABOUR_PARTY" as const,
                  labourPartyId: P("l1"),
                },
              }
            : {}),
          delivery: { payer: "BUYER" },
          ...(adv ? { advance: adv } : {}),
          expectedPaymentDate: addDays(date, expect),
        }),
      );
    });
  }

  const collect = (back: number, key: string, pct: number, p: Pay, owner = false) =>
    t.add(back, owner ? dev.own : dev.snm, `SN receipt ${key}`, async () => {
      const amount = part(await partyBalance(gid, P(key)), pct);
      if (amount <= 0n) return;
      await saveMoney(
        gid,
        moneyDraft({
          type: "RECEIPT",
          date: day(back),
          partyId: P(key),
          pay: { ...p, amountPaise: amount },
        }),
      );
    });
  collect(14, "sm1", 100, neft());
  collect(7, "st1", 50, upi());
  collect(2, "sm1", 60, upi(), true);

  const payOut = (back: number, key: string, pct: number, p: Pay) =>
    t.add(back, dev.snm, `SN payment ${key}`, async () => {
      const amount = part(-(await partyBalance(gid, P(key))), pct);
      if (amount <= 0n) return;
      await saveMoney(
        gid,
        moneyDraft({
          type: "PAYMENT",
          date: day(back),
          partyId: P(key),
          pay: { ...p, amountPaise: amount },
        }),
      );
    });
  payOut(9, "s2", 100, cash());
  payOut(3, "s1", 50, cash());
  payOut(6, "l1", 100, cash());

  type ERow = [number, string, number, string, "CASH" | "UPI"];
  const expenses: ERow[] = [
    [25, "GODOWN_RENT", 8_000, "গোডাউন ভাড়া", "CASH"],
    [20, "LABOUR", 2_400, "ধান নামানোর মজুরি", "CASH"],
    [17, "ELECTRICITY", 1_850, "বিদ্যুৎ বিল", "UPI"],
    [12, "LABOUR", 1_800, "বোঝাই মজুরি", "CASH"],
    [9, "FOOD", 700, "শ্রমিকদের চা-জলখাবার", "CASH"],
    [6, "MOBILE", 349, "মোবাইল রিচার্জ", "UPI"],
    [3, "REPAIR", 1_500, "বস্তা সেলাই ও মেরামত", "CASH"],
    [1, "LABOUR", 900, "ধান নামানোর মজুরি", "CASH"],
  ];
  for (const [back, code, rs, desc, mode] of expenses) {
    t.add(back, dev.snm, `SN expense ${code}`, async () => {
      await saveSimple(
        gid,
        expenseDraft({
          date: day(back),
          code,
          amountRs: rs,
          description: desc,
          mode,
          ...(mode === "UPI" ? { bankId: bob } : {}),
        }),
      );
    });
  }

  t.add(13, dev.snm, "SN cash deposit", async () => {
    await saveSimple(
      gid,
      contraDraft({
        date: day(13),
        kind: "CASH_DEPOSIT",
        amountRs: 50_000,
        bankId: bob,
        notes: "নগদ ব্যাংকে জমা",
      }),
    );
  });
  t.add(13, dev.snm, "SN stock adjust", async () => {
    await saveSimple(gid, {
      type: "STOCK_ADJUST",
      date: day(13),
      lines: [
        { varietyId: V("SWARNA"), qtyG: "-60000", reason: "DRYING", note: "শুকিয়ে ওজন কমেছে" },
      ],
    } as VoucherDraft);
  });
  t.add(12, dev.snm, "SN trip", async () => {
    await saveSimple(gid, {
      type: "TRIP",
      date: day(12),
      vehicleId: b.vehicle.own1!,
      driverPartyId: P("d1"),
      hirerPartyId: P("st1"),
      loadingPlace: "সোনাপুর হাট",
      unloadingPlace: "বহরমপুর",
      qtyG: kg(3_000),
      rateMode: "FIXED",
      ratePaise: R(1_800),
      freightPaise: "0",
      expenses: [{ kind: "DIESEL", amountPaise: R(600), litresMl: "6500", mode: "CASH" }],
      duePaise: "0",
    } as VoucherDraft);
  });

  for (const back of [26, 23, 20, 17, 14, 11, 8, 5, 3]) {
    t.close(back, dev.own, "SN day close", async () => {
      const date = day(back);
      await closeDay(gid, { date, countedCashPaise: await cashBalance(gid, date) });
    });
  }
}

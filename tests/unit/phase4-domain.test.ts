import { describe, expect, it } from "vitest";
import { validateVoucherRules, recomputeVoucher } from "@/domain/calc/recompute";
import { countDenominations } from "@/domain/calc/settlement";
import { vehiclePnl } from "@/domain/calc/vehicle";
import { post } from "@/domain/posting/post";
import type { ExpenseVoucher, TripVoucher, Voucher } from "@/domain/schemas";
import { termsOfSendVoucher, transferReceiveDraft, transferSendDraft } from "@/domain/transfer";
import { mk } from "../helpers/factory";

/** Build a schema-valid voucher from a draft-like object (type + fields). */
function v(draft: object, opts: { godownId?: string; status?: "active" | "void" } = {}): Voucher {
  const { type, ...rest } = draft as { type: Voucher["type"] };
  return mk(type, rest as never, opts);
}

const QTL = 100_000n;

function trip(over: Partial<TripVoucher> = {}): TripVoucher {
  const { status, ...rest } = over;
  return v(
    {
      type: "TRIP",
      vehicleId: "VEH",
      hirerPartyId: "H",
      loadingPlace: "A",
      unloadingPlace: "B",
      qtyG: (100n * QTL).toString(),
      rateMode: "PER_QUINTAL",
      ratePaise: "5000",
      freightPaise: "500000",
      advanceReceivedPaise: "100000",
      expenses: [
        { kind: "DIESEL", amountPaise: "150000", litresMl: "16000", mode: "CASH" },
        { kind: "TOLL", amountPaise: "10000", mode: "CASH" },
      ],
      duePaise: "400000",
      ...rest,
    },
    status ? { status } : {},
  ) as TripVoucher;
}

describe("vehicle P&L (§9.7)", () => {
  it("sums freight, expenses by kind, due, diesel and ₹/km", () => {
    const p = vehiclePnl(
      [
        trip({ odometerStartKm: 100, odometerEndKm: 180 }),
        trip({ ownTradeLoadId: "L1", freightPaise: "0", duePaise: "0", advanceReceivedPaise: "0" }),
        trip({ status: "void" }),
      ],
      [
        v({
          type: "EXPENSE",
          categoryCode: "OTHERS",
          amountPaise: "20000",
          mode: "CASH",
          description: "x",
        }) as ExpenseVoucher,
        v(
          {
            type: "EXPENSE",
            categoryCode: "OTHERS",
            amountPaise: "99",
            mode: "CASH",
            description: "x",
          },
          { status: "void" },
        ) as ExpenseVoucher,
      ],
    );
    expect(p.tripCount).toBe(2);
    expect(p.freightPaise).toBe(500_000n);
    expect(p.expensesByKind.DIESEL).toBe(300_000n);
    expect(p.expensesByKind.TOLL).toBe(20_000n);
    expect(p.expensesByKind.REPAIR).toBe(0n);
    expect(p.otherExpensesPaise).toBe(20_000n);
    expect(p.totalExpensesPaise).toBe(340_000n);
    expect(p.netProfitPaise).toBe(160_000n);
    expect(p.dueFromHirersPaise).toBe(400_000n);
    expect(p.dieselMl).toBe(32_000n);
    expect(p.km).toBe(80n);
    expect(p.perKmPaise).toBe(2_000n); // ₹1,600 ÷ 80 km
    expect(vehiclePnl([]).perKmPaise).toBeNull();
  });
});

describe("inter-godown transfer builders (§1.4 rule 5)", () => {
  const terms = {
    kind: "PADDY" as const,
    date: "2026-11-24",
    qtyG: 4n * QTL,
    ratePaisePerQtl: 200_000n,
  };

  it("paddy pair: same qty/rate, opposite sides, balanced and equal amounts", () => {
    const send = v(
      transferSendDraft(
        terms,
        { godownId: "GA", partyId: "PB", varietyId: "VA" },
        "GB",
        "G1",
        true,
      ),
    );
    const recv = v(
      transferReceiveDraft(
        terms,
        { godownId: "GB", partyId: "PA", varietyId: "VB" },
        "GA",
        "G1",
        true,
      ),
      { godownId: "GB" },
    );
    const s = recomputeVoucher(send);
    const r = recomputeVoucher(recv);
    expect(s.type).toBe("SALE");
    expect(r.type).toBe("PURCHASE");
    expect(s.type === "SALE" && s.totalPaise).toBe("800000");
    expect(r.type === "PURCHASE" && r.totalPaise).toBe("800000");
    expect(validateVoucherRules(s)).toEqual([]);
    expect(validateVoucherRules(r)).toEqual([]);
    const ps = post(s);
    expect(ps.lines.find((l) => l.account === "PARTY:PB")?.debit).toBe(800_000n);
    const pr = post(r);
    expect(pr.lines.find((l) => l.account === "PARTY:PA")?.credit).toBe(800_000n);
    expect(termsOfSendVoucher(s as never)).toMatchObject({ kind: "PADDY", qtyG: 4n * QTL });
  });

  it("money pair and rule checks", () => {
    const m = { kind: "MONEY" as const, date: "2026-11-24", amountPaise: 5_000n, notes: " x " };
    const send = v(
      transferSendDraft(
        m,
        { godownId: "GA", partyId: "PB", mode: "UPI", bankAccountId: "BK" },
        "GB",
        "G2",
        false,
      ),
    );
    expect(send.type === "PAYMENT" && send.ourBankAccountId).toBe("BK");
    expect(send.notes).toBe("x");
    expect(termsOfSendVoucher(send as never)).toMatchObject({ kind: "MONEY", amountPaise: 5_000n });
    const recv = transferReceiveDraft(m, { godownId: "GB", partyId: "PA" }, "GA", "G2", false);
    expect(recv.type).toBe("RECEIPT");
    // Same godown on both sides / wrong side for the type / no group → rule errors.
    expect(validateVoucherRules({ ...send, godownId: "GB" } as Voucher)).toContain(
      "TRANSFER_SAME_GODOWN",
    );
    expect(
      validateVoucherRules({
        ...send,
        interGodown: { counterGodownId: "GB", side: "RECEIVE", paired: false },
      } as Voucher),
    ).toContain("INVALID_REFERENCE");
    expect(validateVoucherRules({ ...send, groupId: undefined } as Voucher)).toContain(
      "INVALID_REFERENCE",
    );
    expect(() =>
      transferSendDraft(
        { ...m, amountPaise: 0n },
        { godownId: "GA", partyId: "P" },
        "GB",
        "G",
        false,
      ),
    ).toThrow();
    expect(() =>
      transferSendDraft(
        { ...terms, qtyG: 0n },
        { godownId: "GA", partyId: "P", varietyId: "V" },
        "GB",
        "G",
        false,
      ),
    ).toThrow();
  });
});

describe("day close helpers (§9.10)", () => {
  it("denomination helper counts notes and coins exactly", () => {
    expect(countDenominations({ "500": 3, "200": 1, "10": 2, coinsPaise: 4550 })).toBe(176_550n);
    expect(() => countDenominations({ "500": -1 })).toThrow();
  });
});

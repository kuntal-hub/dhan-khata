/**
 * fast-check arbitraries producing VALID vouchers of every type (derived fields recomputed,
 * schema-validated by `mk`). Small id pools so vouchers interact (same parties/varieties).
 */
import fc from "fast-check";
import { computeDeductions } from "@/domain/calc/trade";
import type { Voucher } from "@/domain/schemas/vouchers";
import { CONTRA_KINDS, STOCK_ADJUST_REASONS, TRIP_EXPENSE_KINDS } from "@/domain/schemas/vouchers";
import { line, mk } from "../helpers/factory";

export const PARTIES = ["P1", "P2", "P3", "P4"] as const;
export const VARIETIES = ["V1", "V2", "V3"] as const;
export const BANKS = ["B1", "B2"] as const;

const party = fc.constantFrom(...PARTIES);
const variety = fc.constantFrom(...VARIETIES);
const bank = fc.constantFrom(...BANKS);
const amount = (max = 5_000_000_00n) => fc.bigInt({ min: 1n, max }).map((b) => b.toString());
const day = fc.integer({ min: 1, max: 28 }).map((d) => `2026-11-${String(d).padStart(2, "0")}`);
const seconds = fc.integer({ min: 0, max: 86_399 });

export interface Meta {
  godownId: string;
  date: string;
  createdAt: string;
}

export const meta = (godownId: string): fc.Arbitrary<Meta> =>
  fc.tuple(day, seconds).map(([date, s]) => ({
    godownId,
    date,
    createdAt: `${date}T${String(Math.trunc(s / 3600)).padStart(2, "0")}:${String(Math.trunc(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000Z`,
  }));

/** A trade line whose net is at least half the gross (so bills are comfortably positive). */
export const tradeLine = fc
  .record({
    varietyId: variety,
    bags: fc.integer({ min: 0, max: 300 }),
    grossG: fc.bigInt({ min: 100_000n, max: 30_000_000n }),
    tarePerBagG: fc.bigInt({ min: 0n, max: 1_000n }),
    dhaltaMode: fc.constantFrom("PER_QUINTAL", "PER_BAG", "FIXED", undefined),
    dhaltaValueG: fc.bigInt({ min: 0n, max: 3_000n }),
    moistureBps: fc.integer({ min: 0, max: 500 }),
    otherDedG: fc.bigInt({ min: 0n, max: 5_000n }),
    rate: fc.bigInt({ min: 100_000n, max: 400_000n }),
  })
  .filter((r) => {
    const d = computeDeductions({ ...r, moistureBps: BigInt(r.moistureBps) });
    return d.netG * 2n >= r.grossG;
  })
  .map((r) =>
    line(r.varietyId, r.grossG, r.rate, {
      bags: r.bags,
      tarePerBagG: r.tarePerBagG,
      ...(r.dhaltaMode ? { dhaltaMode: r.dhaltaMode } : {}),
      dhaltaValueG: r.dhaltaValueG,
      moistureBps: r.moistureBps,
      otherDedG: r.otherDedG,
    }),
  );

const charges = fc.array(
  fc.record({
    label: fc.constant("c"),
    kind: fc.constantFrom("add" as const, "deduct" as const),
    amountPaise: fc.bigInt({ min: 0n, max: 1_000n }).map(String),
  }),
  { maxLength: 2 },
);

const payMode = fc.constantFrom(
  "CASH",
  "BANK_TRANSFER",
  "UPI",
  "CHEQUE",
  "DD",
  "OTHER",
) as fc.Arbitrary<"CASH" | "BANK_TRANSFER" | "UPI" | "CHEQUE" | "DD" | "OTHER">;

export function purchaseArb(godownId: string, storeAt: "STORE" | "TRANSIT" = "STORE") {
  return fc
    .record({
      m: meta(godownId),
      partyId: party,
      lines: fc.array(tradeLine, { minLength: 1, maxLength: 3 }),
      charges,
      round: fc.boolean(),
    })
    .map((r) =>
      mk(
        "PURCHASE",
        {
          partyId: r.partyId,
          storeAt,
          lines: r.lines,
          charges: r.charges,
          roundToRupee: r.round,
          roundOffPaise: "0",
          totalPaise: "0",
        },
        r.m,
      ),
    );
}

export function saleArb(godownId: string) {
  return fc
    .record({
      m: meta(godownId),
      partyId: party,
      lines: fc.array(tradeLine, { minLength: 1, maxLength: 3 }),
      charges,
      round: fc.boolean(),
      payer: fc.constantFrom("US" as const, "MILL" as const, "BUYER" as const),
      freight: fc.bigInt({ min: 0n, max: 100_000n }),
      transporter: fc.option(party, { nil: undefined }),
      vehicleAdvance: fc.option(amount(50_000n), { nil: undefined }),
    })
    .map((r) => {
      const transporter =
        r.payer === "US" || r.vehicleAdvance ? (r.transporter ?? "P4") : r.transporter;
      return mk(
        "SALE",
        {
          partyId: r.partyId,
          vehicleNumber: "WB12AB3456",
          source: "STORE",
          lines: r.lines,
          charges: r.charges,
          roundToRupee: r.round,
          roundOffPaise: "0",
          delivery: {
            fixedPaise: r.freight.toString(),
            amountPaise: "0",
            payer: r.payer,
            ...(transporter ? { transporterPartyId: transporter } : {}),
          },
          ...(r.vehicleAdvance
            ? { vehicleAdvance: { amountPaise: r.vehicleAdvance, mode: "CASH" as const } }
            : {}),
          totalPaise: "0",
          duePaise: "0",
          settlementStatus: "PENDING",
        },
        r.m,
      );
    });
}

export function moneyArb(godownId: string) {
  return fc
    .record({
      m: meta(godownId),
      type: fc.constantFrom("PAYMENT" as const, "RECEIPT" as const),
      partyId: party,
      amt: amount(),
      mode: payMode,
      bank,
      tds: fc.bigInt({ min: 0n, max: 10_000n }),
    })
    .map((r) =>
      r.type === "PAYMENT"
        ? mk(
            "PAYMENT",
            {
              partyId: r.partyId,
              amountPaise: r.amt,
              mode: r.mode,
              ourBankAccountId: r.bank,
              purpose: "BILL",
            },
            r.m,
          )
        : mk(
            "RECEIPT",
            {
              partyId: r.partyId,
              amountPaise: r.amt,
              mode: r.mode,
              ourBankAccountId: r.bank,
              tdsPaise: r.tds.toString(),
              purpose: "BILL",
            },
            r.m,
          ),
    );
}

export function expenseArb(godownId: string) {
  return fc
    .record({
      m: meta(godownId),
      code: fc.constantFrom("LABOUR", "TRANSPORT", "OTHERS", "FOOD"),
      amt: amount(1_000_000n),
      onCredit: fc.boolean(),
      payee: party,
      mode: payMode,
      bank,
    })
    .map((r) =>
      mk(
        "EXPENSE",
        {
          categoryCode: r.code,
          amountPaise: r.amt,
          mode: r.mode,
          bankAccountId: r.bank,
          description: "d",
          ...(r.onCredit ? { onCredit: true, payeePartyId: r.payee } : {}),
        },
        r.m,
      ),
    );
}

export function loadAgentArb(godownId: string) {
  return fc
    .record({
      m: meta(godownId),
      from: party,
      to: party,
      varietyId: variety,
      net: fc.bigInt({ min: 100_000n, max: 20_000_000n }),
      rate: fc.bigInt({ min: 0n, max: 5_000n }),
      payer: fc.constantFrom("MILL" as const, "SELLER" as const),
    })
    .map((r) =>
      mk(
        "LOAD",
        {
          mode: "AGENT",
          fromPartyId: r.from,
          toMillPartyId: r.to,
          vehicleNumber: "X",
          varietyId: r.varietyId,
          grossG: r.net.toString(),
          netG: r.net.toString(),
          totalAmountPaise: "0",
          commission: { ratePaisePerQtl: r.rate.toString(), amountPaise: "100", payer: r.payer },
        },
        r.m,
      ),
    );
}

export function tripArb(godownId: string) {
  return fc
    .record({
      m: meta(godownId),
      hirer: party,
      qty: fc.bigInt({ min: 0n, max: 20_000_000n }),
      rateMode: fc.constantFrom("PER_QUINTAL" as const, "FIXED" as const),
      rate: fc.bigInt({ min: 0n, max: 500_000n }),
      advance: fc.bigInt({ min: 0n, max: 100_000n }),
      own: fc.boolean(),
      expenses: fc.array(
        fc.record({
          kind: fc.constantFrom(...TRIP_EXPENSE_KINDS),
          amt: amount(100_000n),
          credit: fc.option(party, { nil: undefined }),
        }),
        { maxLength: 3 },
      ),
    })
    .map((r) =>
      mk(
        "TRIP",
        {
          vehicleId: "VEH1",
          hirerPartyId: r.hirer,
          loadingPlace: "a",
          unloadingPlace: "b",
          qtyG: r.qty.toString(),
          rateMode: r.rateMode,
          ratePaise: r.rate.toString(),
          freightPaise: "0",
          advanceReceivedPaise: r.advance.toString(),
          advanceMode: "CASH",
          expenses: r.expenses.map((e) => ({
            kind: e.kind,
            amountPaise: e.amt,
            mode: "CASH" as const,
            ...(e.credit ? { creditPartyId: e.credit } : {}),
          })),
          duePaise: "0",
          ...(r.own ? { ownTradeLoadId: "LOADX" } : {}),
        },
        r.m,
      ),
    );
}

export function contraArb(godownId: string) {
  return fc
    .record({
      m: meta(godownId),
      kind: fc.constantFrom(...CONTRA_KINDS),
      amt: amount(),
      viaBank: fc.boolean(),
      partyId: party,
    })
    .map((r) => {
      const needsBank = [
        "CASH_DEPOSIT",
        "CASH_WITHDRAWAL",
        "CHEQUE_CLEAR",
        "BANK_TRANSFER",
      ].includes(r.kind);
      return mk(
        "CONTRA",
        {
          kind: r.kind,
          amountPaise: r.amt,
          ...(needsBank || r.viaBank ? { bankAccountId: "B1" } : {}),
          ...(r.kind === "BANK_TRANSFER" ? { toBankAccountId: "B2" } : {}),
          ...(r.kind === "CHEQUE_BOUNCE" ? { partyId: r.partyId } : {}),
        },
        r.m,
      );
    });
}

export function stockAdjustArb(godownId: string) {
  return fc
    .record({
      m: meta(godownId),
      lines: fc.array(
        fc.record({
          varietyId: variety,
          qty: fc.bigInt({ min: -2_000_000n, max: 2_000_000n }).filter((q) => q !== 0n),
          reason: fc.constantFrom(...STOCK_ADJUST_REASONS),
        }),
        { minLength: 1, maxLength: 2 },
      ),
    })
    .map((r) =>
      mk(
        "STOCK_ADJUST",
        {
          lines: r.lines.map((l) => ({
            varietyId: l.varietyId,
            qtyG: l.qty.toString(),
            reason: l.reason,
          })),
        },
        r.m,
      ),
    );
}

export function settlementArb(godownId: string) {
  return fc
    .record({
      m: meta(godownId),
      partyId: party,
      dispatched: fc.bigInt({ min: 100_000n, max: 20_000_000n }),
      saleTotal: fc.bigInt({ min: 0n, max: 100_000_000n }),
      gross: fc.bigInt({ min: 100_000n, max: 20_000_000n }),
      cutG: fc.bigInt({ min: 0n, max: 5_000n }),
      bps: fc.integer({ min: 0, max: 500 }),
      cutPaise: fc.bigInt({ min: 0n, max: 1_000n }),
      rate: fc.bigInt({ min: 100_000n, max: 400_000n }),
    })
    .map((r) =>
      mk(
        "MILL_SETTLEMENT",
        {
          saleId: "S1",
          partyId: r.partyId,
          dispatchedNetG: r.dispatched.toString(),
          saleTotalPaise: r.saleTotal.toString(),
          millReceivedGrossG: r.gross.toString(),
          millDeductions: [
            { label: "x", g: r.cutG.toString(), bps: r.bps, paise: r.cutPaise.toString() },
          ],
          millNetG: "1",
          finalRatePaisePerQtl: r.rate.toString(),
          finalAmountPaise: "0",
          differencePaise: "0",
          shortageG: "0",
        },
        r.m,
      ),
    );
}

export function dayCloseArb(godownId: string) {
  return fc
    .record({
      m: meta(godownId),
      expected: fc.bigInt({ min: 0n, max: 10_000_000n }),
      counted: fc.bigInt({ min: 0n, max: 10_000_000n }),
    })
    .map((r) =>
      mk(
        "DAY_CLOSE",
        {
          expectedCashPaise: r.expected.toString(),
          countedCashPaise: r.counted.toString(),
          differencePaise: "0",
          notes: "n",
        },
        r.m,
      ),
    );
}

export function openingArb(godownId: string) {
  return fc
    .record({
      m: meta(godownId),
      items: fc.array(
        fc.oneof(
          fc.record({
            kind: fc.constant("CASH" as const),
            amt: fc.bigInt({ min: 0n, max: 10_000_000n }),
          }),
          fc.record({
            kind: fc.constant("BANK" as const),
            refId: bank,
            amt: fc.bigInt({ min: -1_000_000n, max: 10_000_000n }),
          }),
          fc.record({
            kind: fc.constant("PARTY" as const),
            refId: party,
            amt: fc.bigInt({ min: -10_000_000n, max: 10_000_000n }),
          }),
          fc.record({
            kind: fc.constant("STOCK" as const),
            varietyId: variety,
            qty: fc.bigInt({ min: 0n, max: 10_000_000n }),
            amt: fc.bigInt({ min: 0n, max: 50_000_000n }),
          }),
        ),
        { minLength: 1, maxLength: 4 },
      ),
    })
    .map((r) =>
      mk(
        "OPENING",
        {
          items: r.items.map((it) => ({
            kind: it.kind,
            amountPaise: it.amt.toString(),
            ...("refId" in it ? { refId: it.refId } : {}),
            ...("varietyId" in it ? { varietyId: it.varietyId, qtyG: it.qty.toString() } : {}),
          })),
        },
        r.m,
      ),
    );
}

export function journalArb(godownId: string) {
  const acct = fc.constantFrom(
    "CASH",
    "CAPITAL",
    "DRAWINGS",
    "PARTY:P1",
    "PARTY:P2",
    "BANK:B1",
    "EXP:OTHERS",
  );
  return fc
    .record({
      m: meta(godownId),
      dr: acct,
      cr1: acct,
      cr2: acct,
      total: fc.bigInt({ min: 2n, max: 10_000_000n }),
      split: fc.bigInt({ min: 1n, max: 1_000_000n }),
    })
    .map((r) => {
      const first = r.split < r.total ? r.split : 1n;
      const pid = (a: string) => (a.startsWith("PARTY:") ? { partyId: a.slice(6) } : {});
      return mk(
        "JOURNAL",
        {
          lines: [
            { account: r.dr, debitPaise: r.total.toString(), creditPaise: "0", ...pid(r.dr) },
            { account: r.cr1, debitPaise: "0", creditPaise: first.toString(), ...pid(r.cr1) },
            {
              account: r.cr2,
              debitPaise: "0",
              creditPaise: (r.total - first).toString(),
              ...pid(r.cr2),
            },
          ],
        },
        r.m,
      );
    });
}

/** Any voucher type (purchases/sales from STORE). */
export function anyVoucher(godownId: string): fc.Arbitrary<Voucher> {
  return fc.oneof(
    purchaseArb(godownId),
    saleArb(godownId),
    moneyArb(godownId),
    expenseArb(godownId),
    loadAgentArb(godownId),
    tripArb(godownId),
    contraArb(godownId),
    stockAdjustArb(godownId),
    settlementArb(godownId),
    dayCloseArb(godownId),
    openingArb(godownId),
    journalArb(godownId),
  );
}

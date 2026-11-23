/**
 * Property-based tests (requirement.md §6.5), 1000 runs each.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { verifyVoucher } from "@/domain/calc/recompute";
import { formatScaled } from "@/domain/decimal";
import { formatPaise, parseRupees } from "@/domain/money";
import {
  accountBalance,
  partyBalance,
  postLedger,
  replay,
  toLedgerLineDocs,
  trialBalance,
  type PostingContext,
} from "@/domain/posting";
import type { Voucher } from "@/domain/schemas/vouchers";
import { formatKgNumber, parseKg } from "@/domain/weight";
import { mk } from "../helpers/factory";
import {
  anyVoucher,
  meta,
  openingArb,
  PARTIES,
  purchaseArb,
  saleArb,
  stockAdjustArb,
  tradeLine,
  VARIETIES,
} from "./arbitraries";

const RUNS = { numRuns: 1000 };
const GODOWNS = ["GA", "GB"] as const;

const ctxArb: fc.Arbitrary<PostingContext> = fc
  .record({
    qty: fc.bigInt({ min: -1_000_000n, max: 100_000_000n }),
    value: fc.bigInt({ min: 0n, max: 10_000_000_000n }),
  })
  .map(({ qty, value }) => ({ position: () => ({ qtyG: qty, valuePaise: value }) }));

/** Independent model of how each voucher moves party balances (NOT using postLedger). */
function partyEffects(v: Voucher): Array<[string, bigint]> {
  if (v.status === "void") return [];
  switch (v.type) {
    case "PURCHASE":
      return [[v.partyId, -BigInt(v.totalPaise)]];
    case "SALE": {
      const out: Array<[string, bigint]> = [[v.partyId, BigInt(v.totalPaise)]];
      const f = BigInt(v.delivery?.amountPaise ?? "0");
      const t = v.delivery?.transporterPartyId;
      if (f > 0n && v.delivery?.payer === "US" && t) out.push([t, -f]);
      if (f > 0n && v.delivery?.payer === "MILL") out.push([v.partyId, -f]); // transporter nets to zero
      return out;
    }
    case "PAYMENT":
      return [[v.partyId, BigInt(v.amountPaise)]];
    case "RECEIPT":
      return [[v.partyId, -(BigInt(v.amountPaise) + BigInt(v.tdsPaise ?? "0"))]];
    case "EXPENSE":
      return v.onCredit && v.payeePartyId ? [[v.payeePartyId, -BigInt(v.amountPaise)]] : [];
    case "LOAD": {
      if (v.mode !== "AGENT" || !v.commission) return [];
      const payer = v.commission.payer === "MILL" ? v.toMillPartyId : v.fromPartyId!;
      return [[payer, BigInt(v.commission.amountPaise)]];
    }
    case "TRIP": {
      const out: Array<[string, bigint]> = [];
      if (!v.ownTradeLoadId && v.hirerPartyId) out.push([v.hirerPartyId, BigInt(v.freightPaise)]);
      if (v.hirerPartyId) out.push([v.hirerPartyId, -BigInt(v.advanceReceivedPaise ?? "0")]);
      for (const e of v.expenses)
        if (e.creditPartyId) out.push([e.creditPartyId, -BigInt(e.amountPaise)]);
      return out;
    }
    case "CONTRA":
      return v.kind === "CHEQUE_BOUNCE" && v.partyId ? [[v.partyId, BigInt(v.amountPaise)]] : [];
    case "MILL_SETTLEMENT":
      return [[v.partyId, BigInt(v.differencePaise)]];
    case "OPENING":
      return v.items
        .filter((i) => i.kind === "PARTY")
        .map((i) => [i.refId!, BigInt(i.amountPaise)] as [string, bigint]);
    case "JOURNAL":
      return v.lines
        .filter((l) => l.account.startsWith("PARTY:"))
        .map(
          (l) =>
            [l.account.slice(6), BigInt(l.debitPaise) - BigInt(l.creditPaise)] as [string, bigint],
        );
    default:
      return [];
  }
}

/** Paddy transfer from GA to GB: SALE in GA + PURCHASE in GB, one shared groupId. */
const transferArb = fc.record({ m: meta("GA"), l: tradeLine }).map(({ m, l }) => {
  const groupId = `grp-${m.createdAt}-${l.grossG}`;
  const sale = mk(
    "SALE",
    {
      partyId: "GODOWN_PARTY_B",
      vehicleNumber: "X",
      source: "STORE",
      lines: [l],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      totalPaise: "0",
      duePaise: "0",
      settlementStatus: "PENDING",
      groupId,
    },
    m,
  );
  const purchase = mk(
    "PURCHASE",
    {
      partyId: "GODOWN_PARTY_A",
      storeAt: "STORE",
      lines: [l],
      charges: [],
      roundToRupee: false,
      roundOffPaise: "0",
      totalPaise: "0",
      groupId,
    },
    { ...m, godownId: "GB" },
  );
  return [sale, purchase] as Voucher[];
});

const stockOps = fc
  .array(
    fc.oneof(
      ...GODOWNS.flatMap((g) => [
        purchaseArb(g).map((v) => [v] as Voucher[]),
        saleArb(g).map((v) => [v] as Voucher[]),
        stockAdjustArb(g).map((v) => [v] as Voucher[]),
        openingArb(g).map((v) => [v] as Voucher[]),
      ]),
      transferArb,
    ),
    { maxLength: 20 },
  )
  .map((groups) => groups.flat());

function expectedStoreQty(
  vouchers: readonly Voucher[],
  godownId: string,
  varietyId: string,
): bigint {
  let q = 0n;
  for (const v of vouchers) {
    if (v.godownId !== godownId || v.status === "void") continue;
    if (v.type === "PURCHASE" && v.storeAt === "STORE")
      for (const l of v.lines) if (l.varietyId === varietyId) q += BigInt(l.netG);
    if (v.type === "SALE" && v.source === "STORE")
      for (const l of v.lines) if (l.varietyId === varietyId) q -= BigInt(l.netG);
    if (v.type === "STOCK_ADJUST")
      for (const l of v.lines) if (l.varietyId === varietyId) q += BigInt(l.qtyG);
    if (v.type === "OPENING")
      for (const i of v.items)
        if (i.kind === "STOCK" && i.varietyId === varietyId) q += BigInt(i.qtyG ?? "0");
  }
  return q;
}

function positions(vouchers: readonly Voucher[]) {
  const { book } = replay(vouchers);
  return GODOWNS.flatMap((g) =>
    VARIETIES.flatMap((v) => [book.total(g, v, "STORE"), book.total(g, v, "TRANSIT")]),
  );
}

describe("property: postLedger is always balanced", () => {
  it("Σ debit == Σ credit for random valid vouchers of every type (any stock position)", () => {
    fc.assert(
      fc.property(anyVoucher("GA"), ctxArb, (v, ctx) => {
        expect(trialBalance(postLedger(v, ctx)).balanced).toBe(true);
        expect(verifyVoucher(v)).toEqual([]);
      }),
      RUNS,
    );
  });
});

describe("property: party balances", () => {
  it("balance from ledger lines == balance from replaying voucher effects", () => {
    fc.assert(
      fc.property(fc.array(anyVoucher("GA"), { maxLength: 25 }), (vouchers) => {
        const { results } = replay(vouchers);
        const lines = results.flatMap((r) => toLedgerLineDocs(r.voucher, r.lines));
        expect(trialBalance(lines).balanced).toBe(true);
        const model = new Map<string, bigint>();
        for (const v of vouchers)
          for (const [p, a] of partyEffects(v)) model.set(p, (model.get(p) ?? 0n) + a);
        for (const p of [...PARTIES, ...model.keys()]) {
          expect(partyBalance(lines, p)).toBe(model.get(p) ?? 0n);
        }
      }),
      RUNS,
    );
  });
});

describe("property: stock", () => {
  it("quantities per (godown, variety) match; STOCK ledger == Σ move values; godowns isolated", () => {
    fc.assert(
      fc.property(stockOps, (vouchers) => {
        const { results, book } = replay(vouchers);
        for (const g of GODOWNS) {
          for (const variety of VARIETIES) {
            expect(book.total(g, variety, "STORE").qtyG).toBe(
              expectedStoreQty(vouchers, g, variety),
            );
          }
          const lines = results.filter((r) => r.voucher.godownId === g).flatMap((r) => r.lines);
          const moveValue = results
            .filter((r) => r.voucher.godownId === g)
            .flatMap((r) => r.moves)
            .reduce((s, m) => s + m.valuePaise, 0n);
          expect(accountBalance(lines, "STOCK")).toBe(moveValue);
          // Isolation: replaying only this godown's vouchers gives identical positions.
          const alone = replay(vouchers.filter((v) => v.godownId === g)).book;
          for (const variety of VARIETIES) {
            expect(alone.total(g, variety, "STORE")).toEqual(book.total(g, variety, "STORE"));
          }
        }
      }),
      RUNS,
    );
  });

  it("voiding a voucher restores the exact previous state", () => {
    fc.assert(
      fc.property(
        stockOps.filter((v) => v.length > 0),
        fc.nat(),
        (vouchers, pick) => {
          const k = pick % vouchers.length;
          const withVoid = vouchers.map((v, i) =>
            i === k ? ({ ...v, status: "void", rev: v.rev + 1 } as Voucher) : v,
          );
          const without = vouchers.filter((_, i) => i !== k);
          expect(positions(withVoid)).toEqual(positions(without));
        },
      ),
      RUNS,
    );
  });
});

describe("property: edit then edit back", () => {
  it("re-applying the original content after an edit gives an identical ledger", () => {
    fc.assert(
      fc.property(
        fc.array(anyVoucher("GA"), { minLength: 1, maxLength: 15 }),
        fc.nat(),
        anyVoucher("GA"),
        (vouchers, pick, other) => {
          const k = pick % vouchers.length;
          const original = vouchers[k]!;
          const edited = {
            ...other,
            _id: original._id,
            createdAt: original.createdAt,
            date: original.date,
            rev: original.rev + 1,
          } as Voucher;
          const back = { ...original, rev: original.rev + 2 } as Voucher;
          const seqEdited = vouchers.map((v, i) => (i === k ? edited : v));
          const seqBack = vouchers.map((v, i) => (i === k ? back : v));
          // The intermediate edit is applied (and may change later COGS), then reverted.
          replay(seqEdited);
          const a = replay(vouchers).results.map((r) => r.lines);
          const b = replay(seqBack).results.map((r) => r.lines);
          expect(b).toEqual(a);
        },
      ),
      RUNS,
    );
  });
});

describe("property: parse ⇄ format round-trips", () => {
  it("money in both digit styles", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000_000_000_00n, max: 10_000_000_000_00n }),
        fc.constantFrom("bn" as const, "en" as const),
        (p, digits) => {
          const s = formatPaise(p, { digits });
          expect(parseRupees(s, { allowNegative: true })).toEqual({ ok: true, value: p });
          expect(parseRupees(formatScaled(p, 2), { allowNegative: true })).toEqual({
            ok: true,
            value: p,
          });
        },
      ),
      RUNS,
    );
  });

  it("weight (kg, 3 decimals) in both digit styles", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000_000_000n }),
        fc.constantFrom("bn" as const, "en" as const),
        (g, digits) => {
          expect(parseKg(formatKgNumber(g, digits))).toEqual({ ok: true, value: g });
        },
      ),
      RUNS,
    );
  });
});

/**
 * Property tests at the Dexie stored-lines level (carried over from Phase 1):
 *  - any sequence of create / edit / void across two godowns leaves stored ledger lines and
 *    stock moves EXACTLY equal to a full replay of the stored vouchers, every godown balanced,
 *    and dailyAgg equal to a rebuild;
 *  - edit then edit back (rev+1, rev+2) restores the original postings.
 */
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { createVoucher, editVoucher, rebuildDailyAgg, voidVoucher } from "@/client/repo";
import { godownTrialBalance } from "@/client/queries/ledger";
import { addDays } from "@/domain/dates";
import { replay, toLedgerLineDocs, toStockMoveDocs } from "@/domain/posting/replay";
import {
  TODAY,
  paymentDraft,
  purchaseDraft,
  saleDraft,
  setupDevice,
  type LocalGodown,
} from "../helpers/local";

const QTL = 100_000n;
let W: Record<string, LocalGodown>;

beforeEach(async () => {
  W = await setupDevice("repo-prop", {
    godowns: [
      { id: "GA", code: "RP" },
      { id: "GB", code: "SP" },
    ],
  });
});

type Step =
  | { k: "purchase" | "sale" | "payment"; g: "GA" | "GB"; qtl: number; rate: number; day: number }
  | { k: "edit"; pick: number; qtl: number; rate: number; day: number }
  | { k: "void"; pick: number };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    k: fc.constantFrom("purchase" as const, "sale" as const, "payment" as const),
    g: fc.constantFrom("GA" as const, "GB" as const),
    qtl: fc.integer({ min: 1, max: 40 }),
    rate: fc.integer({ min: 150_000, max: 320_000 }),
    day: fc.integer({ min: 0, max: 5 }),
  }),
  fc.record({
    k: fc.constant("edit" as const),
    pick: fc.nat(),
    qtl: fc.integer({ min: 1, max: 40 }),
    rate: fc.integer({ min: 150_000, max: 320_000 }),
    day: fc.integer({ min: 0, max: 5 }),
  }),
  fc.record({ k: fc.constant("void" as const), pick: fc.nat() }),
);

function draftFor(type: string, g: LocalGodown, qtl: number, rate: number, day: number) {
  const date = addDays(TODAY, -day);
  const sw = g.variety.SWARNA!;
  if (type === "PURCHASE")
    return purchaseDraft(g.farmer, sw, BigInt(qtl) * QTL, BigInt(rate), date);
  if (type === "SALE") return saleDraft(g.mill, sw, BigInt(qtl) * QTL, BigInt(rate), date);
  return paymentDraft(g.farmer, BigInt(qtl) * 1000n, date);
}

const canonL = (
  ls: Array<{ _id: string; account: string; debitPaise: string; creditPaise: string }>,
) => ls.map((l) => `${l._id}|${l.account}|${l.debitPaise}|${l.creditPaise}`).sort();
const canonM = (ms: Array<{ _id: string; qtyG: string; valuePaise: string }>) =>
  ms.map((m) => `${m._id}|${m.qtyG}|${m.valuePaise}`).sort();

describe("stored derived rows == replay", () => {
  it("holds for random create/edit/void sequences across two godowns", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 12 }), async (steps) => {
        W = await setupDevice("repo-prop", {
          godowns: [
            { id: "GA", code: "RP" },
            { id: "GB", code: "SP" },
          ],
        });
        for (const s of steps) {
          if (s.k !== "edit" && s.k !== "void") {
            const type = s.k.toUpperCase();
            await createVoucher(s.g, draftFor(type, W[s.g]!, s.qtl, s.rate, s.day));
            continue;
          }
          const active = await db()
            .vouchers.filter((v) => v.status === "active")
            .toArray();
          if (active.length === 0) continue;
          const v = active[s.pick % active.length]!;
          if (s.k === "void") await voidVoucher(v.godownId, v._id, "test");
          else
            await editVoucher(
              v.godownId,
              v._id,
              draftFor(v.type, W[v.godownId]!, s.qtl, s.rate, s.day),
            );
        }
        const vouchers = await db().vouchers.toArray();
        const { results } = replay(vouchers);
        const expLines = results.flatMap((r) => toLedgerLineDocs(r.voucher, r.lines));
        const expMoves = results.flatMap((r) => toStockMoveDocs(r.voucher, r.moves));
        expect(canonL(await db().ledgerLines.toArray())).toEqual(canonL(expLines));
        expect(canonM(await db().stockMoves.toArray())).toEqual(canonM(expMoves));
        for (const g of ["GA", "GB"]) expect((await godownTrialBalance(g)).balanced).toBe(true);
        const agg = await db().dailyAgg.toArray();
        await rebuildDailyAgg("GA");
        await rebuildDailyAgg("GB");
        expect(await db().dailyAgg.toArray()).toEqual(agg);
      }),
      { numRuns: 40 },
    );
  });

  it("edit then edit back restores the original stored postings (rev+1, rev+2)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 150_000, max: 320_000 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 150_000, max: 320_000 }),
        async (q1, r1, q2, r2) => {
          W = await setupDevice("repo-prop", { godowns: [{ id: "GA", code: "RP" }] });
          const g = W.GA!;
          const original = draftFor("PURCHASE", g, q1, r1, 0);
          const v = await createVoucher("GA", original);
          const strip = (ls: Array<{ account: string; debitPaise: string; creditPaise: string }>) =>
            ls.map((l) => `${l.account}|${l.debitPaise}|${l.creditPaise}`).sort();
          const before = strip(await db().ledgerLines.toArray());
          const movesBefore = (await db().stockMoves.toArray()).map(
            (m) => `${m.qtyG}|${m.valuePaise}`,
          );
          await editVoucher("GA", v._id, draftFor("PURCHASE", g, q2, r2, 1));
          const back = await editVoucher("GA", v._id, original);
          expect(back.rev).toBe(3);
          expect(strip(await db().ledgerLines.toArray())).toEqual(before);
          expect((await db().stockMoves.toArray()).map((m) => `${m.qtyG}|${m.valuePaise}`)).toEqual(
            movesBefore,
          );
        },
      ),
      { numRuns: 40 },
    );
  });
});

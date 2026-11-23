/**
 * Party merge (owner, online server batch) and reminder sync.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { partyBalance } from "@/client/queries/ledger";
import { mergePartiesOnline } from "@/client/party/merge";
import { savePurchase, upsertMaster, type VoucherDraft } from "@/client/repo";
import { addDays } from "@/domain/dates";
import { repoint } from "@/server/partyMerge";
import { closeMongo, cols, getDb } from "@/server/db";
import { createGodown } from "@/server/godownService";
import { createUser } from "@/server/users";
import { TODAY, purchaseDraft } from "../helpers/local";
import { TestDevice, nonZero, serverBalances, useTestServer } from "../helpers/server";

const OWNER = { phone: "9830000301", password: "owner-pass-1" };
const QTL = 100_000n;
let GA: string;
const od = new TestDevice("merge-owner");

beforeAll(async () => {
  useTestServer("merge");
  const mdb = await getDb();
  const owner = await createUser(mdb, { name: "Owner", ...OWNER, isOwner: true });
  GA = (await createGodown(mdb, owner, { name: "Rampur", code: "RP" }))._id;
  await od.reset();
  await od.login(OWNER.phone, OWNER.password);
  await od.sync();
});

afterAll(async () => {
  await closeMongo();
});

describe("party merge", () => {
  it("repoint replaces exact ids and PARTY: accounts, never _id", () => {
    expect(
      repoint({ _id: "X", partyId: "X", lines: [{ account: "PARTY:X" }], note: "XY" }, "X", "K"),
    ).toEqual({
      _id: "X",
      partyId: "K",
      lines: [{ account: "PARTY:K" }],
      note: "XY",
    });
  });

  it("re-points vouchers, combines balances, voids the duplicate; reminders sync", async () => {
    od.use();
    const sw = (await db()
      .varieties.where("godownId")
      .equals(GA)
      .filter((v) => v.systemKey === "SWARNA")
      .first())!._id;
    const keep = await upsertMaster(GA, "party", { name: "Rahim Sheikh", roles: ["farmer"] });
    const drop = await upsertMaster(GA, "party", { name: "রহিম শেখ", roles: ["farmer"] });
    await savePurchase(GA, purchaseDraft(keep._id, sw, 2n * QTL, 200000n));
    await savePurchase(GA, {
      ...purchaseDraft(drop._id, sw, 3n * QTL, 200000n),
      dueDate: addDays(TODAY, 5),
    } as VoucherDraft);
    await od.sync();
    const mdb = await getDb();
    expect(await cols(mdb).reminders.countDocuments({ godownId: GA, partyId: drop._id })).toBe(1);

    const res = await mergePartiesOnline(GA, keep._id, drop._id);
    expect(res.vouchers).toBe(1);
    await od.sync();
    expect(await partyBalance(GA, keep._id)).toBe(-1000000n);
    expect(await partyBalance(GA, drop._id)).toBe(0n);
    expect((await db().parties.get(drop._id))?.status).toBe("void");
    expect((await db().parties.get(drop._id))?.mergedInto).toBe(keep._id);
    expect((await db().reminders.toArray()).every((r) => r.partyId !== drop._id)).toBe(true);
    expect(nonZero(await serverBalances(GA))).toEqual(
      nonZero(await (await import("@/client/queries/ledger")).godownBalances(GA)),
    );
  });
});

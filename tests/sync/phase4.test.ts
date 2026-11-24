/**
 * Phase 4 server behaviour through real route handlers: DAY_CLOSE publishes the day lock and the
 * late-entry flag, transfers publish pending receipts to the receiving godown (accept / cancel),
 * paired transfers are guarded, and the godown profile can be edited by the owner.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authedCall } from "@/client/auth/session";
import { db } from "@/client/db/dexie";
import { setClockForTests } from "@/client/clock";
import { accountBalance } from "@/client/queries/ledger";
import {
  acceptTransfer,
  closeDay,
  createVoucher,
  saveTransfer,
  unlockDay,
  voidTransfer,
} from "@/client/repo";
import { ACC } from "@/domain/posting/accounts";
import type { Godown } from "@/domain/schemas";
import { closeMongo, cols, getDb, type UserDoc } from "@/server/db";
import { createGodown } from "@/server/godownService";
import { createUser } from "@/server/users";
import { expenseDraft } from "../helpers/local";
import { TestDevice, useTestServer } from "../helpers/server";

const OWNER = { phone: "9830000201", password: "owner-pass-4" };
const MA = { phone: "9830000202", password: "manager-a-pass" };
const MB = { phone: "9830000203", password: "manager-b-pass" };

let owner: UserDoc;
let GA: string;
let GB: string;
const od = new TestDevice("p4-owner");
const ma = new TestDevice("p4-ma");
const mb = new TestDevice("p4-mb");

const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  useTestServer("p4");
  const mdb = await getDb();
  owner = await createUser(mdb, { name: "Owner", ...OWNER, isOwner: true });
  GA = (await createGodown(mdb, owner, { name: "Rampur", code: "RP" }))._id;
  GB = (await createGodown(mdb, owner, { name: "Sonapur", code: "SP" }))._id;
  await createUser(mdb, {
    name: "MA",
    ...MA,
    // Sees Sonapur (viewer) but can only write Rampur: transfers to Sonapur are unpaired.
    godownAccess: [
      { godownId: GA, role: "manager" },
      { godownId: GB, role: "viewer" },
    ],
  });
  await createUser(mdb, { name: "MB", ...MB, godownAccess: [{ godownId: GB, role: "manager" }] });
  for (const [dev, cred] of [
    [od, OWNER],
    [ma, MA],
    [mb, MB],
  ] as const) {
    await dev.reset();
    await dev.login(cred.phone, cred.password);
    await dev.sync();
  }
});

afterAll(async () => {
  setClockForTests(null);
  await closeMongo();
});

describe("day close on the server", () => {
  it("publishes the lock; a late offline entry is accepted and flagged; unlock reopens", async () => {
    const date = today();
    // MA writes an expense OFFLINE before the close (not pushed yet).
    ma.use();
    ma.offline = true;
    await createVoucher(GA, expenseDraft(10_000n, date));
    // Owner closes the day (a few seconds later) and syncs.
    od.use();
    setClockForTests(() => new Date(Date.now() + 5_000));
    await closeDay(GA, { date, countedCashPaise: 0n });
    setClockForTests(null);
    await od.sync();
    const mdb = await getDb();
    const ds = await cols(mdb).dayStatus.findOne({ _id: `${GA}:${date}` });
    expect(ds?.closed).toBe(true);

    // MA comes online: the late entry is accepted and the day flagged.
    ma.use();
    ma.offline = false;
    await ma.sync();
    expect(await db().outbox.count()).toBe(0);
    const flagged = await cols(mdb).dayStatus.findOne({ _id: `${GA}:${date}` });
    expect(flagged?.lateEntry).toBe(true);
    expect((await db().dayStatus.get(`${GA}:${date}`))?.closed).toBe(true);

    // A new entry by MA for the closed day is refused locally.
    await expect(createVoucher(GA, expenseDraft(5_000n, date))).rejects.toMatchObject({
      code: "DAY_LOCKED",
    });

    // The owner sees the flag, unlocks (audited) and the lock is lifted for everyone.
    od.use();
    await od.sync();
    expect((await db().dayStatus.get(`${GA}:${date}`))?.lateEntry).toBe(true);
    await unlockDay(GA, date, "late entry: recount");
    await od.sync();
    expect((await cols(mdb).dayStatus.findOne({ _id: `${GA}:${date}` }))?.closed).toBe(false);
    expect(
      await cols(mdb).audit.countDocuments({ godownId: GA, action: "void", entity: "voucher" }),
    ).toBeGreaterThan(0);
    ma.use();
    await ma.sync();
    await createVoucher(GA, expenseDraft(5_000n, date));
    await ma.sync();
    expect(await db().outbox.count()).toBe(0);
  });
});

describe("inter-godown transfer on the server", () => {
  it("unpaired SEND → pending receipt in B only; B accepts; cancel on void", async () => {
    ma.use();
    const t = await saveTransfer({
      kind: "MONEY",
      date: today(),
      fromGodownId: GA,
      toGodownId: GB,
      amountPaise: 250_000n,
      from: { mode: "CASH" },
      to: { mode: "CASH" },
    });
    expect(t.receive).toBeUndefined();
    await ma.sync();
    // MA only views B: it sees the pending receipt but can't accept it.
    expect((await db().transfers.get(t.groupId))?.status).toBe("pending");
    await expect(acceptTransfer(GB, t.groupId, { mode: "CASH" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    mb.use();
    await mb.sync();
    const pending = await db().transfers.get(t.groupId);
    expect(pending?.status).toBe("pending");
    expect(pending?.godownId).toBe(GB);
    expect(pending?.amountPaise).toBe("250000");
    await acceptTransfer(GB, t.groupId, { mode: "CASH" });
    await mb.sync();
    expect(await db().outbox.count()).toBe(0);
    expect((await db().transfers.get(t.groupId))?.status).toBe("accepted");
    expect(await accountBalance(GB, ACC.CASH)).toBe(250_000n);

    // The accepted transfer can't be voided by MA alone (no access to B's book).
    ma.use();
    await voidTransfer(GA, t.send._id, "mistake");
    await ma.sync();
    const op = (await db().outbox.toArray())[0];
    expect(op?.status).toBe("error");
    expect(op?.lastError).toBe("TRANSFER_NEEDS_BOTH");
  });

  it("a pending transfer voided by the sender is cancelled for the receiver", async () => {
    od.use();
    await od.sync();
    // Drop MA's failed op from the previous test (sender side).
    ma.use();
    await db().outbox.clear();
    await ma.sync();
    const t = await saveTransfer({
      kind: "MONEY",
      date: today(),
      fromGodownId: GA,
      toGodownId: GB,
      amountPaise: 100_000n,
      from: { mode: "CASH" },
      to: { mode: "CASH" },
    });
    await ma.sync();
    await voidTransfer(GA, t.send._id, "not needed");
    await ma.sync();
    mb.use();
    await mb.sync();
    expect((await db().transfers.get(t.groupId))?.status).toBe("cancelled");
  });

  it("owner writes both books in one go (paired): no pending record", async () => {
    od.use();
    await od.sync();
    const t = await saveTransfer({
      kind: "MONEY",
      date: today(),
      fromGodownId: GB,
      toGodownId: GA,
      amountPaise: 50_000n,
      from: { mode: "CASH" },
      to: { mode: "CASH" },
    });
    expect(t.receive).toBeDefined();
    await od.sync();
    expect(await db().outbox.count()).toBe(0);
    const mdb = await getDb();
    expect(await cols(mdb).transfers.findOne({ _id: t.groupId })).toBeNull();
    expect(await cols(mdb).vouchers.countDocuments({ groupId: t.groupId })).toBe(2);
  });
});

describe("godown profile", () => {
  it("owner edits the letterhead; the change reaches devices; code is immutable", async () => {
    od.use();
    const res = await authedCall<{ godown: Godown }>("/api/godowns/update", {
      body: {
        godownId: GA,
        name: "Rampur",
        firmName: "Maa Tara Traders",
        proprietor: "K. Ghosh",
        receiptLanguage: "both",
      },
    });
    expect(res.godown.code).toBe("RP");
    expect(res.godown.firmName).toBe("Maa Tara Traders");
    await od.sync();
    expect((await db().godowns.get(GA))?.receiptLanguage).toBe("both");
    ma.use();
    await expect(
      authedCall("/api/godowns/update", {
        body: { godownId: GA, name: "X", receiptLanguage: "bn" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

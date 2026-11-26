/**
 * Phase 5 server features through the real route handlers: web-push digest + cron secret,
 * integrity endpoint vs device totals, owner-only admin (crafted requests from a user without
 * access get nothing), backup → restore round-trip with identical ledger totals, users/prefs,
 * client error upload and sync-log compaction.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runIntegrity } from "@/client/admin";
import { authedCall } from "@/client/auth/session";
import { db } from "@/client/db/dexie";
import { getSession } from "@/client/db/meta";
import { reportClientError, uploadClientErrors } from "@/client/diagnostics";
import { createManualReminder, saveDoc, upsertMaster } from "@/client/repo";
import { addDays, todayIST } from "@/domain/dates";
import { accountTotals } from "@/domain/integrity";
import type { Backup } from "@/server/admin";
import { restoreBackup } from "@/server/admin";
import { fromDbLine } from "@/server/convert";
import { closeMongo, cols, getDb, getMongoClient, type UserDoc } from "@/server/db";
import { createGodown } from "@/server/godownService";
import { sendDigest } from "@/server/push";
import { cronDaily } from "@/server/routes/admin";
import { createBusinessWithOwner } from "@/server/business";
import { createUser } from "@/server/users";
import { expenseDraft, paymentDraft, purchaseDraft } from "../helpers/local";
import { TestDevice, useTestServer } from "../helpers/server";

const QTL = 100_000n;
const OWNER = { phone: "9830000301", password: "owner-pass-5" };
const MA = { phone: "9830000302", password: "manager-a-5" };

let owner: UserDoc;
let GA: string;
let GB: string;
const od = new TestDevice("p5-owner");
const ma = new TestDevice("p5-ma");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

async function swarna(godownId: string): Promise<string> {
  return (await db()
    .varieties.where("godownId")
    .equals(godownId)
    .filter((v) => v.systemKey === "SWARNA")
    .first())!._id;
}

beforeAll(async () => {
  useTestServer("p5");
  process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";
  const mdb = await getDb();
  owner = (
    await createBusinessWithOwner(mdb, {
      ownerName: "Owner",
      mobile: OWNER.phone,
      password: OWNER.password,
      businessName: "P5 Business",
    })
  ).owner;
  GA = (await createGodown(mdb, owner, { name: "Rampur", code: "RP" }))._id;
  GB = (await createGodown(mdb, owner, { name: "Sonapur", code: "SP" }))._id;
  await createUser(mdb, {
    businessId: owner.businessId,
    name: "MA",
    ...MA,
    godownAccess: [{ godownId: GA, role: "manager" }],
  });
  await od.reset();
  await od.login(OWNER.phone, OWNER.password);
  await od.sync();
  const fa = await upsertMaster(GA, "party", { name: "Farmer A", roles: ["FARMER"] });
  const fb = await upsertMaster(GB, "party", { name: "Farmer B", roles: ["FARMER"] });
  const pa = await saveDoc(GA, purchaseDraft(fa._id, await swarna(GA), 10n * QTL, 200_000n));
  await saveDoc(
    GA,
    paymentDraft("OUT", 500000n, { type: "PURCHASE", id: pa._id }, { partyId: fa._id }),
  );
  // A purchase of 3 days ago due yesterday: an automatic (derived) reminder, counted as overdue
  // in the digest. (A due date may not be before its deal, D54.)
  await saveDoc(GB, {
    ...purchaseDraft(fb._id, await swarna(GB), 4n * QTL, 210_000n, addDays(todayIST(), -3)),
    dueDate: addDays(todayIST(), -1),
  });
  await saveDoc(GB, expenseDraft(30_000n));
  await createManualReminder(GA, { title: "Call mill A", dueDate: today() });
  await createManualReminder(GB, { title: "Call mill B", dueDate: today() });
  await od.sync();
  await ma.reset();
  await ma.login(MA.phone, MA.password);
  await ma.sync();
});

afterAll(async () => {
  await closeMongo();
});

describe("web push digest + cron", () => {
  it("each user gets one digest for the godowns they can access; once per day; 410 removes", async () => {
    od.use();
    await authedCall("/api/push/subscribe", {
      body: { endpoint: "https://push.example/owner", keys: { p256dh: "pk-owner", auth: "a1" } },
    });
    ma.use();
    await authedCall("/api/push/subscribe", {
      body: { endpoint: "https://push.example/ma", keys: { p256dh: "pk-ma", auth: "a2" } },
    });
    const mdb = await getDb();
    const sent: Array<{ endpoint: string; payload: { title: string; body: string } }> = [];
    const r = await sendDigest(mdb, {
      force: true,
      sender: async (sub, payload) => {
        if (sub.endpoint.endsWith("/gone"))
          throw Object.assign(new Error("gone"), { statusCode: 410 });
        sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      },
    });
    expect(r.users).toBe(2);
    const toOwner = sent.find((s) => s.endpoint.endsWith("/owner"))!;
    const toMa = sent.find((s) => s.endpoint.endsWith("/ma"))!;
    expect(toOwner.payload.body).toContain("Rampur");
    expect(toOwner.payload.body).toContain("Sonapur");
    expect(toMa.payload.body).toContain("Rampur");
    expect(toMa.payload.body).not.toContain("Sonapur"); // godown isolation in push
    expect(toOwner.payload.title).toBe("ধান গোলা — আজকের রিমাইন্ডার");
    expect(toOwner.payload.body).toContain("Sonapur: আজ 1টি, তারিখ পেরিয়েছে 1টি");
    // Not again today without force.
    // (Evening of the same IST day, so the "not before the digest hour" guard never interferes.)
    const evening = new Date(`${todayIST()}T20:00:00+05:30`);
    expect((await sendDigest(mdb, { now: evening, sender: async () => {} })).skipped).toBe(
      "ALREADY_SENT",
    );
    // An expired subscription is removed.
    await cols(mdb).pushSubscriptions.insertOne({
      _id: "https://push.example/gone",
      userId: owner._id,
      deviceId: "x",
      keys: { p256dh: "p", auth: "a" },
      createdAt: new Date().toISOString(),
    });
    const r2 = await sendDigest(mdb, {
      force: true,
      sender: async (s) => {
        if (s.endpoint.endsWith("/gone"))
          throw Object.assign(new Error("gone"), { statusCode: 410 });
      },
    });
    expect(r2.removed).toBe(1);
  });

  it("/api/cron/daily needs the secret header", async () => {
    const no = await cronDaily(new Request("http://test/api/cron/daily", { method: "POST" }));
    expect(no.status).toBe(401);
    const bad = await cronDaily(
      new Request("http://test/api/cron/daily", {
        method: "POST",
        headers: { "x-cron-secret": "nope" },
      }),
    );
    expect(bad.status).toBe(401);
    const ok = await cronDaily(
      new Request("http://test/api/cron/daily", {
        method: "POST",
        headers: { "x-cron-secret": process.env.CRON_SECRET! },
      }),
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { integrity: number };
    expect(body.integrity).toBe(2);
    const summary = await cols(await getDb()).integritySummary.findOne({ _id: GA });
    expect(summary?.balanced).toBe(true);
  });
});

describe("integrity (§6.6)", () => {
  it("server per-account totals equal the device's; no re-post mismatches", async () => {
    od.use();
    const rep = await runIntegrity(GA, { compareServer: true });
    expect(rep.trial.balanced).toBe(true);
    expect(rep.repostMismatches).toEqual([]);
    expect(rep.server?.diffs).toEqual([]);
    expect(rep.server?.serverRepostMismatches).toEqual([]);
    // A tampered device line is reported as a difference.
    const line = await db()
      .ledgerLines.where("[godownId+date]")
      .between([GA, ""], [GA, "￿"])
      .first();
    await db().ledgerLines.put({
      ...line!,
      debitPaise: (BigInt(line!.debitPaise) + 100n).toString(),
    });
    const bad = await runIntegrity(GA, { compareServer: true });
    expect(bad.trial.balanced).toBe(false);
    expect(bad.server?.diffs.map((d) => d.account)).toContain(line!.account);
    await db().ledgerLines.put(line!);
  });
});

describe("owner-only admin & crafted requests (§14)", () => {
  it("a manager of A gets nothing of B (or any admin data) from integrity, backup, users, storage", async () => {
    ma.use();
    for (const path of [
      `/api/admin/integrity?godownId=${GB}`,
      `/api/admin/integrity?godownId=${GA}`,
      `/api/admin/backup?godownId=${GB}`,
      "/api/admin/backup",
      "/api/admin/users",
      "/api/admin/storage",
      "/api/admin/errors",
    ]) {
      await expect(authedCall(path), path).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      authedCall("/api/admin/users", {
        body: { name: "X", phone: "9830000999", password: "secret1", godownAccess: [] },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authedCall("/api/admin/restore", { body: { format: "x" } })).rejects.toMatchObject(
      {
        code: "FORBIDDEN",
      },
    );
  });

  it("owner manages users: add with access, the user logs in and sees only that godown", async () => {
    od.use();
    const { user } = await authedCall<{ user: { _id: string } }>("/api/admin/users", {
      body: {
        name: "Entry B",
        phone: "9830000303",
        password: "entry-b-pass",
        godownAccess: [{ godownId: GB, role: "entry" }],
      },
    });
    const list = await authedCall<{ users: Array<{ _id: string; passwordHash?: string }> }>(
      "/api/admin/users",
    );
    expect(list.users.some((u) => u._id === user._id)).toBe(true);
    expect(list.users.every((u) => u.passwordHash === undefined)).toBe(true);
    const eb = new TestDevice("p5-eb");
    await eb.reset();
    await eb.login("9830000303", "entry-b-pass");
    await eb.sync();
    expect((await db().godowns.toArray()).map((g) => g._id)).toEqual([GB]);
  });

  it("my prefs follow the user record; password change needs the current password", async () => {
    od.use();
    await authedCall("/api/me/prefs", { body: { language: "en", digits: "en", name: "Owner Ji" } });
    await od.sync();
    expect((await getSession())?.user.language).toBe("en");
    expect((await getSession())?.user.name).toBe("Owner Ji");
    await expect(
      authedCall("/api/me/password", { body: { current: "wrong-pass", next: "new-pass-1" } }),
    ).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    await authedCall("/api/me/prefs", { body: { language: "bn", digits: "bn" } });
  });

  it("client error reports upload on sync and the owner can list them", async () => {
    ma.use();
    await reportClientError({ route: "/purchase/new", message: "boom", stack: "at x" });
    expect(await uploadClientErrors()).toBe(1);
    expect(await db().clientErrors.count()).toBe(0);
    od.use();
    const { errors } = await authedCall<{ errors: Array<{ message: string }> }>(
      "/api/admin/errors",
    );
    expect(errors.some((e) => e.message === "boom")).toBe(true);
  });
});

describe("backup / restore (§17.2)", () => {
  it("backup all → restore into an EMPTY database → identical ledger totals per godown", async () => {
    od.use();
    const backup = await authedCall<Backup>("/api/admin/backup");
    expect(backup.godownIds.sort()).toEqual([GA, GB].sort());
    const src = await getDb();
    const client = await getMongoClient();
    const target = client.db(`p5_restore_${Date.now().toString(36)}`);
    // JSON round trip (the file the owner downloads).
    const counts = await restoreBackup(target, null, JSON.parse(JSON.stringify(backup)) as Backup);
    expect(counts.vouchers).toBe(await cols(src).vouchers.countDocuments({}));
    for (const g of [GA, GB]) {
      const a = accountTotals(
        (await cols(src).ledgerLines.find({ godownId: g }).toArray()).map(fromDbLine),
      );
      const b = accountTotals(
        (await cols(target).ledgerLines.find({ godownId: g }).toArray()).map(fromDbLine),
      );
      expect(b).toEqual(a);
    }
    // Restoring twice (database not empty any more) is refused.
    await expect(restoreBackup(target, null, backup)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await target.dropDatabase();
  });

  it("compaction keeps the latest change per document: a new device still gets everything", async () => {
    od.use();
    const mdb = await getDb();
    const before = await cols(mdb).changelog.countDocuments({});
    const r = await authedCall<{ changelog: number }>("/api/admin/compact", { body: {} });
    expect(r.changelog).toBeGreaterThan(0);
    expect(await cols(mdb).changelog.countDocuments({})).toBe(before - r.changelog);
    const fresh = new TestDevice("p5-fresh");
    await fresh.reset();
    await fresh.login(OWNER.phone, OWNER.password);
    await fresh.sync();
    const lines = await db().ledgerLines.toArray();
    for (const g of [GA, GB]) {
      const server = accountTotals(
        (await cols(mdb).ledgerLines.find({ godownId: g }).toArray()).map(fromDbLine),
      );
      expect(accountTotals(lines.filter((l) => l.godownId === g))).toEqual(server);
    }
  });
});

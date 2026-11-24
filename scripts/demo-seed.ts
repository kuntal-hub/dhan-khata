/**
 * Demo data for client presentations.
 *
 *   pnpm seed:demo --owner-password=<owner password> [--owner-phone=9000000001] [--reset]
 *   pnpm seed:demo --memory            # rehearsal against a throw-away in-memory MongoDB
 *
 * It does NOT write documents into MongoDB by hand. It runs the app's own code: simulated devices
 * (fake IndexedDB) log in through the real auth routes, create masters and ~30 days of vouchers
 * through `src/client/repo`, and push through the real sync routes, so the server recomputes and
 * verifies every voucher (balanced ledgers, stock, day locks, transfers) exactly as in production.
 *
 * Creates two godowns (Rampur = main business, Sonapur = smaller), a manager, an entry-role clerk
 * and a second manager, then verifies the books. `--reset` first removes any previous demo data
 * (godowns RP / SN, an empty "MN" godown, and the demo staff users) but never the owner.
 */
import "fake-indexeddb/auto";
import { existsSync } from "node:fs";
import { updateGodownSettings } from "@/client/repo";
import { stockSummary } from "@/client/queries/stock";
import { godownTrialBalance } from "@/client/queries/ledger";
import { db as localDb } from "@/client/db/dexie";
import { setClockForTests } from "@/client/clock";
import { normalizePhone } from "@/domain/phone";
import { closeMongo, cols, getDb } from "@/server/db";
import { createGodown, updateGodown } from "@/server/godownService";
import { createUser } from "@/server/users";
import { recomputeIntegritySummaries, serverIntegrity, setAppSettings } from "@/server/admin";
import { DemoDevice } from "./demo/harness";
import { at, bankBalance, cashBalance, day, topUpCash } from "./demo/helpers";
import { RAMPUR, SONAPUR, createMasters } from "./demo/masters";
import { rampurStory, type Devices } from "./demo/rampur";
import { sonapurStory } from "./demo/sonapur";
import { Timeline, runTimeline } from "./demo/timeline";

const STAFF_PASSWORD = "Demo@1234";
const STAFF = {
  manager: { name: "সুরেশ পাল", phone: "9830011102" },
  entry: { name: "রাজু বর্মন", phone: "9830011103" },
  snManager: { name: "আনোয়ার হোসেন", phone: "9830011104" },
};
const DEVICE_LABELS = {
  own: "মালিকের ফোন",
  mgr: "সুরেশের ফোন (ম্যানেজার)",
  ent: "রাজুর ফোন (এন্ট্রি)",
  snm: "আনোয়ারের ফোন (সোনাপুর)",
};

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]!] = m[2] ?? "true";
  }
  return out;
}

const log = (s: string) => console.log(s);
/** Paise → "1,23,456" rupees (whole), for the console summary only. */
const rupees = (paise: bigint): string => (paise / 100n).toLocaleString("en-IN");

async function wipeDemo(dbm: Awaited<ReturnType<typeof getDb>>, ownerId: string): Promise<void> {
  const k = cols(dbm);
  const gods = await k.godowns.find({ code: { $in: ["MN", "RP", "SN"] } }).toArray();
  for (const g of gods) {
    const n = await k.vouchers.countDocuments({ godownId: g._id });
    if (g.code === "MN" && n > 0) {
      throw new Error("Godown MN has vouchers; refusing to delete it. Remove it manually if intended.");
    }
  }
  const ids = gods.map((g) => g._id);
  const byGodown = { godownId: { $in: ids } };
  for (const name of [
    "vouchers", "ledgerLines", "stockMoves", "parties", "varieties", "bankAccounts", "vehicles",
    "places", "expenseCategories", "godownSettings", "dayStatus", "transfers", "reminders",
    "accounts", "locations", "audit", "conflicts", "changelog",
  ] as const) {
    await dbm.collection(name).deleteMany(byGodown);
  }
  await k.integritySummary.deleteMany({ _id: { $in: ids } });
  await dbm.collection("changelog").deleteMany({ entity: "godown", entityId: { $in: ids } });
  await k.godowns.deleteMany({ _id: { $in: ids } });

  const phones = Object.values(STAFF).map((s) => normalizePhone(s.phone)!);
  const staff = await k.users.find({ phone: { $in: phones }, _id: { $ne: ownerId } }).toArray();
  const staffIds = staff.map((u) => u._id);
  await k.devices.deleteMany({ userId: { $in: staffIds } });
  await k.refreshTokens.deleteMany({ userId: { $in: staffIds } });
  await dbm.collection("changelog").deleteMany({ entity: "user", entityId: { $in: staffIds } });
  await k.users.deleteMany({ _id: { $in: staffIds } });
  // The owner's simulated demo phone from an earlier run.
  const labels = [DEVICE_LABELS.own];
  const mine = await k.devices.find({ userId: ownerId, label: { $in: labels } }).toArray();
  await k.devices.deleteMany({ _id: { $in: mine.map((d) => d._id) } });
  await k.refreshTokens.deleteMany({ deviceId: { $in: mine.map((d) => d._id) } });
  log(`Removed previous demo data (${gods.length} godown(s), ${staffIds.length} staff user(s)).`);
}

async function main() {
  for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
  process.env.AUTH_COOKIE_INSECURE = "1";
  process.env.DK_QUIET_LOGS = "1";
  const a = args();
  const memory = a.memory === "true";
  const ownerPhone = normalizePhone(a["owner-phone"] ?? "9000000001");
  let ownerPassword = a["owner-password"] ?? process.env.DEMO_OWNER_PASSWORD ?? "";
  let stopMemory: (() => Promise<void>) | null = null;

  if (memory) {
    const { MongoMemoryReplSet } = await import("mongodb-memory-server");
    const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    process.env.MONGODB_URI = rs.getUri();
    process.env.MONGODB_DB = "demo_rehearsal";
    stopMemory = async () => void (await rs.stop());
    ownerPassword = "rehearsal-owner-1";
    log("Rehearsal mode: using a throw-away in-memory MongoDB (nothing touches Atlas).");
  }
  if (!ownerPhone) throw new Error("Invalid --owner-phone");
  if (!ownerPassword) throw new Error("Pass --owner-password=<the owner's password> (or --memory).");

  const dbm = await getDb();
  const k = cols(dbm);
  let owner = await k.users.findOne({ phone: ownerPhone });
  if (!owner) {
    if (!memory) throw new Error(`No owner with phone ${ownerPhone}. Run pnpm seed first.`);
    owner = await createUser(dbm, { name: "Owner", phone: ownerPhone, password: ownerPassword, isOwner: true });
  }
  if (!owner.isOwner) throw new Error("That user is not the owner.");

  const existing = await k.godowns.countDocuments({ code: { $in: ["RP", "SN"] } });
  if (existing > 0 && a.reset !== "true") {
    throw new Error("Demo godowns (RP / SN) already exist. Re-run with --reset to rebuild them.");
  }
  if (a.reset === "true" || (await k.godowns.countDocuments({ code: "MN" })) > 0) await wipeDemo(dbm, owner._id);

  // ── Godowns, staff ─────────────────────────────────────────────────────────
  log("Creating godowns and staff…");
  const rpDoc = await createGodown(dbm, owner, {
    name: "রামপুর গোডাউন",
    nameAlt: "Rampur Godown",
    code: "RP",
    firmName: "মণ্ডল পেডি ট্রেডার্স",
    address: "রামপুরহাট, বীরভূম, পশ্চিমবঙ্গ — ৭৩১২২৪",
    phone: "9832000001",
    receiptLanguage: "both",
  });
  const snDoc = await createGodown(dbm, owner, {
    name: "সোনাপুর গোডাউন",
    nameAlt: "Sonapur Godown",
    code: "SN",
    firmName: "মণ্ডল পেডি ট্রেডার্স — সোনাপুর শাখা",
    address: "সোনাপুর, কান্দি, মুর্শিদাবাদ — ৭৪২১৩৭",
    phone: "9832000002",
    receiptLanguage: "bn",
  });
  for (const [g, gstin] of [[rpDoc, "19AAFPM4521K1Z7"], [snDoc, "19AAFPM4521K2Z6"]] as const) {
    await updateGodown(dbm, owner, {
      godownId: g._id,
      name: g.name,
      ...(g.nameAlt ? { nameAlt: g.nameAlt } : {}),
      ...(g.firmName ? { firmName: g.firmName } : {}),
      proprietor: "শ্রী বিশ্বজিৎ মণ্ডল",
      ...(g.address ? { address: g.address } : {}),
      ...(g.phone ? { phone: g.phone } : {}),
      gstin,
      receiptLanguage: g.receiptLanguage,
    });
  }
  await createUser(dbm, {
    name: STAFF.manager.name,
    phone: STAFF.manager.phone,
    password: STAFF_PASSWORD,
    // Manager of Rampur who can only *view* Sonapur: transfers to it stay pending until accepted.
    godownAccess: [
      { godownId: rpDoc._id, role: "manager" },
      { godownId: snDoc._id, role: "viewer" },
    ],
  });
  await createUser(dbm, {
    name: STAFF.entry.name,
    phone: STAFF.entry.phone,
    password: STAFF_PASSWORD,
    godownAccess: [{ godownId: rpDoc._id, role: "entry" }],
  });
  await createUser(dbm, {
    name: STAFF.snManager.name,
    phone: STAFF.snManager.phone,
    password: STAFF_PASSWORD,
    godownAccess: [{ godownId: snDoc._id, role: "manager" }],
  });

  // ── Devices ────────────────────────────────────────────────────────────────
  log("Signing in simulated devices…");
  const dev: Devices = {
    own: new DemoDevice("demo-owner"),
    mgr: new DemoDevice("demo-manager"),
    ent: new DemoDevice("demo-entry"),
    snm: new DemoDevice("demo-sn-manager"),
  };
  const creds: Array<[DemoDevice, string, string, string]> = [
    [dev.own, ownerPhone, ownerPassword, DEVICE_LABELS.own],
    [dev.mgr, STAFF.manager.phone, STAFF_PASSWORD, DEVICE_LABELS.mgr],
    [dev.ent, STAFF.entry.phone, STAFF_PASSWORD, DEVICE_LABELS.ent],
    [dev.snm, STAFF.snManager.phone, STAFF_PASSWORD, DEVICE_LABELS.snm],
  ];
  for (const [d, phone, pw, label] of creds) {
    await d.reset();
    await d.login(phone, pw, label);
    await d.sync();
  }

  // ── Masters (owner) ────────────────────────────────────────────────────────
  log("Creating masters…");
  dev.own.use();
  at(day(31));
  const rp = await createMasters(rpDoc._id, "RP", "রামপুর গোডাউন", RAMPUR);
  const sn = await createMasters(snDoc._id, "SN", "সোনাপুর গোডাউন", SONAPUR);
  // The server locks days older than `lockAfterDays` for staff (judged against the REAL today),
  // so back-dated demo entries by staff need a wide window while seeding. Restored at the end.
  for (const g of [rp, sn]) await updateGodownSettings(g.gid, { lockAfterDays: 365 });
  await dev.own.sync();
  for (const d of [dev.mgr, dev.ent, dev.snm]) await d.sync();

  // ── The story ──────────────────────────────────────────────────────────────
  log("Running 30 days of business…");
  const tl = new Timeline();
  rampurStory(tl, rp, sn, dev, log);
  sonapurStory(tl, sn, dev);
  await runTimeline(
    tl,
    dev.own,
    async (date) => {
      if (date > day(30)) await topUpCash(rp.gid, rp.bank.sbi!, date);
      if (date > day(29)) await topUpCash(sn.gid, sn.bank.bob!, date, 50_000, 150_000);
    },
    log,
  );
  for (const d of [dev.mgr, dev.ent, dev.snm]) await d.sync();
  dev.own.use();
  setClockForTests(null);
  for (const g of [rp, sn]) await updateGodownSettings(g.gid, { lockAfterDays: 7 });
  await dev.own.sync();

  // ── Server-side extras + verification ──────────────────────────────────────
  await setAppSettings(dbm, owner, { digestHour: 8, defaultLanguage: "bn" });
  await recomputeIntegritySummaries(dbm);
  log("\nVerification");
  let ok = true;
  dev.own.use();
  for (const g of [rp, sn]) {
    const si = await serverIntegrity(dbm, owner, g.gid);
    const tb = await godownTrialBalance(g.gid);
    const stock = await stockSummary(g.gid);
    const negative = stock.filter((s) => s.qtyG < 0n);
    const good = si.balanced && tb.balanced && si.repostMismatches.length === 0 && negative.length === 0;
    const cash = await cashBalance(g.gid);
    const banks: string[] = [];
    for (const [key, id] of Object.entries(g.bank)) banks.push(`${key} ₹${rupees(await bankBalance(g.gid, id))}`);
    const stockQtl = stock.reduce((s, r) => s + r.qtyG, 0n) / 100_000n;
    const stockWorth = stock.reduce((s, r) => s + r.valuePaise, 0n);
    const lowCash = cash < 0n || (await Promise.all(Object.values(g.bank).map((id) => bankBalance(g.gid, id)))).some((x) => x < 0n);
    log(`  ${g.code} snapshot: cash ₹${rupees(cash)} · ${banks.join(" · ")} · stock ${stockQtl} qtl worth ₹${rupees(stockWorth)}${lowCash ? "  ⚠ negative cash/bank" : ""}`);
    ok &&= good;
    log(
      `  ${g.code}: ${si.voucherCount} vouchers · server balanced=${si.balanced} · device balanced=${tb.balanced}` +
        ` · re-post mismatches=${si.repostMismatches.length} · negative stock rows=${negative.length}  ${good ? "✔" : "✘"}`,
    );
  }
  if ((await localDb().outbox.count()) > 0) {
    ok = false;
    log("  ✘ owner outbox is not empty");
  }

  log("\nDocuments per collection");
  const names = Object.keys(cols(dbm)) as Array<keyof ReturnType<typeof cols>>;
  const rows: string[] = [];
  for (const n of names) rows.push(`${String(n).padEnd(18)} ${await cols(dbm)[n].countDocuments({} as never)}`);
  log(rows.map((r) => `  ${r}`).join("\n"));

  log("\nLogins");
  log(`  Owner         ${ownerPhone}   (your password)`);
  log(`  Manager (RP)  ${STAFF.manager.phone}   ${STAFF_PASSWORD}   · sees Sonapur read-only`);
  log(`  Entry (RP)    ${STAFF.entry.phone}   ${STAFF_PASSWORD}   · restricted: own entries, today only`);
  log(`  Manager (SN)  ${STAFF.snManager.phone}   ${STAFF_PASSWORD}   · has the pending transfers to accept`);

  if (stopMemory) await stopMemory();
  await closeMongo();
  if (!ok) {
    console.error("\nSome checks failed — see above.");
    process.exit(1);
  }
  log("\nDemo data ready ✔");
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  setClockForTests(null);
  await closeMongo().catch(() => {});
  process.exit(1);
});

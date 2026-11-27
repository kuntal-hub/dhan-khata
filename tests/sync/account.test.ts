/**
 * v2 Phase 3 (requirement_v2 §2, §21 Tests 7–9) through the real route handlers:
 * registration that closes after the first owner, recovery-code password reset, regeneration,
 * business profile, sessions, Gola create/archive/delete, two-Gola isolation + combined totals
 * (Test 7) and persistence across logout / a second device (Test 8).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteEmptyGola,
  listSessions,
  recoverPassword,
  regenerateRecoveryCode,
  register,
  registrationStatus,
  revokeSession,
  updateBusinessProfile,
} from "@/client/auth/account";
import { LogoutBlockedError, authedCall, logout } from "@/client/auth/session";
import { db } from "@/client/db/dexie";
import { META, getMeta } from "@/client/db/meta";
import { godownBalances } from "@/client/queries/ledger";
import { combinedTotals, golaTotals } from "@/client/queries/consolidated/totals";
import { newId, saveDoc, saveDocs, upsertMaster } from "@/client/repo";
import { riceShown } from "@/domain/businessSettings";
import type { Business } from "@/domain/schemas";
import { normalizeRecoveryCode } from "@/server/recovery";
import { closeMongo, cols, getDb } from "@/server/db";
import { expenseDraft, paymentDraft, purchaseDraft, saleDraft } from "../helpers/local";
import { TestDevice, nonZero, serverBalances, useTestServer } from "../helpers/server";

const QTL = 100_000n;
const RS = 100n;
const OWNER = { name: "Ramesh Mondal", mobile: "9830044401", password: "first-owner-pass" };
const d1 = new TestDevice("acct-d1");
const d2 = new TestDevice("acct-d2");
let recoveryCode = "";

async function createGola(dev: TestDevice, name: string, code: string): Promise<string> {
  dev.use();
  const { godown } = await authedCall<{ godown: { _id: string } }>("/api/godowns", {
    body: { name, code },
  });
  await dev.sync();
  return godown._id;
}

async function swarna(godownId: string): Promise<string> {
  return (await db()
    .varieties.where("godownId")
    .equals(godownId)
    .filter((v) => v.systemKey === "SWARNA")
    .first())!._id;
}

beforeAll(async () => {
  useTestServer("acct");
  await getDb();
  await d1.reset();
  await d2.reset();
});

afterAll(async () => {
  delete process.env.ALLOW_REGISTRATION;
  await closeMongo();
});

describe("registration (auto-closing)", () => {
  it("is open while the deployment has no owner; registering signs in and returns a recovery code", async () => {
    d1.use();
    expect(await registrationStatus()).toEqual({ registrationOpen: true });
    const r = await register({ ...OWNER, businessName: "মণ্ডল ট্রেডার্স", businessAddress: "বর্ধমান" });
    recoveryCode = r.recoveryCode;
    expect(recoveryCode).toMatch(/^DG-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(r.session.user).toMatchObject({ name: OWNER.name, isOwner: true });
    expect(r.session.user).not.toHaveProperty("passwordHash");
    expect(r.session.user).not.toHaveProperty("recoveryCodeHash");
    await d1.sync();
    expect(await getMeta(META.business)).toMatchObject({ name: "মণ্ডল ট্রেডার্স", monKg: 40 });
    const mdb = await getDb();
    const stored = await cols(mdb).users.findOne({ phone: OWNER.mobile });
    expect(stored?.recoveryCodeHash).toBeTruthy();
    expect(stored?.recoveryCodeHash).not.toContain(normalizeRecoveryCode(recoveryCode));
  });

  it("closes after the first owner: status false and REGISTRATION_CLOSED", async () => {
    d2.use();
    expect(await registrationStatus()).toEqual({ registrationOpen: false });
    await expect(
      register({
        name: "Other",
        mobile: "9830044402",
        password: "other-pass-123",
        businessName: "X",
      }),
    ).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    // The developer can reopen it with ALLOW_REGISTRATION=false/true; "false" keeps it shut.
    process.env.ALLOW_REGISTRATION = "false";
    expect(await registrationStatus()).toEqual({ registrationOpen: false });
    delete process.env.ALLOW_REGISTRATION;
  });
});

describe("recovery code", () => {
  it("wrong code → RECOVERY_INVALID; right code (any spacing/case) → new password + NEW code", async () => {
    d2.use();
    await expect(
      recoverPassword({
        mobile: OWNER.mobile,
        recoveryCode: "DG-AAAA-BBBB-CCCC",
        newPassword: "new-pass-0001",
      }),
    ).rejects.toMatchObject({ code: "RECOVERY_INVALID" });
    const messy = recoveryCode.toLowerCase().replace(/-/g, " ");
    const r = await recoverPassword({
      mobile: OWNER.mobile,
      recoveryCode: messy,
      newPassword: "new-pass-0001",
    });
    expect(r.recoveryCode).not.toBe(recoveryCode);
    // The old code no longer works; the new password does; the old password doesn't.
    await expect(
      recoverPassword({ mobile: OWNER.mobile, recoveryCode, newPassword: "new-pass-0002" }),
    ).rejects.toMatchObject({ code: "RECOVERY_INVALID" });
    await expect(d2.login(OWNER.mobile, OWNER.password)).rejects.toMatchObject({
      code: "BAD_CREDENTIALS",
    });
    await d2.login(OWNER.mobile, "new-pass-0001");
    recoveryCode = r.recoveryCode;
    OWNER.password = "new-pass-0001";
  });

  it("is rate limited", async () => {
    const dev = await new TestDevice("acct-brute").reset();
    for (let i = 0; i < 5; i++) {
      await recoverPassword({
        mobile: OWNER.mobile,
        recoveryCode: "DG-2222-3333-4444",
        newPassword: "zzzz-zzzz-1",
      }).catch(() => {});
    }
    dev.use();
    await expect(
      recoverPassword({ mobile: OWNER.mobile, recoveryCode, newPassword: "zzzz-zzzz-1" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const mdb = await getDb();
    await cols(mdb).loginAttempts.deleteMany({});
  });

  it("regenerating needs the password; the previous code stops working", async () => {
    await d1.login(OWNER.mobile, OWNER.password);
    await expect(regenerateRecoveryCode("wrong")).rejects.toMatchObject({
      code: "BAD_CREDENTIALS",
    });
    const next = await regenerateRecoveryCode(OWNER.password);
    expect(next).not.toBe(recoveryCode);
    const mdb = await getDb();
    const audit = await cols(mdb)
      .audit.find({ action: { $in: ["register", "password_reset", "recovery_regenerate"] } })
      .toArray();
    expect(audit.map((a) => a.action).sort()).toEqual([
      "password_reset",
      "recovery_regenerate",
      "register",
    ]);
    recoveryCode = next;
  });
});

describe("business profile and sessions", () => {
  it("owner updates the business profile; every device receives it", async () => {
    d1.use();
    await updateBusinessProfile({
      name: "মণ্ডল ধান গোলা",
      address: "মেমারি",
      monKg: 37,
      deductionsEnabled: true,
    });
    d2.use();
    await d2.sync();
    expect(await getMeta(META.business)).toMatchObject({
      name: "মণ্ডল ধান গোলা",
      monKg: 37,
      settings: { deductionsEnabled: true },
    });
    // Rice shown by default (no setting stored yet).
    expect(riceShown(await getMeta<Business>(META.business))).toBe(true);
  });

  it("owner hides rice; the switch reaches every device and keeps the other settings", async () => {
    d1.use();
    await updateBusinessProfile({ name: "মণ্ডল ধান গোলা", riceEnabled: false });
    d2.use();
    await d2.sync();
    const b = await getMeta<Business>(META.business);
    expect(b?.settings).toEqual({ deductionsEnabled: true, riceEnabled: false });
    expect(riceShown(b)).toBe(false);
    d1.use();
    await updateBusinessProfile({ name: "মণ্ডল ধান গোলা", riceEnabled: true });
    expect(riceShown(await getMeta<Business>(META.business))).toBe(true);
  });

  it("lists the owner's devices and signs another one out", async () => {
    d1.use();
    const rows = await listSessions();
    expect(rows.filter((r) => !r.revoked).length).toBeGreaterThanOrEqual(2);
    const other = rows.find((r) => !r.current && !r.revoked && r.label === "acct-d2")!;
    await revokeSession(other.id);
    d2.use();
    d2.dropAccessToken();
    await expect(d2.sync()).rejects.toMatchObject({ code: "DEVICE_REVOKED" });
    // A fresh login gives the phone a new session again (data stays on it).
    await d2.reset();
    await d2.login(OWNER.mobile, OWNER.password);
  });
});

describe("Test 7: two Golas under one owner", () => {
  let G1 = "";
  let G2 = "";
  it("records, cashbook, stock and dues stay separate; combined = sum", async () => {
    G1 = await createGola(d1, "গোলা ১", "GL1");
    G2 = await createGola(d1, "গোলা ২", "GL2");
    d1.use();
    const f1 = await upsertMaster(G1, "party", { name: "কৃষক ১", roles: ["FARMER"] });
    const c1 = await upsertMaster(G1, "party", { name: "ক্রেতা ১", roles: ["CUSTOMER"] });
    const f2 = await upsertMaster(G2, "party", { name: "কৃষক ২", roles: ["FARMER"] });
    const p1 = newId();
    await saveDocs(G1, [
      { draft: { ...purchaseDraft(f1._id, await swarna(G1), 56n * QTL, 2400n * RS), _id: p1 } },
      {
        draft: paymentDraft(
          "OUT",
          50_000n * RS,
          { type: "PURCHASE", id: p1 },
          { partyId: f1._id, isInitial: true },
        ),
      },
    ]);
    await saveDoc(G1, saleDraft(c1._id, await swarna(G1), 10n * QTL, 2600n * RS));
    await saveDoc(G1, expenseDraft(5_000n * RS));
    await saveDoc(G2, purchaseDraft(f2._id, await swarna(G2), 20n * QTL, 2300n * RS));
    await saveDoc(G2, expenseDraft(1_200n * RS));

    const t1 = await golaTotals(G1);
    const t2 = await golaTotals(G2);
    expect(t1).toMatchObject({
      paddyG: 46n * QTL,
      payablePaise: 84_400n * RS,
      receivablePaise: 26_000n * RS,
      cashPaise: -50_000n * RS,
    });
    expect(t2).toMatchObject({
      paddyG: 20n * QTL,
      payablePaise: 46_000n * RS,
      receivablePaise: 0n,
      cashPaise: 0n,
    });
    // Expenses unpaid: no cash moved in G2; G1's cash moved only by its payment.
    const all = await combinedTotals([G1, G2]);
    for (const k of [
      "cashPaise",
      "bankPaise",
      "receivablePaise",
      "payablePaise",
      "paddyG",
      "millPaddyG",
      "riceG",
    ] as const) {
      expect(all.total[k]).toBe(t1[k] + t2[k]);
    }
    // Nothing of G1 appears in G2's books.
    const b2 = await godownBalances(G2);
    expect([...b2.keys()].some((k) => k === `PARTY:${f1._id}` || k === `PARTY:${c1._id}`)).toBe(
      false,
    );
    await d1.sync();
    expect(nonZero(await serverBalances(G1))).toEqual(nonZero(await godownBalances(G1)));
    expect(nonZero(await serverBalances(G2))).toEqual(nonZero(await godownBalances(G2)));
  });

  it("a Gola with transactions can't be deleted (archive instead); an empty one can", async () => {
    d1.use();
    await expect(deleteEmptyGola(G1)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      detail: "HAS_TRANSACTIONS",
    });
    const G3 = await createGola(d1, "খালি গোলা", "GL3");
    await deleteEmptyGola(G3);
    await d1.sync();
    expect(await db().godowns.get(G3)).toBeUndefined();
    const mdb = await getDb();
    expect(await cols(mdb).godowns.countDocuments({ _id: G3 })).toBe(0);
  });
});

describe("Test 8: persistence", () => {
  it("logout is blocked while entries are unsynced; nothing is lost; a second phone restores everything", async () => {
    d1.use();
    const g = (await db().godowns.toArray()).find((x) => x.code === "GL1")!._id;
    const f = await upsertMaster(g, "party", { name: "অফলাইন কৃষক", roles: ["FARMER"] });
    d1.offline = true;
    await saveDoc(g, purchaseDraft(f._id, await swarna(g), 3n * QTL, 2200n * RS));
    await expect(logout()).rejects.toBeInstanceOf(LogoutBlockedError);
    d1.offline = false;
    await d1.sync();
    const before = nonZero(await godownBalances(g));
    const docsBefore = await db().vouchers.count();
    await logout();
    expect(await db().vouchers.count()).toBe(0);

    // Log in again on the same phone, and on a brand-new phone: full download, same books.
    for (const dev of [d1, d2]) {
      await dev.login(OWNER.mobile, OWNER.password);
      await dev.sync();
      expect(nonZero(await godownBalances(g))).toEqual(before);
      expect(await db().vouchers.count()).toBe(docsBefore);
      expect(await getMeta(META.business)).toMatchObject({ name: "মণ্ডল ধান গোলা" });
    }
  });
});

/**
 * A device that changes hands to a NEW user (another business, or the same phone after the
 * server database was reset) must start clean: the previous user's Golas, entries, sync cursor
 * and PIN never show up under the new user (they crashed screens and broke sync). Unsent work of
 * the previous user blocks the switch instead of being lost or sent under the new user.
 * Registration, login and recovery all go through the same `signInWith`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { register, registrationStatus } from "@/client/auth/account";
import { authedCall, getSession } from "@/client/auth/session";
import { hasPin, setPin } from "@/client/auth/pin";
import { db } from "@/client/db/dexie";
import { META, getMeta } from "@/client/db/meta";
import { saveDoc } from "@/client/repo";
import { closeMongo, getDb } from "@/server/db";
import { expenseDraft } from "../helpers/local";
import { TestDevice, useTestServer } from "../helpers/server";

const RS = 100n;
const dev = new TestDevice("switch-d1");
const A = { name: "Old Owner", mobile: "9830055501", password: "old-owner-pass" };
const B = { name: "New Owner", mobile: "9830055502", password: "new-owner-pass" };

/** The server database is replaced by an empty one (what "clear the dev DB" does). */
function resetServerDatabase() {
  process.env.MONGODB_DB = `switch_reset_${Date.now().toString(36)}`;
}

beforeAll(async () => {
  useTestServer("switch");
  await getDb();
  await dev.reset();
});

afterAll(async () => {
  await closeMongo();
});

describe("a new user on a device that holds another user's data", () => {
  let oldGola = "";

  it("setup: the first owner has a Gola, synced entries and a PIN on this device", async () => {
    dev.use();
    await register({ ...A, businessName: "Old business" });
    const { godown } = await authedCall<{ godown: { _id: string } }>("/api/godowns", {
      body: { name: "Old Gola", code: "OG" },
    });
    oldGola = godown._id;
    await dev.sync();
    await saveDoc(oldGola, expenseDraft(700n * RS));
    await dev.sync();
    await setPin("2580");
    expect(await db().godowns.count()).toBe(1);
    expect(await db().vouchers.count()).toBeGreaterThan(0);
    expect(await db().outbox.count()).toBe(0);
    expect(await hasPin()).toBe(true);
  });

  it("with unsent work of the old user, registering is refused BEFORE a business is created", async () => {
    resetServerDatabase();
    dev.use();
    await saveDoc(oldGola, expenseDraft(300n * RS)); // pending in the outbox
    await expect(register({ ...B, businessName: "New business" })).rejects.toMatchObject({
      detail: "pending-ops-of-other-user",
    });
    expect(await registrationStatus()).toEqual({ registrationOpen: true });
    // Nothing of the old user was touched.
    expect(await db().outbox.count()).toBe(1);
    expect(await db().godowns.count()).toBe(1);
    expect(await hasPin()).toBe(true);
    await db().outbox.clear(); // the old user's work is dealt with (exported / given up)
  });

  it("registering the new owner wipes the old user's data, cursor and PIN", async () => {
    dev.use();
    const r = await register({ ...B, businessName: "New business" });
    expect(r.session.user.name).toBe(B.name);
    expect((await getSession())?.user._id).toBe(r.session.user._id);
    expect(await db().godowns.count()).toBe(0);
    expect(await db().vouchers.count()).toBe(0);
    expect(await db().ledgerLines.count()).toBe(0);
    expect(await db().parties.count()).toBe(0);
    expect(await getMeta(META.cursor)).toBeUndefined();
    expect(await getMeta(META.activeGodownId)).toBeUndefined();
    expect(await hasPin()).toBe(false);
    // A clean sync under the new owner: only the new business's data arrives.
    await dev.sync();
    expect(await db().godowns.count()).toBe(0);
    expect(await getMeta(META.business)).toMatchObject({ name: "New business" });
  });

  it("logging in again as the same user keeps the data and the PIN", async () => {
    dev.use();
    const { godown } = await authedCall<{ godown: { _id: string } }>("/api/godowns", {
      body: { name: "New Gola", code: "NG" },
    });
    await dev.sync();
    await saveDoc(godown._id, expenseDraft(100n * RS));
    await dev.sync();
    await setPin("1357");
    const before = await db().vouchers.count();
    await dev.login(B.mobile, B.password);
    expect(await db().vouchers.count()).toBe(before);
    expect(await hasPin()).toBe(true);
  });
});

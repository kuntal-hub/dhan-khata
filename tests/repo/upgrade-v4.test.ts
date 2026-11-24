/**
 * Dexie v3 → v4 upgrade (src/client/db/upgradeV4.ts): unsynced v1 work is held (never dropped),
 * business tables are cleared for a full re-download, and the held ops are replayed as v2 ops
 * once the business id is known.
 */
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { DhanKhataDB, deleteDatabase, selectDatabase, db } from "@/client/db/dexie";
import { META, getMeta, setMeta } from "@/client/db/meta";
import { SCHEMA_VERSIONS } from "@/client/db/migrations";
import { LEGACY_V1_KEY, type LegacyV1Hold } from "@/client/db/upgradeV4";
import { replayLegacyV1 } from "@/client/sync/legacy";
import { userDoc } from "../helpers/local";

const NAME = "upgrade-v4";

async function makeV3Database(): Promise<void> {
  await deleteDatabase(NAME);
  const old = new Dexie(NAME);
  for (const v of SCHEMA_VERSIONS.filter((x) => x.version <= 3))
    old.version(v.version).stores(v.stores);
  await old.open();
  const expense = {
    _id: "E1",
    godownId: "GA",
    rev: 1,
    createdAt: "2026-11-20T04:00:00.000Z",
    createdBy: "U-OWNER",
    deviceId: "D",
    updatedAt: "2026-11-20T04:00:00.000Z",
    updatedBy: "U-OWNER",
    status: "active",
    number: "RP-A-EXP-000001",
    date: "2026-11-20",
    fy: "2026-27",
    type: "EXPENSE",
    categoryCode: "LABOUR",
    amountPaise: "50000",
    mode: "CASH",
    description: "loading",
  };
  await old.table("vouchers").put(expense);
  await old
    .table("ledgerLines")
    .put({ _id: "E1:1:L0", voucherId: "E1", godownId: "GA", account: "CASH", date: "2026-11-20" });
  await old.table("outbox").add({
    opId: "op-1",
    godownId: "GA",
    entity: "voucher",
    entityId: "E1",
    op: "upsert",
    baseRev: 0,
    payload: expense,
    createdAt: "2026-11-20T04:00:00.000Z",
    attempts: 0,
    status: "pending",
  });
  await old.table("meta").put({ key: "cursor", value: 1234 });
  await old.table("meta").put({ key: "deviceId", value: "D-keep" });
  old.close();
}

describe("Dexie v4 upgrade", () => {
  it("holds pending v1 work, clears business data, resets the cursor, keeps the device id", async () => {
    await makeV3Database();
    selectDatabase(NAME);
    const d = new DhanKhataDB(NAME);
    await d.open();
    expect(await d.vouchers.count()).toBe(0);
    expect(await d.ledgerLines.count()).toBe(0);
    expect(await d.outbox.count()).toBe(0);
    expect((await d.meta.get("cursor"))?.value).toBe(0);
    expect((await d.meta.get("deviceId"))?.value).toBe("D-keep");
    const hold = (await d.meta.get(LEGACY_V1_KEY))?.value as LegacyV1Hold;
    expect(hold.ops).toHaveLength(1);
    expect(hold.vouchers).toHaveLength(1);
    d.close();
  });

  it("replays the held ops as v2 operations (expense + its payment) once the business is known", async () => {
    selectDatabase(NAME);
    await db().open();
    await setMeta(META.session, {
      user: userDoc("U-OWNER"),
      deviceId: "D-keep",
      deviceCode: "A",
      loggedInAt: "2026-11-20T04:00:00.000Z",
    });
    const r = await replayLegacyV1();
    expect(r).toEqual({ ops: 2 });
    const ops = await db().outbox.orderBy("seq").toArray();
    expect(ops.map((o) => [o.entityId, o.op, o.baseRev])).toEqual([
      ["E1", "upsert", 0],
      ["E1~pay", "upsert", 0],
    ]);
    expect(new Set(ops.map((o) => o.opGroup)).size).toBe(1);
    expect(await db().vouchers.get("E1~pay")).toMatchObject({
      type: "PAYMENT",
      source: { type: "EXPENSE", id: "E1" },
    });
    expect(await getMeta(LEGACY_V1_KEY)).toBeUndefined();
    db().close();
  });
});

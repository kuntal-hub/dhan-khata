import { describe, expect, it } from "vitest";
import {
  DhanKhataDB,
  classifyOpenError,
  deleteDatabase,
  openDb,
  selectDatabase,
  exportRawDatabase,
} from "@/client/db/dexie";
import { SCHEMA_V1, SCHEMA_V2, assertAdditive } from "@/client/db/migrations";
import { META, getMeta, getOrCreateDeviceId, nextVoucherSeq } from "@/client/db/meta";
import { setPin, verifyPin, hasPin, failedPinAttempts, PIN_ITERATIONS } from "@/client/auth/pin";

describe("Dexie schema", () => {
  it("v1 matches spec §8.6 exactly; v2 only adds the transfers table", async () => {
    await deleteDatabase("schema-test");
    const d = new DhanKhataDB("schema-test");
    await d.open();
    expect(d.tables.map((t) => t.name).sort()).toEqual(
      [...Object.keys(SCHEMA_V1), ...Object.keys(SCHEMA_V2)].sort(),
    );
    expect(() => assertAdditive(SCHEMA_V1, SCHEMA_V2)).not.toThrow();
    expect(d.verno).toBe(2);
    expect(d.vouchers.schema.indexes.map((i) => i.name)).toContain("[godownId+type+date]");
    expect(d.outbox.schema.primKey.auto).toBe(true);
    d.close();
  });

  it("migrations are additive only", () => {
    expect(() =>
      assertAdditive(SCHEMA_V1, { ...SCHEMA_V1, parties: SCHEMA_V1.parties + ", tags" }),
    ).not.toThrow();
    expect(() => assertAdditive(SCHEMA_V1, { ...SCHEMA_V1, newTable: "_id" })).not.toThrow();
    expect(() => assertAdditive(SCHEMA_V1, { ...SCHEMA_V1, parties: "_id, godownId" })).toThrow(
      /removes index/,
    );
    expect(() => assertAdditive(SCHEMA_V1, { ...SCHEMA_V1, meta: "id" })).toThrow(/primary key/);
    expect(() =>
      assertAdditive(SCHEMA_V1, { ...SCHEMA_V1, places: null as unknown as string }),
    ).toThrow(/deletes table/);
  });

  it("open failures are classified for the recovery screen", () => {
    expect(classifyOpenError({ name: "VersionError" }).kind).toBe("version");
    expect(
      classifyOpenError({ name: "DatabaseClosedError", inner: { name: "UpgradeError" } }).kind,
    ).toBe("upgrade");
    expect(classifyOpenError(new Error("x")).kind).toBe("other");
  });

  it("a database left at a higher version opens without losing data, and raw export works", async () => {
    await deleteDatabase("ver-test");
    // A newer app version created the DB at version 50.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("ver-test", 50);
      req.onupgradeneeded = () =>
        req.result.createObjectStore("vouchers", { keyPath: "_id" }).put({ _id: "x" });
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    selectDatabase("ver-test");
    const opened = await openDb();
    expect(await opened.vouchers.get("x")).toEqual({ _id: "x" });
    opened.close();
    const dump = await exportRawDatabase("ver-test");
    expect(dump.vouchers).toEqual([{ _id: "x" }]);
  });
});

describe("meta helpers", () => {
  it("deviceId is created once; voucher sequences count per key", async () => {
    await deleteDatabase("meta-test");
    selectDatabase("meta-test");
    const id = await getOrCreateDeviceId();
    expect(await getOrCreateDeviceId()).toBe(id);
    expect(await getMeta(META.deviceId)).toBe(id);
    expect(await nextVoucherSeq("G1", "PURCHASE")).toBe(1);
    expect(await nextVoucherSeq("G1", "PURCHASE")).toBe(2);
    expect(await nextVoucherSeq("G2", "PURCHASE")).toBe(1);
    expect(await nextVoucherSeq("G1", "SALE")).toBe(1);
  });
});

describe("offline PIN", () => {
  it("PBKDF2 ≥ 200k iterations, per-device salt, Bengali digits accepted, failures counted", async () => {
    await deleteDatabase("pin-test");
    selectDatabase("pin-test");
    expect(PIN_ITERATIONS).toBeGreaterThanOrEqual(200_000);
    expect(await hasPin()).toBe(false);
    await setPin("4321");
    expect(await hasPin()).toBe(true);
    const stored = await getMeta<{ hashB64: string; saltB64: string }>(META.pin);
    expect(JSON.stringify(stored)).not.toContain("4321");
    expect(await verifyPin("1234")).toBe(false);
    expect(await failedPinAttempts()).toBe(1);
    expect(await verifyPin("৪৩২১")).toBe(true);
    expect(await failedPinAttempts()).toBe(0);
    await expect(setPin("12")).rejects.toThrow();
  });
});

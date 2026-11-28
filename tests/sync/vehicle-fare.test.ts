/**
 * Purchase vehicle fare through sync (DECISIONS D56), real route handlers + in-memory Mongo:
 *  - a purchase with a fare paid now, and a later owner payment, reach the server with the same
 *    ledger (farmer net, owner payable, cash once) and reach a second device;
 *  - the server enforces the same rules as the device: fare ≤ purchase total, and the fare's
 *    owner can't change under its payments (a stale device that hasn't seen the payment).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/client/db/dexie";
import { getSession } from "@/client/db/meta";
import { godownBalances } from "@/client/queries/ledger";
import { vehicleOwnerLedger } from "@/client/queries/fares";
import {
  farePaymentItem,
  newId,
  payVehicleOwner,
  saveBillWithInitialPayment,
  saveVehicleOwner,
  upsertMaster,
} from "@/client/repo";
import { accessToken } from "@/client/sync/transport";
import { addDays, todayIST } from "@/domain/dates";
import type { Doc, PushResponse, VehicleFare } from "@/domain/schemas";
import { closeMongo, cols, getDb, type UserDoc } from "@/server/db";
import { createBusinessWithOwner } from "@/server/business";
import { createGodown } from "@/server/godownService";
import { TestDevice, nonZero, serverBalances, useTestServer } from "../helpers/server";
import { purchaseDraft } from "../helpers/local";

const RS = 100n;
const OWNER = { phone: "9830000081", password: "owner-pass-81" };
const TODAY = todayIST();
const D1 = addDays(TODAY, -3);

let owner: UserDoc;
let GA: string;
let farmer: string;
let swarna: string;
const d1 = new TestDevice("fare-d1");
const d2 = new TestDevice("fare-d2");

async function serverDoc(id: string): Promise<Doc | null> {
  return (await cols(await getDb()).vouchers.findOne({ _id: id })) as Doc | null;
}

async function push(op: { entityId: string; baseRev: number; payload: unknown; opId: string }) {
  const res = await d2.fetch("http://test/api/sync/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken().token}`,
    },
    body: JSON.stringify({
      deviceId: (await getSession())!.deviceId,
      ops: [
        {
          opId: op.opId,
          godownId: GA,
          entity: "voucher",
          entityId: op.entityId,
          op: "upsert",
          baseRev: op.baseRev,
          payload: op.payload,
          createdAt: new Date().toISOString(),
        },
      ],
    }),
  });
  return (await res.json()) as PushResponse;
}

beforeAll(async () => {
  useTestServer("vehiclefare");
  const mdb = await getDb();
  owner = (
    await createBusinessWithOwner(mdb, {
      ownerName: "Owner",
      mobile: OWNER.phone,
      password: OWNER.password,
      businessName: "Fare Business",
    })
  ).owner;
  GA = (await createGodown(mdb, owner, { name: "Rampur", code: "RP" }))._id;
  for (const dev of [d1, d2]) {
    await dev.reset();
    await dev.login(OWNER.phone, OWNER.password);
    await dev.sync();
  }
  d1.use();
  farmer = (await upsertMaster(GA, "party", { name: "Ramesh", roles: ["FARMER"] }))._id;
  swarna = (await db()
    .varieties.where("godownId")
    .equals(GA)
    .filter((v) => v.systemKey === "SWARNA")
    .first())!._id;
  await d1.sync();
});

afterAll(async () => {
  await closeMongo();
});

describe("vehicle fare sync", () => {
  it("fare paid now + a later payment: server ledger = device ledger; reaches the other device", async () => {
    d1.use();
    const toto = await saveVehicleOwner(GA, { name: "Bapi Das" });
    const id = newId();
    const fare: VehicleFare = {
      ownerPartyId: toto._id,
      vehicleKind: "TOTO",
      amountPaise: (300n * RS).toString(),
    };
    const p2 = newId();
    // ₹12,800 with ₹300 fare paid now; a second ₹12,800 with ₹250 fare unpaid.
    await saveBillWithInitialPayment(
      GA,
      { ...purchaseDraft(farmer, swarna, 512_000n, 2500n * RS, D1), _id: id, vehicleFare: fare },
      null,
      {
        extra: [
          farePaymentItem(id, D1, fare, {
            amountPaise: fare.amountPaise,
            paymentDate: D1,
            mode: "CASH",
          }),
        ],
      },
    );
    await saveBillWithInitialPayment(
      GA,
      {
        ...purchaseDraft(farmer, swarna, 512_000n, 2500n * RS, D1),
        _id: p2,
        vehicleFare: { ...fare, amountPaise: (250n * RS).toString() },
      },
      null,
    );
    await payVehicleOwner(GA, toto._id, {
      amountPaise: (100n * RS).toString(),
      paymentDate: TODAY,
      mode: "CASH",
    });
    await d1.sync();
    expect(await db().outbox.count()).toBe(0);

    const server = nonZero(await serverBalances(GA));
    const device = nonZero(await godownBalances(GA));
    expect(server).toEqual(device);
    expect(server.get(`PARTY:${farmer}`)).toBe(-25_050n * RS); // 12,500 + 12,550
    expect(server.get(`PARTY:${toto._id}`)).toBe(-150n * RS); // 550 − 300 − 100
    expect(server.get("CASH")).toBe(-400n * RS);
    expect(server.get("STOCK_PADDY")).toBe(25_600n * RS);

    await d2.sync();
    d2.use();
    const led = (await vehicleOwnerLedger(GA, toto._id))!;
    expect(led.summary).toMatchObject({
      jobs: 2,
      earnedPaise: 550n * RS,
      paidPaise: 400n * RS,
      outstandingPaise: 150n * RS,
    });
  });

  it("the server refuses a fare above the purchase and an owner change under payments", async () => {
    d1.use();
    const toto = await saveVehicleOwner(GA, { name: "Rintu Toto" });
    const van = await saveVehicleOwner(GA, { name: "Gopal Van" });
    const id = newId();
    const fare: VehicleFare = {
      ownerPartyId: toto._id,
      vehicleKind: "VAN",
      amountPaise: (200n * RS).toString(),
    };
    await saveBillWithInitialPayment(
      GA,
      { ...purchaseDraft(farmer, swarna, 512_000n, 2500n * RS, D1), _id: id, vehicleFare: fare },
      null,
    );
    await d1.sync();
    await d2.sync();
    // d1 pays the fare; d2 hasn't seen that payment.
    d1.use();
    await payVehicleOwner(GA, toto._id, {
      amountPaise: (50n * RS).toString(),
      paymentDate: TODAY,
      mode: "CASH",
    });
    await d1.sync();

    d2.use();
    const local = (await db().vouchers.get(id))!;
    expect(local.type).toBe("PURCHASE");
    const edit = (patch: object) => ({
      ...local,
      ...patch,
      rev: local.rev + 1,
      updatedAt: new Date().toISOString(),
    });
    const tooBig = await push({
      opId: "019a0000-0000-7000-8000-00000000fa01",
      entityId: id,
      baseRev: local.rev,
      payload: edit({ vehicleFare: { ...fare, amountPaise: (12_801n * RS).toString() } }),
    });
    expect(tooBig.results[0]).toMatchObject({
      result: "rejected",
      reason: "FARE_EXCEEDS_PURCHASE",
    });
    const owner2 = await push({
      opId: "019a0000-0000-7000-8000-00000000fa02",
      entityId: id,
      baseRev: local.rev,
      payload: edit({ vehicleFare: { ...fare, ownerPartyId: van._id } }),
    });
    expect(owner2.results[0]).toMatchObject({ result: "rejected", reason: "LINKED_PAYMENTS" });
    const s = await serverDoc(id);
    expect(s?.type === "PURCHASE" && s.vehicleFare?.ownerPartyId).toBe(toto._id);
  });
});

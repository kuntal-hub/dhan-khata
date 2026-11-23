/** Users and devices (spec §2, §8.4). */
import type { Db } from "mongodb";
import { v7 as uuidv7 } from "uuid";
import { deviceCodeFromIndex } from "@/domain/numbering";
import { normalizePhone } from "@/domain/phone";
import type { Device, GodownRole } from "@/domain/schemas";
import { hashPassword } from "./auth";
import { audit, logChanges } from "./changelog";
import { cols, getMongoClient, type UserDoc } from "./db";
import { ApiError } from "./http";

export interface CreateUserInput {
  name: string;
  phone: string;
  password: string;
  isOwner?: boolean;
  godownAccess?: UserDoc["godownAccess"];
  language?: "bn" | "en";
}

export async function createUser(db: Db, input: CreateUserInput): Promise<UserDoc> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ApiError(400, "BAD_REQUEST", "phone");
  if (input.password.length < 6) throw new ApiError(400, "BAD_REQUEST", "password");
  const now = new Date().toISOString();
  const user: UserDoc = {
    _id: uuidv7(),
    name: input.name.trim(),
    phone,
    passwordHash: await hashPassword(input.password),
    isOwner: input.isOwner ?? false,
    godownAccess: input.godownAccess ?? [],
    language: input.language ?? "bn",
    digits: input.language === "en" ? "en" : "bn",
    active: true,
    createdAt: now,
    accessVersion: 0,
    rev: 1,
    updatedAt: now,
  };
  const client = await getMongoClient();
  await client.withSession((session) =>
    session.withTransaction(async () => {
      await cols(db).users.insertOne(user, { session });
      await logChanges(db, session, [
        { godownId: null, entity: "user", entityId: user._id, rev: 1 },
      ]);
    }),
  );
  return user;
}

/** Replace a user's godown access (bumps accessVersion → devices purge/bootstrap on next pull). */
export async function setGodownAccess(
  db: Db,
  userId: string,
  access: Array<{ godownId: string; role: GodownRole; consolidated?: boolean }>,
): Promise<void> {
  const client = await getMongoClient();
  await client.withSession((session) =>
    session.withTransaction(async () => {
      const k = cols(db);
      const user = await k.users.findOne({ _id: userId }, { session });
      if (!user) throw new ApiError(404, "NOT_FOUND");
      const rev = (user.rev ?? 1) + 1;
      await k.users.updateOne(
        { _id: userId },
        {
          $set: {
            godownAccess: access,
            rev,
            updatedAt: new Date().toISOString(),
            accessVersion: (user.accessVersion ?? 0) + 1,
          },
        },
        { session },
      );
      await logChanges(db, session, [{ godownId: null, entity: "user", entityId: userId, rev }]);
    }),
  );
}

/**
 * Register (or re-register) a device on login. A new device gets the next code
 * (A … Z, AA …); an existing device keeps its code forever (voucher numbers stay unique).
 */
export async function registerDevice(
  db: Db,
  deviceId: string,
  userId: string,
  label: string,
  userAgent: string,
): Promise<Device> {
  const k = cols(db);
  const now = new Date().toISOString();
  const existing = await k.devices.findOne({ _id: deviceId });
  if (existing) {
    if (existing.revokedAt) throw new ApiError(401, "DEVICE_REVOKED");
    await k.devices.updateOne(
      { _id: deviceId },
      { $set: { userId, label, userAgent: userAgent.slice(0, 400), lastSeenAt: now } },
    );
    return { ...existing, userId, label, lastSeenAt: now };
  }
  const counter = await k.counters.findOneAndUpdate(
    { _id: "deviceCode" },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const raw = counter?.value ?? 1;
  const index = (typeof raw === "bigint" ? Number(raw) : raw) - 1;
  const device: Device = {
    _id: deviceId,
    userId,
    code: deviceCodeFromIndex(index),
    label: label.slice(0, 80),
    lastSeenAt: now,
    userAgent: userAgent.slice(0, 400),
  };
  await k.devices.insertOne(device);
  return device;
}

export async function revokeDevice(db: Db, deviceId: string, byUserId: string): Promise<void> {
  await cols(db).devices.updateOne(
    { _id: deviceId },
    { $set: { revokedAt: new Date().toISOString() } },
  );
  await audit(db, undefined, {
    userId: byUserId,
    deviceId,
    entity: "device",
    entityId: deviceId,
    action: "edit",
    detail: "revoked",
  });
}

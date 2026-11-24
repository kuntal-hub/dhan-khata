/**
 * Typed helpers over the `meta` key/value table (spec §8.6): cursor, deviceId, deviceCode,
 * lastSyncAt, activeGodownId, `voucherSeq:<godownId>:<type>`, session, PIN, access snapshot.
 * Every helper uses the active database; inside a repo transaction they join that transaction.
 */
import { v7 as uuidv7 } from "uuid";
import { voucherSeqKey } from "@/domain/numbering";
import type { Business, DocType, GodownSettings, User } from "@/domain/schemas";
import { db } from "./dexie";

export const META = {
  cursor: "cursor",
  deviceId: "deviceId",
  deviceCode: "deviceCode",
  lastSyncAt: "lastSyncAt",
  activeGodownId: "activeGodownId",
  session: "session",
  pin: "pin",
  access: "access",
  pendingPurge: "pendingPurge",
  bootstrapped: "bootstrapped",
  prefs: "prefs",
  storageNoticeShown: "storageNoticeShown",
  iosInstallShown: "iosInstallShown",
  syncLock: "syncLock",
  /** The owner's business (profile, mon size, deductions switch), pulled from the server. */
  business: "business",
  /** Pending v1 work held by the Dexie v4 upgrade (see db/upgradeV4.ts). */
  legacyV1: "legacyV1",
} as const;

export interface SessionMeta {
  user: User;
  deviceId: string;
  deviceCode: string;
  loggedInAt: string;
}

export interface AccessMeta {
  accessVersion: number;
  godownIds: string[];
}

export interface PinMeta {
  saltB64: string;
  hashB64: string;
  iterations: number;
  failedAttempts: number;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db().meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db().meta.put({ key, value });
}

export async function deleteMeta(key: string): Promise<void> {
  await db().meta.delete(key);
}

/** This device's id: generated once on the device and kept forever (survives logout). */
export async function getOrCreateDeviceId(): Promise<string> {
  const d = db();
  return d.transaction("rw", d.meta, async () => {
    const existing = await getMeta<string>(META.deviceId);
    if (existing) return existing;
    const id = uuidv7();
    await setMeta(META.deviceId, id);
    return id;
  });
}

/** Next number in the per-godown, per-device, per-type sequence (call inside a transaction). */
export async function nextVoucherSeq(godownId: string, type: DocType): Promise<number> {
  const key = voucherSeqKey(godownId, type);
  const cur = (await getMeta<number>(key)) ?? 0;
  const next = cur + 1;
  await setMeta(key, next);
  return next;
}

export function getSession(): Promise<SessionMeta | undefined> {
  return getMeta<SessionMeta>(META.session);
}

export function godownSettingsKey(godownId: string): string {
  return `godownSettings:${godownId}`;
}

export function getGodownSettings(godownId: string): Promise<GodownSettings | undefined> {
  return getMeta<GodownSettings>(godownSettingsKey(godownId));
}

export function getBusiness(): Promise<Business | undefined> {
  return getMeta<Business>(META.business);
}

/**
 * Online session (spec §12.8): login registers the device; the access token lives in memory
 * only; the refresh cookie (httpOnly) renews it. Offline the app needs no token (PIN unlock).
 * Token problems never touch local data: sync pauses and the UI asks to log in again.
 */
import { DomainError } from "@/domain/errors";
import type { User } from "@/domain/schemas";
import { db, writeTables } from "../db/dexie";
import {
  META,
  deleteMeta,
  getMeta,
  getOrCreateDeviceId,
  getSession,
  setMeta,
  type SessionMeta,
} from "../db/meta";
import {
  ApiCallError,
  accessToken,
  apiCall,
  setAccessToken,
  type CallOptions,
} from "../sync/transport";

export interface AuthResponse {
  accessToken: string;
  accessExpiresAt: string;
  user: User;
  device: { id: string; code: string };
  serverTime: string;
}

export type AuthEvent = "reauth-required" | "device-revoked" | "signed-in";
const listeners = new Set<(e: AuthEvent) => void>();

export function onAuthEvent(fn: (e: AuthEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(e: AuthEvent) {
  listeners.forEach((l) => l(e));
}

/** Codes meaning "this session can't continue; log in again" (data stays intact). */
const REAUTH_CODES = new Set([
  "UNAUTHORIZED",
  "TOKEN_EXPIRED",
  "REFRESH_INVALID",
  "REFRESH_REUSED",
  "DEVICE_MISMATCH",
  "USER_INACTIVE",
]);

export function isReauthError(e: unknown): boolean {
  return e instanceof ApiCallError && REAUTH_CODES.has(e.code);
}

export function isRevokedError(e: unknown): boolean {
  return e instanceof ApiCallError && e.code === "DEVICE_REVOKED";
}

async function storeAuth(res: AuthResponse): Promise<SessionMeta> {
  setAccessToken(res.accessToken, res.accessExpiresAt);
  const prev = await getSession();
  const session: SessionMeta = {
    user: res.user,
    deviceId: res.device.id,
    deviceCode: res.device.code,
    loggedInAt: prev?.user._id === res.user._id ? prev.loggedInAt : new Date().toISOString(),
  };
  await setMeta(META.session, session);
  return session;
}

/** Log in (online). Logging in as a DIFFERENT user is blocked while ops are pending. */
export async function login(input: {
  phone: string;
  password: string;
  deviceLabel?: string;
}): Promise<SessionMeta> {
  const deviceId = await getOrCreateDeviceId();
  const prev = await getSession();
  const res = await apiCall<AuthResponse>("/api/auth/login", {
    body: {
      phone: input.phone,
      password: input.password,
      deviceId,
      ...(input.deviceLabel ? { deviceLabel: input.deviceLabel } : {}),
    },
  });
  if (prev && prev.user._id !== res.user._id && (await db().outbox.count()) > 0) {
    setAccessToken(null);
    throw new DomainError("FORBIDDEN", "pending-ops-of-other-user");
  }
  if (prev && prev.user._id !== res.user._id) await wipeLocalData();
  const session = await storeAuth(res);
  emit("signed-in");
  return session;
}

/** Renew the access token with the refresh cookie (rotating). */
export async function refreshAccess(): Promise<SessionMeta> {
  const deviceId = await getOrCreateDeviceId();
  try {
    const res = await apiCall<AuthResponse>("/api/auth/refresh", { body: { deviceId } });
    return await storeAuth(res);
  } catch (e) {
    if (isRevokedError(e)) emit("device-revoked");
    else if (isReauthError(e)) emit("reauth-required");
    throw e;
  }
}

export function hasValidAccessToken(marginMs = 30_000): boolean {
  const t = accessToken();
  return t.token !== null && t.expiresAt - marginMs > Date.now();
}

/** Authenticated call: refreshes the token when needed and retries once on TOKEN_EXPIRED. */
export async function authedCall<T>(path: string, opts: CallOptions = {}): Promise<T> {
  if (!hasValidAccessToken()) await refreshAccess();
  try {
    return await apiCall<T>(path, { ...opts, auth: true });
  } catch (e) {
    if (e instanceof ApiCallError && e.code === "TOKEN_EXPIRED") {
      await refreshAccess();
      return apiCall<T>(path, { ...opts, auth: true });
    }
    if (isRevokedError(e)) emit("device-revoked");
    else if (isReauthError(e)) emit("reauth-required");
    throw e;
  }
}

export class LogoutBlockedError extends Error {
  constructor(public readonly pending: number) {
    super("LOGOUT_BLOCKED");
    this.name = "LogoutBlockedError";
  }
}

/** Remove business data from this device (keeps deviceId, voucher sequences and prefs). */
async function wipeLocalData(): Promise<void> {
  const d = db();
  await d.transaction("rw", writeTables(d), async () => {
    for (const t of writeTables(d)) {
      if (t === d.meta || t === d.outbox) continue;
      await t.clear();
    }
    for (const key of [
      META.cursor,
      META.access,
      META.pendingPurge,
      META.bootstrapped,
      META.activeGodownId,
      META.lastSyncAt,
    ]) {
      await deleteMeta(key);
    }
    const settingsKeys = await d.meta
      .filter((m) => m.key.startsWith("godownSettings:"))
      .primaryKeys();
    await d.meta.bulkDelete(settingsKeys);
  });
}

/**
 * Log out. BLOCKED while any outbox op exists (spec §12.8) — the UI shows the count and offers
 * "export unsynced data". Then local business data and the PIN are removed from the device.
 */
export async function logout(): Promise<void> {
  const pending = await db().outbox.count();
  if (pending > 0) throw new LogoutBlockedError(pending);
  try {
    await apiCall("/api/auth/logout", { body: {} });
  } catch {
    // Offline logout still clears the device; the refresh token expires on its own.
  }
  setAccessToken(null);
  await wipeLocalData();
  await deleteMeta(META.session);
  await deleteMeta(META.pin);
}

export { getSession };
export async function getPrefs<T>(): Promise<T | undefined> {
  return getMeta<T>(META.prefs);
}

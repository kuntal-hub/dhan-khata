/**
 * Authentication (spec §12.8, §14):
 *  - passwords: argon2id (@node-rs/argon2),
 *  - access token: 15-minute HS256 JWT (jose) carrying user + device,
 *  - refresh token: 90-day random token in an httpOnly, Secure, SameSite=Strict cookie, stored
 *    hashed, bound to the device, ROTATED on every use with reuse detection (a reused token
 *    revokes its whole family),
 *  - login rate limit per phone and per IP (Mongo TTL collection).
 */
import { createHmac, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { SignJWT, errors as joseErrors, jwtVerify } from "jose";
import type { Db } from "mongodb";
import { v7 as uuidv7 } from "uuid";
import type { Device, User } from "@/domain/schemas";
import { cols, type UserDoc } from "./db";
import { serverEnv } from "./env";
import { ApiError, getCookie } from "./http";

const ISSUER = "dhan-gola";
export const REFRESH_COOKIE = "dk_rt";
/** Two tabs refreshing at once: the second within this window gets an access token only. */
const REFRESH_GRACE_MS = 30_000;

export async function hashPassword(password: string): Promise<string> {
  return hash(password); // argon2id, m=19 MiB, t=2, p=1 (library defaults)
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// A real hash to verify against for unknown phones (constant-ish time, no user enumeration).
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hash("dhan-gola-dummy-password");
  return dummyHash;
}

export interface AccessClaims {
  userId: string;
  deviceId: string;
}

export async function signAccessToken(
  claims: AccessClaims,
): Promise<{ token: string; expiresAt: string }> {
  const env = serverEnv();
  const exp = Math.floor(Date.now() / 1000) + env.accessTtlSec;
  const token = await new SignJWT({ did: claims.deviceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(env.jwtSecret);
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, serverEnv().jwtSecret, {
      issuer: ISSUER,
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || typeof payload.did !== "string") {
      throw new ApiError(401, "UNAUTHORIZED");
    }
    return { userId: payload.sub, deviceId: payload.did };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof joseErrors.JWTExpired) throw new ApiError(401, "TOKEN_EXPIRED");
    throw new ApiError(401, "UNAUTHORIZED");
  }
}

export interface AuthContext {
  user: UserDoc;
  device: Device;
}

/** Verify the bearer token, the user (active) and the device (registered to them, not revoked). */
export async function authenticate(db: Db, request: Request): Promise<AuthContext> {
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) throw new ApiError(401, "UNAUTHORIZED");
  const claims = await verifyAccessToken(m[1]!.trim());
  const k = cols(db);
  const [user, device] = await Promise.all([
    k.users.findOne({ _id: claims.userId }),
    k.devices.findOne({ _id: claims.deviceId }),
  ]);
  if (!user) throw new ApiError(401, "UNAUTHORIZED");
  if (!device || device.userId !== user._id) throw new ApiError(401, "UNAUTHORIZED");
  if (device.revokedAt) throw new ApiError(401, "DEVICE_REVOKED");
  if (!user.active) throw new ApiError(403, "USER_INACTIVE");
  assertMigrated(user);
  return { user, device };
}

/**
 * A v1 database (not yet run through `pnpm migrate:v2 --apply`) has users without a business.
 * v2 clients must never sync from it: its documents have the old shape (docs/MIGRATION_V2.md).
 */
export function assertMigrated(user: { businessId?: string }): void {
  if (!user.businessId) throw new ApiError(503, "DATA_NOT_MIGRATED");
}

/** The user as sent to clients (never the password or recovery-code hash). */
export function publicUser(u: UserDoc): User {
  const { passwordHash: _h, recoveryCodeHash: _r, ...rest } = u;
  return rest;
}

// ── Refresh tokens ────────────────────────────────────────────────────────────

function tokenId(token: string): string {
  return createHmac("sha256", serverEnv().refreshSecret).update(token).digest("hex");
}

export async function issueRefreshToken(
  db: Db,
  userId: string,
  deviceId: string,
  familyId: string = uuidv7(),
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await cols(db).refreshTokens.insertOne({
    _id: tokenId(token),
    userId,
    deviceId,
    familyId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + serverEnv().refreshTtlDays * 86_400_000),
  });
  return token;
}

export function refreshCookie(token: string): string {
  const env = serverEnv();
  const maxAge = env.refreshTtlDays * 86_400;
  return [
    `${REFRESH_COOKIE}=${token}`,
    "Path=/api/auth",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(env.insecureCookie ? [] : ["Secure"]),
  ].join("; ");
}

export function clearRefreshCookie(): string {
  const env = serverEnv();
  return [
    `${REFRESH_COOKIE}=`,
    "Path=/api/auth",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    ...(env.insecureCookie ? [] : ["Secure"]),
  ].join("; ");
}

export interface RotateResult {
  userId: string;
  deviceId: string;
  /** New refresh token (absent inside the concurrent-refresh grace window). */
  newToken?: string;
}

/** Rotate a refresh token. Reuse of a spent token revokes the whole family (theft defence). */
export async function rotateRefreshToken(
  db: Db,
  request: Request,
  deviceId: string,
): Promise<RotateResult> {
  const token = getCookie(request, REFRESH_COOKIE);
  if (!token) throw new ApiError(401, "REFRESH_INVALID");
  const k = cols(db);
  const id = tokenId(token);
  const doc = await k.refreshTokens.findOne({ _id: id });
  if (!doc || doc.expiresAt.getTime() <= Date.now()) throw new ApiError(401, "REFRESH_INVALID");
  if (doc.deviceId !== deviceId) throw new ApiError(401, "DEVICE_MISMATCH");

  const claimed = await k.refreshTokens.findOneAndUpdate(
    { _id: id, usedAt: { $exists: false } },
    { $set: { usedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) {
    const spent = await k.refreshTokens.findOne({ _id: id });
    if (spent?.usedAt && Date.now() - spent.usedAt.getTime() <= REFRESH_GRACE_MS) {
      return { userId: doc.userId, deviceId: doc.deviceId };
    }
    await k.refreshTokens.deleteMany({ familyId: doc.familyId });
    throw new ApiError(401, "REFRESH_REUSED");
  }
  const newToken = await issueRefreshToken(db, doc.userId, doc.deviceId, doc.familyId);
  return { userId: doc.userId, deviceId: doc.deviceId, newToken };
}

export async function revokeRefreshFamilyOf(db: Db, request: Request): Promise<void> {
  const token = getCookie(request, REFRESH_COOKIE);
  if (!token) return;
  const doc = await cols(db).refreshTokens.findOne({ _id: tokenId(token) });
  if (doc) await cols(db).refreshTokens.deleteMany({ familyId: doc.familyId });
}

// ── Login rate limiting ──────────────────────────────────────────────────────

const WINDOW_MS = 15 * 60_000;
const MAX_PER_PHONE = 5;
const MAX_PER_IP = 20;

export async function assertLoginAllowed(db: Db, phone: string, ip: string): Promise<void> {
  const since = new Date(Date.now() - WINDOW_MS);
  const k = cols(db).loginAttempts;
  const [byPhone, byIp] = await Promise.all([
    k.countDocuments({ key: `phone:${phone}`, at: { $gte: since } }),
    k.countDocuments({ key: `ip:${ip}`, at: { $gte: since } }),
  ]);
  if (byPhone >= MAX_PER_PHONE || byIp >= MAX_PER_IP) throw new ApiError(429, "RATE_LIMITED");
}

export async function recordLoginFailure(db: Db, phone: string, ip: string): Promise<void> {
  const at = new Date();
  const expiresAt = new Date(at.getTime() + WINDOW_MS);
  await cols(db).loginAttempts.insertMany([
    { _id: uuidv7(), key: `phone:${phone}`, at, expiresAt },
    { _id: uuidv7(), key: `ip:${ip}`, at, expiresAt },
  ]);
}

export async function clearLoginFailures(db: Db, phone: string): Promise<void> {
  await cols(db).loginAttempts.deleteMany({ key: `phone:${phone}` });
}

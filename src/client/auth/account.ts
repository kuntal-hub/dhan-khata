/**
 * Account calls (requirement_v2 §2.2): registration (first owner), forgot password with the
 * recovery code, recovery-code regeneration, business profile, sessions, empty-Gola delete.
 * Registration and recovery sign this device in, like login.
 */
import type { Business } from "@/domain/schemas";
import { db } from "../db/dexie";
import { META, getOrCreateDeviceId, getSession, setMeta, type SessionMeta } from "../db/meta";
import { apiCall } from "../sync/transport";
import { authedCall, emit, storeAuth, type AuthResponse } from "./session";
import { DomainError } from "@/domain/errors";

export async function registrationStatus(): Promise<{ registrationOpen: boolean }> {
  return apiCall<{ registrationOpen: boolean }>("/api/auth/status");
}

export interface RegisterInput {
  name: string;
  mobile: string;
  password: string;
  businessName: string;
  businessAddress?: string;
  language?: "bn" | "en";
  deviceLabel?: string;
}

/** Register the first owner. Returns the session and the recovery code (show it ONCE). */
export async function register(
  input: RegisterInput,
): Promise<{ session: SessionMeta; recoveryCode: string }> {
  const deviceId = await getOrCreateDeviceId();
  const res = await apiCall<AuthResponse & { recoveryCode: string }>("/api/auth/register", {
    body: { ...input, deviceId },
  });
  const session = await storeAuth(res);
  emit("signed-in");
  return { session, recoveryCode: res.recoveryCode };
}

/** Forgot password: mobile + recovery code + new password. Returns the NEW recovery code. */
export async function recoverPassword(input: {
  mobile: string;
  recoveryCode: string;
  newPassword: string;
  deviceLabel?: string;
}): Promise<{ session: SessionMeta; recoveryCode: string }> {
  const deviceId = await getOrCreateDeviceId();
  const prev = await getSession();
  const res = await apiCall<AuthResponse & { recoveryCode: string }>("/api/auth/recover", {
    body: { ...input, deviceId },
  });
  if (prev && prev.user._id !== res.user._id && (await db().outbox.count()) > 0) {
    throw new DomainError("FORBIDDEN", "pending-ops-of-other-user");
  }
  const session = await storeAuth(res);
  emit("signed-in");
  return { session, recoveryCode: res.recoveryCode };
}

/** A new recovery code (the old one stops working). Needs the current password. */
export async function regenerateRecoveryCode(password: string): Promise<string> {
  const r = await authedCall<{ recoveryCode: string }>("/api/me/recovery", { body: { password } });
  return r.recoveryCode;
}

export interface BusinessProfileInput {
  name: string;
  address?: string;
  mobile?: string;
  /** "" removes the logo; undefined keeps it. */
  logoDataUrl?: string;
  monKg?: number;
  deductionsEnabled?: boolean;
}

/** Owner, online: update the business profile; the device copy updates at once. */
export async function updateBusinessProfile(input: BusinessProfileInput): Promise<Business> {
  const r = await authedCall<{ business: Business }>("/api/business", { body: input });
  await setMeta(META.business, r.business);
  return r.business;
}

export interface SessionRow {
  id: string;
  code: string;
  label: string;
  userAgent: string;
  lastSeenAt: string;
  revoked: boolean;
  current: boolean;
}

export async function listSessions(): Promise<SessionRow[]> {
  return (await authedCall<{ sessions: SessionRow[] }>("/api/me/sessions")).sessions;
}

export async function revokeSession(deviceId: string): Promise<void> {
  await authedCall("/api/me/sessions/revoke", { body: { deviceId } });
}

/** Owner, online: delete a Gola with no transactions (others can only be archived). */
export async function deleteEmptyGola(godownId: string): Promise<void> {
  await authedCall("/api/godowns/delete", { body: { godownId } });
}

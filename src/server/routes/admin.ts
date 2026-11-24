/**
 * Phase 5 routes: web push, cron, integrity, storage, users/devices, app settings, my prefs and
 * password, client error reports, backup/restore, sync-log compaction. Errors are codes.
 */
import { z } from "zod";
import {
  AccessSchema,
  AppSettingsSchema,
  ClientErrorsSchema,
  CreateUserSchema,
  PrefsSchema,
  addUser,
  changeMyPassword,
  compactSyncLogs,
  listClientErrors,
  listUsers,
  makeBackup,
  recomputeIntegritySummaries,
  recordClientErrors,
  resetUserPassword,
  restoreBackup,
  revokeUserDevice,
  serverIntegrity,
  setAppSettings,
  setMyPrefs,
  storageUsage,
  updateUserAccess,
  type Backup,
} from "../admin";
import { authenticate } from "../auth";
import { getDb } from "../db";
import { ApiError, handle, json, readJson } from "../http";
import {
  PushSubscriptionSchema,
  assertCronSecret,
  getAppSettings,
  sendDigest,
  subscribe,
  unsubscribe,
  vapidPublicKey,
} from "../push";

const Id = z.string().min(1).max(64);

// ── Push ──
export function pushKey(request: Request): Promise<Response> {
  return handle("push/key", request, async () => json({ publicKey: vapidPublicKey() }));
}

export function pushSubscribe(request: Request): Promise<Response> {
  return handle("push/subscribe", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const sub = PushSubscriptionSchema.parse(await readJson(request));
    await subscribe(db, auth.user, auth.device._id, sub);
    return json({ ok: true });
  });
}

export function pushUnsubscribe(request: Request): Promise<Response> {
  return handle("push/unsubscribe", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const { endpoint } = z
      .strictObject({ endpoint: z.string().max(1000) })
      .parse(await readJson(request));
    await unsubscribe(db, auth.user, endpoint);
    return json({ ok: true });
  });
}

// ── Cron (GitHub Actions, header x-cron-secret) ──
export function cronDaily(request: Request): Promise<Response> {
  return handle("cron/daily", request, async () => {
    assertCronSecret(request);
    const db = await getDb();
    const started = Date.now();
    await db.command({ ping: 1 });
    const digest = await sendDigest(db);
    const integrity = await recomputeIntegritySummaries(db);
    return json({ ok: true, digest, integrity, ms: Date.now() - started });
  });
}

/** Weekly storage check: 507 (alert) when the database is above the warning size. */
export function cronStorage(request: Request): Promise<Response> {
  return handle("cron/storage", request, async () => {
    assertCronSecret(request);
    const db = await getDb();
    const s = (await db.command({ dbStats: 1 })) as { dataSize?: number; indexSize?: number };
    const bytes = (s.dataSize ?? 0) + (s.indexSize ?? 0);
    const warn = 400 * 1024 * 1024;
    return json({ ok: bytes < warn, bytes, warnBytes: warn }, { status: bytes < warn ? 200 : 507 });
  });
}

// ── Owner admin ──
export function integrity(request: Request): Promise<Response> {
  return handle("admin/integrity", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const godownId = Id.parse(new URL(request.url).searchParams.get("godownId"));
    return json(await serverIntegrity(db, auth.user, godownId));
  });
}

export function storage(request: Request): Promise<Response> {
  return handle("admin/storage", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    return json(await storageUsage(db, auth.user));
  });
}

export function users(request: Request): Promise<Response> {
  return handle("admin/users", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    if (request.method === "GET") return json(await listUsers(db, auth.user));
    const body = CreateUserSchema.parse(await readJson(request));
    return json({ user: await addUser(db, auth.user, body) }, { status: 201 });
  });
}

export function userAccess(request: Request): Promise<Response> {
  return handle("admin/users/access", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const body = z
      .strictObject({ userId: Id, access: AccessSchema, active: z.boolean().optional() })
      .parse(await readJson(request));
    await updateUserAccess(db, auth.user, body.userId, body.access, body.active);
    return json({ ok: true });
  });
}

export function userPassword(request: Request): Promise<Response> {
  return handle("admin/users/password", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const body = z
      .strictObject({ userId: Id, password: z.string().min(6).max(200) })
      .parse(await readJson(request));
    await resetUserPassword(db, auth.user, body.userId, body.password);
    return json({ ok: true });
  });
}

export function deviceRevoke(request: Request): Promise<Response> {
  return handle("admin/devices/revoke", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const { deviceId } = z.strictObject({ deviceId: Id }).parse(await readJson(request));
    if (deviceId === auth.device._id) throw new ApiError(400, "BAD_REQUEST", "self");
    await revokeUserDevice(db, auth.user, deviceId);
    return json({ ok: true });
  });
}

export function appSettings(request: Request): Promise<Response> {
  return handle("admin/settings", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    if (request.method === "GET") {
      const s = await getAppSettings(db);
      return json({ digestHour: s.digestHour, defaultLanguage: s.defaultLanguage });
    }
    await setAppSettings(db, auth.user, AppSettingsSchema.parse(await readJson(request)));
    return json({ ok: true });
  });
}

export function errorsList(request: Request): Promise<Response> {
  return handle("admin/errors", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    return json({ errors: await listClientErrors(db, auth.user) });
  });
}

export function backup(request: Request): Promise<Response> {
  return handle("admin/backup", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const g = new URL(request.url).searchParams.get("godownId");
    return json(await makeBackup(db, auth.user, g ? Id.parse(g) : undefined));
  });
}

export function restore(request: Request): Promise<Response> {
  return handle("admin/restore", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const body = (await readJson(request, 6_000_000)) as Backup;
    return json({ counts: await restoreBackup(db, auth.user, body) });
  });
}

export function compact(request: Request): Promise<Response> {
  return handle("admin/compact", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    return json(await compactSyncLogs(db, auth.user));
  });
}

// ── Me ──
export function myPrefs(request: Request): Promise<Response> {
  return handle("me/prefs", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    await setMyPrefs(db, auth.user, PrefsSchema.parse(await readJson(request)));
    return json({ ok: true });
  });
}

export function myPassword(request: Request): Promise<Response> {
  return handle("me/password", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const body = z
      .strictObject({ current: z.string().min(1).max(200), next: z.string().min(6).max(200) })
      .parse(await readJson(request));
    await changeMyPassword(db, auth.user, body.current, body.next);
    return json({ ok: true });
  });
}

export function clientErrors(request: Request): Promise<Response> {
  return handle("diagnostics/errors", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const body = ClientErrorsSchema.parse(await readJson(request));
    return json({ saved: await recordClientErrors(db, auth.user, auth.device._id, body) });
  });
}

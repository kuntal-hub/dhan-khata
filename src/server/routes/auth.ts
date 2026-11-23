/** Auth route logic (login / refresh / logout). Route files under src/app/api only delegate. */
import { z } from "zod";
import { normalizePhone } from "@/domain/phone";
import { LoginRequestSchema } from "@/domain/schemas";
import {
  assertLoginAllowed,
  clearLoginFailures,
  clearRefreshCookie,
  dummyPasswordHash,
  issueRefreshToken,
  publicUser,
  recordLoginFailure,
  refreshCookie,
  revokeRefreshFamilyOf,
  rotateRefreshToken,
  signAccessToken,
  verifyPassword,
} from "../auth";
import { audit } from "../changelog";
import { cols, getDb } from "../db";
import { ApiError, clientIp, handle, json, readJson } from "../http";
import { registerDevice } from "../users";

export function login(request: Request): Promise<Response> {
  return handle("auth/login", request, async () => {
    const body = LoginRequestSchema.parse(await readJson(request));
    const phone = normalizePhone(body.phone);
    if (!phone) throw new ApiError(401, "BAD_CREDENTIALS");
    const db = await getDb();
    const ip = clientIp(request);
    await assertLoginAllowed(db, phone, ip);
    const user = await cols(db).users.findOne({ phone });
    const ok = await verifyPassword(
      user?.passwordHash ?? (await dummyPasswordHash()),
      body.password,
    );
    if (!user || !ok) {
      await recordLoginFailure(db, phone, ip);
      throw new ApiError(401, "BAD_CREDENTIALS");
    }
    if (!user.active) throw new ApiError(403, "USER_INACTIVE");
    await clearLoginFailures(db, phone);
    const device = await registerDevice(
      db,
      body.deviceId,
      user._id,
      body.deviceLabel ?? "",
      request.headers.get("user-agent") ?? "",
    );
    const access = await signAccessToken({ userId: user._id, deviceId: device._id });
    const refresh = await issueRefreshToken(db, user._id, device._id);
    await audit(db, undefined, {
      userId: user._id,
      deviceId: device._id,
      entity: "user",
      entityId: user._id,
      action: "login",
    });
    return json(
      {
        accessToken: access.token,
        accessExpiresAt: access.expiresAt,
        user: publicUser(user),
        device: { id: device._id, code: device.code },
        serverTime: new Date().toISOString(),
      },
      { headers: { "Set-Cookie": refreshCookie(refresh) } },
    );
  });
}

const RefreshSchema = z.strictObject({ deviceId: z.string().min(1).max(64) });

export function refresh(request: Request): Promise<Response> {
  return handle("auth/refresh", request, async () => {
    const { deviceId } = RefreshSchema.parse(await readJson(request));
    const db = await getDb();
    const r = await rotateRefreshToken(db, request, deviceId);
    const k = cols(db);
    const [user, device] = await Promise.all([
      k.users.findOne({ _id: r.userId }),
      k.devices.findOne({ _id: r.deviceId }),
    ]);
    if (!user) throw new ApiError(401, "UNAUTHORIZED");
    if (!device || device.revokedAt) throw new ApiError(401, "DEVICE_REVOKED");
    if (!user.active) throw new ApiError(403, "USER_INACTIVE");
    await k.devices.updateOne(
      { _id: device._id },
      { $set: { lastSeenAt: new Date().toISOString() } },
    );
    const access = await signAccessToken({ userId: user._id, deviceId: device._id });
    return json(
      {
        accessToken: access.token,
        accessExpiresAt: access.expiresAt,
        user: publicUser(user),
        device: { id: device._id, code: device.code },
        serverTime: new Date().toISOString(),
      },
      r.newToken ? { headers: { "Set-Cookie": refreshCookie(r.newToken) } } : {},
    );
  });
}

export function logout(request: Request): Promise<Response> {
  return handle("auth/logout", request, async () => {
    const db = await getDb();
    await revokeRefreshFamilyOf(db, request);
    return json({ ok: true }, { headers: { "Set-Cookie": clearRefreshCookie() } });
  });
}

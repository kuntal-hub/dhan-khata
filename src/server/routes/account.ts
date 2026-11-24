/**
 * Account routes (requirement_v2 §2.2): registration status, owner registration (auto-closing),
 * forgot password with the recovery code, recovery-code regeneration, business profile,
 * sessions (devices) and deleting an EMPTY Gola. Errors are codes, never sentences.
 */
import { z } from "zod";
import { normalizePhone } from "@/domain/phone";
import { DEFAULT_MON_KG } from "@/domain/units";
import {
  assertLoginAllowed,
  authenticate,
  clearLoginFailures,
  hashPassword,
  issueRefreshToken,
  publicUser,
  recordLoginFailure,
  refreshCookie,
  signAccessToken,
  verifyPassword,
} from "../auth";
import { createBusinessWithOwner } from "../business";
import { audit, logChanges } from "../changelog";
import { cols, getDb, getMongoClient, type UserDoc } from "../db";
import { ApiError, clientIp, handle, json, readJson } from "../http";
import { generateRecoveryCode, hashRecoveryCode, verifyRecoveryCode } from "../recovery";
import { registerDevice, revokeDevice } from "../users";
import type { Db } from "mongodb";

const Id = z.string().min(1).max(64);
const Mobile = z.string().min(10).max(15);
const Password = z.string().min(8).max(200);

/** `ALLOW_REGISTRATION`: auto (default: open until an owner exists) | true | false. */
export async function registrationOpen(db: Db): Promise<boolean> {
  const mode = (process.env.ALLOW_REGISTRATION ?? "auto").toLowerCase();
  if (mode === "true") return true;
  if (mode === "false") return false;
  return (await cols(db).users.countDocuments({ isOwner: true }, { limit: 1 })) === 0;
}

async function sessionPayload(
  db: Db,
  request: Request,
  user: UserDoc,
  deviceId: string,
  label: string,
) {
  const device = await registerDevice(
    db,
    deviceId,
    user._id,
    label,
    request.headers.get("user-agent") ?? "",
  );
  const access = await signAccessToken({ userId: user._id, deviceId: device._id });
  const refresh = await issueRefreshToken(db, user._id, device._id);
  return {
    body: {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      user: publicUser(user),
      device: { id: device._id, code: device.code },
      serverTime: new Date().toISOString(),
    },
    cookie: refreshCookie(refresh),
    deviceId: device._id,
  };
}

export function status(request: Request): Promise<Response> {
  return handle("auth/status", request, async () => {
    const db = await getDb();
    return json({ registrationOpen: await registrationOpen(db) });
  });
}

const RegisterSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  mobile: Mobile,
  password: Password,
  businessName: z.string().trim().min(1).max(120),
  businessAddress: z.string().trim().max(300).optional(),
  language: z.enum(["bn", "en"]).optional(),
  deviceId: Id,
  deviceLabel: z.string().max(80).optional(),
});

/** First-run owner registration: business + owner + recovery code; signs the device in. */
export function register(request: Request): Promise<Response> {
  return handle("auth/register", request, async () => {
    const body = RegisterSchema.parse(await readJson(request));
    const mobile = normalizePhone(body.mobile);
    if (!mobile) throw new ApiError(400, "BAD_REQUEST", "mobile");
    const db = await getDb();
    const mode = (process.env.ALLOW_REGISTRATION ?? "auto").toLowerCase();
    if (!(await registrationOpen(db))) throw new ApiError(403, "REGISTRATION_CLOSED");
    if (await cols(db).users.findOne({ phone: mobile })) throw new ApiError(409, "MOBILE_TAKEN");
    // Two people registering at the same moment: only the first gets the deployment (auto mode).
    if (mode === "auto") {
      try {
        await db
          .collection<{ _id: string; at: Date }>("locks")
          .insertOne({ _id: "owner-registration", at: new Date() });
      } catch {
        throw new ApiError(403, "REGISTRATION_CLOSED");
      }
    }
    const code = generateRecoveryCode();
    const { owner, business } = await createBusinessWithOwner(db, {
      ownerName: body.name,
      mobile,
      password: body.password,
      businessName: body.businessName,
      ...(body.businessAddress ? { businessAddress: body.businessAddress } : {}),
      recoveryCodeHash: await hashRecoveryCode(code),
      ...(body.language ? { language: body.language } : {}),
    });
    const s = await sessionPayload(db, request, owner, body.deviceId, body.deviceLabel ?? "");
    await audit(db, undefined, {
      userId: owner._id,
      deviceId: s.deviceId,
      entity: "business",
      entityId: business._id,
      action: "register",
    });
    return json({ ...s.body, recoveryCode: code }, { headers: { "Set-Cookie": s.cookie } });
  });
}

const RecoverSchema = z.strictObject({
  mobile: Mobile,
  recoveryCode: z.string().min(12).max(40),
  newPassword: Password,
  deviceId: Id,
  deviceLabel: z.string().max(80).optional(),
});

/** Forgot password: mobile + recovery code → new password + NEW recovery code (shown once). */
export function recover(request: Request): Promise<Response> {
  return handle("auth/recover", request, async () => {
    const body = RecoverSchema.parse(await readJson(request));
    const mobile = normalizePhone(body.mobile);
    if (!mobile) throw new ApiError(401, "RECOVERY_INVALID");
    const db = await getDb();
    const ip = clientIp(request);
    const key = `recover:${mobile}`;
    await assertLoginAllowed(db, key, ip);
    const user = await cols(db).users.findOne({ phone: mobile });
    const ok = await verifyRecoveryCode(user?.recoveryCodeHash, body.recoveryCode);
    if (!user || !ok) {
      await recordLoginFailure(db, key, ip);
      throw new ApiError(401, "RECOVERY_INVALID");
    }
    if (!user.active) throw new ApiError(403, "USER_INACTIVE");
    await clearLoginFailures(db, key);
    await clearLoginFailures(db, mobile);
    const code = generateRecoveryCode();
    const passwordHash = await hashPassword(body.newPassword);
    const recoveryCodeHash = await hashRecoveryCode(code);
    const now = new Date().toISOString();
    await cols(db).users.updateOne(
      { _id: user._id },
      { $set: { passwordHash, recoveryCodeHash, updatedAt: now } },
    );
    // Every other session must sign in again with the new password.
    await cols(db).refreshTokens.deleteMany({ userId: user._id });
    const fresh = (await cols(db).users.findOne({ _id: user._id }))!;
    const s = await sessionPayload(db, request, fresh, body.deviceId, body.deviceLabel ?? "");
    await audit(db, undefined, {
      userId: user._id,
      deviceId: s.deviceId,
      entity: "user",
      entityId: user._id,
      action: "password_reset",
    });
    return json({ ...s.body, recoveryCode: code }, { headers: { "Set-Cookie": s.cookie } });
  });
}

const RegenerateSchema = z.strictObject({ password: z.string().min(1).max(200) });

/** Signed-in owner: a new recovery code (the old one stops working). Needs the password. */
export function regenerateRecovery(request: Request): Promise<Response> {
  return handle("me/recovery", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const { password } = RegenerateSchema.parse(await readJson(request));
    if (!(await verifyPassword(auth.user.passwordHash, password))) {
      throw new ApiError(401, "BAD_CREDENTIALS");
    }
    const code = generateRecoveryCode();
    await cols(db).users.updateOne(
      { _id: auth.user._id },
      {
        $set: {
          recoveryCodeHash: await hashRecoveryCode(code),
          updatedAt: new Date().toISOString(),
        },
      },
    );
    await audit(db, undefined, {
      userId: auth.user._id,
      deviceId: auth.device._id,
      entity: "user",
      entityId: auth.user._id,
      action: "recovery_regenerate",
    });
    return json({ recoveryCode: code });
  });
}

const BusinessSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional(),
  mobile: z.string().trim().max(15).optional(),
  /** Compressed by the client; "" removes the logo. */
  logoDataUrl: z
    .string()
    .max(200_000)
    .regex(/^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)?$/)
    .optional(),
  monKg: z.number().int().min(1).max(100).optional(),
  deductionsEnabled: z.boolean().optional(),
});

/** Owner: edit the business profile (used on receipts, invoices, reports) and units/settings. */
export function updateBusiness(request: Request): Promise<Response> {
  return handle("business/update", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    if (!auth.user.isOwner) throw new ApiError(403, "FORBIDDEN");
    const body = BusinessSchema.parse(await readJson(request));
    const k = cols(db);
    const client = await getMongoClient();
    let out: unknown = null;
    await client.withSession((session) =>
      session.withTransaction(async () => {
        const cur = await k.businesses.findOne({ _id: auth.user.businessId }, { session });
        if (!cur) throw new ApiError(404, "NOT_FOUND");
        const rev = cur.rev + 1;
        const [seq] = await logChanges(db, session, [
          { godownId: null, entity: "business", entityId: cur._id, rev },
        ]);
        const { logoDataUrl: _old, address: _a, mobile: _m, ...rest } = cur;
        const next = {
          ...rest,
          name: body.name,
          ...(body.address ? { address: body.address } : {}),
          ...(body.mobile ? { mobile: body.mobile } : {}),
          ...(body.logoDataUrl === undefined
            ? cur.logoDataUrl
              ? { logoDataUrl: cur.logoDataUrl }
              : {}
            : body.logoDataUrl
              ? { logoDataUrl: body.logoDataUrl }
              : {}),
          monKg: body.monKg ?? cur.monKg ?? DEFAULT_MON_KG,
          settings: {
            ...cur.settings,
            ...(body.deductionsEnabled !== undefined
              ? { deductionsEnabled: body.deductionsEnabled }
              : {}),
          },
          rev,
          updatedAt: new Date().toISOString(),
          serverSeq: seq!,
        };
        await k.businesses.replaceOne({ _id: cur._id }, next, { session });
        await audit(db, session, {
          userId: auth.user._id,
          deviceId: auth.device._id,
          entity: "business",
          entityId: cur._id,
          action: "business_edit",
        });
        out = next;
      }),
    );
    return json({ business: out });
  });
}

/** The signed-in user's devices (sessions) with last-seen time. */
export function sessions(request: Request): Promise<Response> {
  return handle("me/sessions", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const devices = await cols(db)
      .devices.find({ userId: auth.user._id })
      .sort({ lastSeenAt: -1 })
      .toArray();
    return json({
      sessions: devices.map((d) => ({
        id: d._id,
        code: d.code,
        label: d.label,
        userAgent: d.userAgent,
        lastSeenAt: d.lastSeenAt,
        revoked: Boolean(d.revokedAt),
        current: d._id === auth.device._id,
      })),
    });
  });
}

const RevokeSchema = z.strictObject({ deviceId: Id });

/** Sign out one of my other devices (it must log in again; its local data is kept). */
export function revokeSession(request: Request): Promise<Response> {
  return handle("me/sessions/revoke", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const { deviceId } = RevokeSchema.parse(await readJson(request));
    if (deviceId === auth.device._id) throw new ApiError(400, "BAD_REQUEST", "current");
    const d = await cols(db).devices.findOne({ _id: deviceId });
    if (!d || d.userId !== auth.user._id) throw new ApiError(404, "NOT_FOUND");
    await revokeDevice(db, deviceId, auth.user._id);
    return json({ ok: true });
  });
}

const DeleteGodownSchema = z.strictObject({ godownId: Id });

/** Owner: delete a Gola that has NO transactions (otherwise archive it). */
export function deleteGodown(request: Request): Promise<Response> {
  return handle("godowns/delete", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    if (!auth.user.isOwner) throw new ApiError(403, "FORBIDDEN");
    const { godownId } = DeleteGodownSchema.parse(await readJson(request));
    const k = cols(db);
    const client = await getMongoClient();
    await client.withSession((session) =>
      session.withTransaction(async () => {
        const g = await k.godowns.findOne({ _id: godownId }, { session });
        if (!g || g.businessId !== auth.user.businessId) throw new ApiError(404, "NOT_FOUND");
        if (await k.vouchers.findOne({ godownId }, { session, projection: { _id: 1 } })) {
          throw new ApiError(409, "BAD_REQUEST", "HAS_TRANSACTIONS");
        }
        for (const c of [
          "parties",
          "varieties",
          "bankAccounts",
          "vehicles",
          "places",
          "expenseCategories",
          "reminders",
          "dayStatus",
          "accounts",
          "locations",
        ]) {
          await db.collection(c).deleteMany({ godownId }, { session });
        }
        await k.godownSettings.deleteOne({ _id: godownId }, { session });
        await k.godowns.deleteOne({ _id: godownId }, { session });
        await logChanges(db, session, [
          { godownId: null, entity: "godown", entityId: godownId, rev: g.rev + 1 },
        ]);
        await audit(db, session, {
          userId: auth.user._id,
          deviceId: auth.device._id,
          godownId,
          entity: "godown",
          entityId: godownId,
          action: "void",
        });
      }),
    );
    return json({ ok: true });
  });
}

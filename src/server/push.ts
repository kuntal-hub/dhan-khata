/**
 * Web Push reminder digest (spec §9.13): devices subscribe with the VAPID public key; the daily
 * cron sends each user one bilingual digest (their language) per godown they can access, only
 * when something is due. Expired subscriptions (404/410) are removed.
 */
import type { Db } from "mongodb";
import * as webpush from "web-push";
import { z } from "zod";
import { todayIST } from "@/domain/dates";
import type { Doc, Payment } from "@/domain/schemas";
import { billState, dueBillsOf } from "@/domain/v2/payments";
import { translate } from "@/i18n/translateAll";
import { cols, type AppSettingsDoc, type UserDoc } from "./db";
import { ApiError } from "./http";
import { godownIdsFor } from "./rbac";

export const PushSubscriptionSchema = z.strictObject({
  endpoint: z.url().max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export async function getAppSettings(db: Db): Promise<AppSettingsDoc> {
  return (
    (await cols(db).appSettings.findOne({ _id: "app" })) ?? {
      _id: "app",
      digestHour: 8,
      defaultLanguage: "bn",
      updatedAt: new Date(0).toISOString(),
    }
  );
}

export async function subscribe(
  db: Db,
  user: UserDoc,
  deviceId: string,
  sub: z.infer<typeof PushSubscriptionSchema>,
): Promise<void> {
  await cols(db).pushSubscriptions.replaceOne(
    { _id: sub.endpoint },
    {
      userId: user._id,
      deviceId,
      keys: sub.keys,
      createdAt: new Date().toISOString(),
    },
    { upsert: true },
  );
}

export async function unsubscribe(db: Db, user: UserDoc, endpoint: string): Promise<void> {
  await cols(db).pushSubscriptions.deleteOne({ _id: endpoint, userId: user._id });
}

export interface DigestLine {
  godownId: string;
  godownName: string;
  today: number;
  overdue: number;
}

/** What is due for one user today, per accessible godown (nothing when all zero). */
export async function digestFor(db: Db, user: UserDoc, today: string): Promise<DigestLine[]> {
  const k = cols(db);
  const out: DigestLine[] = [];
  for (const g of await godownIdsFor(db, user)) {
    const godown = await k.godowns.findOne({ _id: g });
    if (!godown || godown.status !== "active") continue;
    const rems = await k.reminders.find({ godownId: g }).toArray();
    const state = new Map(rems.map((r) => [r._id, r] as const));
    let dueToday = 0;
    let overdue = 0;
    const count = (due: string) => {
      if (due === today) dueToday++;
      else if (due < today) overdue++;
    };
    // Manual reminders (stored).
    for (const r of rems) {
      if (r._id.startsWith("auto:") || r.status === "done") continue;
      count(r.status === "snoozed" && r.snoozeUntil ? r.snoozeUntil : r.dueDate);
    }
    // Automatic reminders: open bills with a due date (DECISIONS D13), with the owner's
    // done / snooze / changed date stored as `auto:<sourceId>`.
    const docs = (await k.vouchers.find({ godownId: g, status: "active" }).toArray()) as Doc[];
    const pays = new Map<string, Payment[]>();
    for (const p of docs) {
      if (p.type === "PAYMENT" && p.source.id)
        pays.set(p.source.id, [...(pays.get(p.source.id) ?? []), p]);
    }
    for (const doc of docs) {
      for (const b of dueBillsOf(doc)) {
        if (!b.dueDate) continue;
        if (billState(b, pays.get(b.sourceId) ?? [], today).duePaise <= 0n) continue;
        const s = state.get(`auto:${b.sourceId}`);
        if (s?.status === "done") continue;
        count(s?.status === "snoozed" && s.snoozeUntil ? s.snoozeUntil : (s?.dueDate ?? b.dueDate));
      }
    }
    if (dueToday + overdue > 0) {
      out.push({ godownId: g, godownName: godown.name, today: dueToday, overdue });
    }
  }
  return out;
}

export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<void>;

function defaultSender(): PushSender | null {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:dev@example.com", pub, priv);
  return async (sub, payload) => {
    await webpush.sendNotification(sub, payload, { TTL: 12 * 3600 });
  };
}

export interface DigestResult {
  sent: number;
  removed: number;
  users: number;
  skipped?: "NOT_YET" | "ALREADY_SENT" | "NO_VAPID";
}

/**
 * Send today's digest once per day, at or after the configured hour (IST).
 * `force` ignores the hour/once-per-day guard (tests, manual trigger).
 */
export async function sendDigest(
  db: Db,
  opts: { now?: Date; force?: boolean; sender?: PushSender } = {},
): Promise<DigestResult> {
  const now = opts.now ?? new Date();
  const today = todayIST(now);
  const hourIST = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
      .format(now)
      .slice(0, 2),
  );
  const settings = await getAppSettings(db);
  if (!opts.force) {
    if (hourIST < settings.digestHour) return { sent: 0, removed: 0, users: 0, skipped: "NOT_YET" };
    if (settings.lastDigestDate === today) {
      return { sent: 0, removed: 0, users: 0, skipped: "ALREADY_SENT" };
    }
  }
  const sender = opts.sender ?? defaultSender();
  if (!sender) return { sent: 0, removed: 0, users: 0, skipped: "NO_VAPID" };
  const k = cols(db);
  let sent = 0;
  let removed = 0;
  let users = 0;
  for (const user of await k.users.find({ active: true }).toArray()) {
    const subs = await k.pushSubscriptions.find({ userId: user._id }).toArray();
    if (subs.length === 0) continue;
    const lines = await digestFor(db, user, today);
    if (lines.length === 0) continue;
    users++;
    const lang = user.language;
    const payload = JSON.stringify({
      title: translate(lang, "reminder.digestTitle"),
      body: lines
        .map((l) =>
          translate(lang, "reminder.digestBody", {
            godown: l.godownName,
            today: String(l.today),
            overdue: String(l.overdue),
          }),
        )
        .join("\n"),
      url: "/dues?tab=reminders",
    });
    for (const s of subs) {
      try {
        await sender({ endpoint: s._id, keys: s.keys }, payload);
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await k.pushSubscriptions.deleteOne({ _id: s._id });
          removed++;
        }
      }
    }
  }
  await k.appSettings.updateOne(
    { _id: "app" },
    {
      $set: { lastDigestDate: today, updatedAt: now.toISOString() },
      $setOnInsert: { digestHour: settings.digestHour, defaultLanguage: settings.defaultLanguage },
    },
    { upsert: true },
  );
  return { sent, removed, users };
}

export function assertCronSecret(request: Request): void {
  const expected = process.env.CRON_SECRET;
  const got = request.headers.get("x-cron-secret");
  if (!expected || !got || got !== expected) throw new ApiError(401, "UNAUTHORIZED");
}

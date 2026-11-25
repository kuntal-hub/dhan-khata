/**
 * Online owner/admin calls + device maintenance (spec §6.6, §9.16, §12.9, §17).
 * Everything that changes business data still goes through the repo; these are server
 * administration calls (online) and device-level maintenance.
 */
import {
  accountTotals,
  diffAccountTotals,
  negativePositions,
  repostMismatches,
  trialOf,
  type AccountDiff,
  type NegativePosition,
} from "@/domain/integrity";
import type { Device, GodownRole, User } from "@/domain/schemas";
import { authedCall } from "./auth/session";
import { db } from "./db/dexie";
import { META, setMeta } from "./db/meta";
import { emitLocalWrite } from "./repo/notify";
import { pullAll } from "./sync/pull";

export interface GodownAccess {
  godownId: string;
  role: GodownRole;
  consolidated?: boolean;
}

export const listUsersOnline = () =>
  authedCall<{ users: User[]; devices: Device[] }>("/api/admin/users");

export const addUserOnline = (body: {
  name: string;
  phone: string;
  password: string;
  language?: "bn" | "en";
  godownAccess: GodownAccess[];
}) => authedCall<{ user: User }>("/api/admin/users", { body });

export const setUserAccessOnline = (userId: string, access: GodownAccess[], active?: boolean) =>
  authedCall("/api/admin/users/access", {
    body: { userId, access, ...(active !== undefined ? { active } : {}) },
  });

export const resetUserPasswordOnline = (userId: string, password: string) =>
  authedCall("/api/admin/users/password", { body: { userId, password } });

export const revokeDeviceOnline = (deviceId: string) =>
  authedCall("/api/admin/devices/revoke", { body: { deviceId } });

export interface AppSettingsDto {
  digestHour: number;
  defaultLanguage: "bn" | "en";
}
export const getAppSettingsOnline = () => authedCall<AppSettingsDto>("/api/admin/settings");
export const setAppSettingsOnline = (body: AppSettingsDto) =>
  authedCall("/api/admin/settings", { body });

export interface StorageDto {
  totalBytes: number;
  limitBytes: number;
  godowns: Array<{ godownId: string; docs: number; approxBytes: number }>;
}
export const storageOnline = () => authedCall<StorageDto>("/api/admin/storage");

export interface ClientErrorDto {
  _id: string;
  at: string;
  route: string;
  message: string;
  appVersion?: string;
}
export const clientErrorsOnline = () =>
  authedCall<{ errors: ClientErrorDto[] }>("/api/admin/errors");

export const compactOnline = () =>
  authedCall<{ changelog: number; appliedOps: number }>("/api/admin/compact", { body: {} });

export const savePrefsOnline = (prefs: {
  language: "bn" | "en";
  digits: "bn" | "en";
  name?: string;
}) => authedCall("/api/me/prefs", { body: prefs });

export const changePasswordOnline = (current: string, next: string) =>
  authedCall("/api/me/password", { body: { current, next } });

/** Owner: full backup JSON (one godown or all) — returns the text to download. */
export async function backupOnline(godownId?: string): Promise<string> {
  const q = godownId ? `?godownId=${encodeURIComponent(godownId)}` : "";
  return JSON.stringify(await authedCall<unknown>(`/api/admin/backup${q}`));
}

export const restoreOnline = (backup: unknown) =>
  authedCall<{ counts: Record<string, number> }>("/api/admin/restore", { body: backup });

// ── Integrity (§6.6) ─────────────────────────────────────────────────────────

export interface IntegrityReport {
  godownId: string;
  trial: { debitPaise: bigint; creditPaise: bigint; balanced: boolean };
  repostMismatches: string[];
  /** Stock positions that went below zero (§9.3). */
  negativeStock: NegativePosition[];
  staleOps: number;
  /** null = not compared (offline, or not the owner). */
  server: { diffs: AccountDiff[]; serverRepostMismatches: string[] } | null;
}

/** Full on-device check for one godown (+ server comparison when the owner is online). */
export async function runIntegrity(
  godownId: string,
  opts: { compareServer: boolean },
): Promise<IntegrityReport> {
  const d = db();
  const [lines, vouchers] = await Promise.all([
    d.ledgerLines
      .where("[godownId+date]")
      .between([godownId, ""], [godownId, "￿"], true, true)
      .toArray(),
    d.vouchers.where("godownId").equals(godownId).toArray(),
  ]);
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const staleOps = await d.outbox
    .filter((o) => o.godownId === godownId && o.createdAt < cutoff)
    .count();
  let server: IntegrityReport["server"] = null;
  if (opts.compareServer) {
    const s = await authedCall<{ accounts: Record<string, string>; repostMismatches: string[] }>(
      `/api/admin/integrity?godownId=${encodeURIComponent(godownId)}`,
    );
    server = {
      diffs: diffAccountTotals(accountTotals(lines), s.accounts),
      serverRepostMismatches: s.repostMismatches,
    };
  }
  return {
    godownId,
    trial: trialOf(lines),
    repostMismatches: repostMismatches(vouchers, lines),
    negativeStock: negativePositions(
      await d.stockMoves
        .where("[godownId+date]")
        .between([godownId, ""], [godownId, "￿"], true, true)
        .toArray(),
    ),
    staleOps,
    server,
  };
}

// ── Device maintenance ───────────────────────────────────────────────────────

/** Re-download everything (only with an empty outbox, so nothing local can be lost). */
export async function forceFullResync(): Promise<boolean> {
  if ((await db().outbox.count()) > 0) return false;
  await setMeta(META.cursor, 0);
  await pullAll();
  emitLocalWrite();
  return true;
}

interface UnsyncedExport {
  kind: "dhan-khata-unsynced";
  ops: Array<Record<string, unknown> & { opId: string; godownId: string | null }>;
}

/**
 * Re-import an "unsynced data" export from another phone (spec §12.9): its ops join this
 * device's outbox and are pushed on the next sync (the server de-duplicates by opId).
 */
export async function importUnsynced(text: string): Promise<number> {
  let data: UnsyncedExport;
  try {
    data = JSON.parse(text) as UnsyncedExport;
  } catch {
    throw new Error("INVALID");
  }
  if (data.kind !== "dhan-khata-unsynced" || !Array.isArray(data.ops)) throw new Error("INVALID");
  const d = db();
  let added = 0;
  await d.transaction("rw", d.outbox, async () => {
    for (const op of data.ops) {
      if (typeof op.opId !== "string" || !op.entity || !op.entityId) continue;
      if ((await d.outbox.where("opId").equals(op.opId).count()) > 0) continue;
      const { seq: _seq, ...rest } = op;
      await d.outbox.add({
        ...(rest as Record<string, unknown>),
        status: "pending",
        attempts: 0,
      } as never);
      added++;
    }
  });
  emitLocalWrite();
  return added;
}

/**
 * Sync engine (spec §12): push → pull, single-flight (per tab and across tabs), exponential
 * backoff with jitter on network/server failure (2 s → 5 min; network errors are never
 * rejections), paused while re-login is required. Online = a successful `/api/health`.
 */
import { db } from "../db/dexie";
import { META, getMeta } from "../db/meta";
import { isReauthError, isRevokedError, onAuthEvent } from "../auth/session";
import { withSyncLock } from "./locks";
import { pullAll, type PullProgress } from "./pull";
import { pushOnce, resetSending } from "./push";
import { NetworkError, apiCall } from "./transport";

export interface SyncStatus {
  online: boolean;
  running: boolean;
  pendingOps: number;
  errorOps: number;
  conflictOps: number;
  lastSyncAt: string | null;
  /** Tokens expired / invalid: sync paused, outbox intact, banner asks to log in again. */
  authRequired: boolean;
  deviceRevoked: boolean;
  /** device clock − server clock (ms), when known. */
  clockSkewMs: number | null;
  lastError: string | null;
}

export const MIN_BACKOFF_MS = 2_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
export const CLOCK_SKEW_WARN_MS = 5 * 60_000;

/** Next backoff delay: doubles from 2 s up to 5 min, ±20 % jitter. */
export function nextBackoff(prev: number, random: () => number = Math.random): number {
  const base = prev <= 0 ? MIN_BACKOFF_MS : Math.min(prev * 2, MAX_BACKOFF_MS);
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, Math.round(base * jitter)));
}

export async function outboxCounts(): Promise<
  Pick<SyncStatus, "pendingOps" | "errorOps" | "conflictOps">
> {
  const o = db().outbox;
  const [pendingOps, errorOps, conflictOps] = await Promise.all([
    o.where("status").anyOf("pending", "sending").count(),
    o.where("status").equals("error").count(),
    o.where("status").equals("conflict").count(),
  ]);
  return { pendingOps, errorOps, conflictOps };
}

export class SyncEngine {
  status: SyncStatus = {
    online: false,
    running: false,
    pendingOps: 0,
    errorOps: 0,
    conflictOps: 0,
    lastSyncAt: null,
    authRequired: false,
    deviceRevoked: false,
    clockSkewMs: null,
    lastError: null,
  };
  private listeners = new Set<(s: SyncStatus) => void>();
  private inflight: Promise<void> | null = null;
  private backoff = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubAuth: () => void;

  constructor() {
    this.unsubAuth = onAuthEvent((e) => {
      if (e === "reauth-required") this.set({ authRequired: true });
      if (e === "device-revoked") this.set({ deviceRevoked: true });
      if (e === "signed-in") {
        this.set({ authRequired: false });
        void this.syncNow();
      }
    });
  }

  dispose(): void {
    this.unsubAuth();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.listeners.clear();
  }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l(this.status));
  }

  async refreshCounts(): Promise<void> {
    const counts = await outboxCounts();
    const lastSyncAt = (await getMeta<string>(META.lastSyncAt)) ?? null;
    this.set({ ...counts, lastSyncAt });
  }

  /** Online check via the cheap health endpoint; also measures clock skew. */
  async checkOnline(): Promise<boolean> {
    try {
      const t0 = Date.now();
      const res = await apiCall<{ serverTime: string }>("/api/health");
      const t1 = Date.now();
      const server = Date.parse(res.serverTime);
      const skew = Number.isFinite(server) ? Math.round((t0 + t1) / 2 - server) : null;
      this.set({ online: true, clockSkewMs: skew });
      return true;
    } catch {
      this.set({ online: false });
      return false;
    }
  }

  /** Run one sync now (coalesces with a running one). */
  syncNow(opts: { onProgress?: (p: PullProgress) => void } = {}): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.run(opts).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(opts: { onProgress?: (p: PullProgress) => void }): Promise<void> {
    if (this.status.deviceRevoked) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (!(await this.checkOnline())) {
      await this.refreshCounts();
      return;
    }
    this.set({ running: true, lastError: null });
    try {
      await withSyncLock(async () => {
        await resetSending();
        for (let i = 0; i < 40; i++) {
          const r = await pushOnce();
          if (r.sent === 0 || !r.more) break;
        }
        await pullAll(opts.onProgress);
      });
      this.backoff = 0;
      this.set({ authRequired: false });
    } catch (e) {
      if (isRevokedError(e)) this.set({ deviceRevoked: true, lastError: "DEVICE_REVOKED" });
      else if (isReauthError(e)) this.set({ authRequired: true, lastError: "REAUTH" });
      else {
        if (e instanceof NetworkError) this.set({ online: false });
        this.set({ lastError: e instanceof Error ? e.message : "SYNC_FAILED" });
        this.scheduleRetry();
      }
    } finally {
      this.set({ running: false });
      await this.refreshCounts();
    }
  }

  private scheduleRetry(): void {
    this.backoff = nextBackoff(this.backoff);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, this.backoff);
  }
}

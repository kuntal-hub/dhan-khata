/**
 * Diagnostics (spec §16, §6.6): error reports are stored on the device (works offline) and
 * uploaded on the next sync; a light integrity check runs after every sync.
 */
import { trialOf } from "@/domain/integrity";
import { authedCall } from "./auth/session";
import { db } from "./db/dexie";
import { setMeta } from "./db/meta";

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export async function reportClientError(e: { route: string; message: string; stack?: string }) {
  await db().clientErrors.add({
    at: new Date().toISOString(),
    route: e.route.slice(0, 200),
    message: e.message.slice(0, 1000),
    ...(e.stack ? { stack: e.stack.slice(0, 4000) } : {}),
  });
}

/** Upload pending reports (best effort; kept on failure). */
export async function uploadClientErrors(): Promise<number> {
  const rows = await db().clientErrors.orderBy("at").limit(50).toArray();
  if (rows.length === 0) return 0;
  await authedCall("/api/diagnostics/errors", {
    body: {
      errors: rows.map((r) => ({
        at: r.at,
        route: r.route,
        message: r.message,
        ...(r.stack ? { stack: r.stack } : {}),
        appVersion: APP_VERSION,
      })),
    },
  });
  await db().clientErrors.bulkDelete(rows.map((r) => r.id!));
  return rows.length;
}

export interface QuickIntegrity {
  at: string;
  /** godownId → balanced? */
  balanced: Record<string, boolean>;
  /** Outbox ops older than 7 days (spec §6.6.3). */
  staleOps: number;
}

export const QUICK_INTEGRITY_KEY = "integrity:quick";

/** After every sync: trial balance per godown + outbox age (cheap; full check on demand). */
export async function quickIntegrity(): Promise<QuickIntegrity> {
  const d = db();
  const godowns = await d.godowns.toArray();
  const balanced: Record<string, boolean> = {};
  for (const g of godowns) {
    const lines = await d.ledgerLines
      .where("[godownId+date]")
      .between([g._id, ""], [g._id, "￿"], true, true)
      .toArray();
    balanced[g._id] = trialOf(lines).balanced;
  }
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const staleOps = await d.outbox.filter((o) => o.createdAt < cutoff).count();
  const out = { at: new Date().toISOString(), balanced, staleOps };
  await setMeta(QUICK_INTEGRITY_KEY, out);
  return out;
}

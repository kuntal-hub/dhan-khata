/**
 * Server-side test harness: env for the in-memory replica set, and simulated devices whose
 * `fetch` calls the real route handlers (with a per-device cookie jar), can go offline, or can
 * lose the response after the server applied the request.
 */
import { inject } from "vitest";
import { deleteDatabase, db, selectDatabase } from "@/client/db/dexie";
import { login } from "@/client/auth/session";
import { pullAll } from "@/client/sync/pull";
import { pushOnce, resetSending } from "@/client/sync/push";
import { setTransport, setAccessToken } from "@/client/sync/transport";
import { cols, getDb } from "@/server/db";
import * as authRoutes from "@/server/routes/auth";
import * as godownRoutes from "@/server/routes/godowns";
import * as partyRoutes from "@/server/routes/parties";
import * as syncRoutes from "@/server/routes/sync";

export function useTestServer(dbName: string): void {
  process.env.MONGODB_URI = inject("mongoUri");
  process.env.MONGODB_DB = `${dbName}_${Date.now().toString(36)}`;
  process.env.AUTH_JWT_SECRET = "test-jwt-secret-0123456789-0123456789-abcdef";
  process.env.AUTH_REFRESH_SECRET = "test-refresh-secret-0123456789-0123456789-xyz";
  process.env.AUTH_COOKIE_INSECURE = "1";
  process.env.DK_QUIET_LOGS = "1";
}

type Handler = (r: Request) => Promise<Response>;
const ROUTES: Record<string, Handler> = {
  "POST /api/auth/login": authRoutes.login,
  "POST /api/auth/refresh": authRoutes.refresh,
  "POST /api/auth/logout": authRoutes.logout,
  "POST /api/sync/push": syncRoutes.push,
  "GET /api/sync/pull": syncRoutes.pull,
  "POST /api/godowns": godownRoutes.create,
  "POST /api/godowns/archive": godownRoutes.archive,
  "POST /api/godowns/update": godownRoutes.update,
  "POST /api/parties/merge": partyRoutes.merge,
};

export class TestDevice {
  jar = new Map<string, string>();
  offline = false;
  /** When set, the next request matching it reaches the server but its response is lost. */
  dropResponseFor: string | null = null;
  requests: string[] = [];

  constructor(public readonly name: string) {}

  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname}`;
    this.requests.push(key);
    if (this.offline) throw new TypeError("Failed to fetch");
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, serverTime: new Date().toISOString() });
    }
    const handler = ROUTES[key];
    if (!handler) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    const headers = new Headers(init.headers);
    if (this.jar.size) {
      headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    const req = new Request(url, {
      method,
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    const res = await handler(req);
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [name, ...v] = pair!.split("=");
      if (attrs.some((a) => a.trim().toLowerCase() === "max-age=0")) this.jar.delete(name!.trim());
      else this.jar.set(name!.trim(), v.join("="));
    }
    if (this.dropResponseFor === key) {
      this.dropResponseFor = null;
      throw new TypeError("connection reset");
    }
    return res;
  };

  use(): this {
    selectDatabase(this.name);
    setTransport({ baseUrl: "http://test", fetch: this.fetch }, this.name);
    return this;
  }

  async reset(): Promise<this> {
    await deleteDatabase(this.name);
    this.use();
    await db().open();
    return this;
  }

  async login(phone: string, password: string) {
    this.use();
    return login({ phone, password, deviceLabel: this.name });
  }

  /** Forget the in-memory access token (as after a restart). */
  dropAccessToken(): void {
    this.use();
    setAccessToken(null);
  }

  /** One full sync: push everything sendable, then pull. */
  async sync(): Promise<void> {
    this.use();
    await resetSending();
    for (let i = 0; i < 40; i++) {
      const r = await pushOnce();
      if (r.sent === 0 || !r.more) break;
    }
    await pullAll();
  }
}

/** Σdebit − Σcredit per account for one godown on the server. */
export async function serverBalances(godownId: string): Promise<Map<string, bigint>> {
  const db = await getDb();
  const lines = await cols(db).ledgerLines.find({ godownId }).toArray();
  const m = new Map<string, bigint>();
  for (const l of lines) {
    m.set(l.account, (m.get(l.account) ?? 0n) + BigInt(l.debitPaise) - BigInt(l.creditPaise));
  }
  for (const [k, v] of m) if (v === 0n) m.delete(k);
  return m;
}

export function nonZero(m: Map<string, bigint>): Map<string, bigint> {
  return new Map([...m].filter(([, v]) => v !== 0n));
}

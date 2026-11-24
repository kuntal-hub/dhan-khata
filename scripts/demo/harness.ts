/**
 * Demo-seed harness: simulated devices (each with its own fake IndexedDB) whose `fetch` calls the
 * real route handlers in-process. Data is therefore written exactly the way the app writes it:
 * repo functions → outbox → /api/sync/push → server recompute + verification → MongoDB.
 * (Adapted from tests/helpers/server.ts, which cannot be imported outside Vitest.)
 */
import "fake-indexeddb/auto";
import { deleteDatabase, db, selectDatabase } from "@/client/db/dexie";
import { login } from "@/client/auth/session";
import { pullAll } from "@/client/sync/pull";
import { pushOnce, resetSending } from "@/client/sync/push";
import { setTransport } from "@/client/sync/transport";
import * as adminRoutes from "@/server/routes/admin";
import * as authRoutes from "@/server/routes/auth";
import * as syncRoutes from "@/server/routes/sync";

type Handler = (r: Request) => Promise<Response>;
const ROUTES: Record<string, Handler> = {
  "POST /api/auth/login": authRoutes.login,
  "POST /api/auth/refresh": authRoutes.refresh,
  "POST /api/auth/logout": authRoutes.logout,
  "POST /api/sync/push": syncRoutes.push,
  "GET /api/sync/pull": syncRoutes.pull,
  "POST /api/diagnostics/errors": adminRoutes.clientErrors,
  "POST /api/me/prefs": adminRoutes.myPrefs,
};

export class DemoDevice {
  private jar = new Map<string, string>();

  constructor(public readonly name: string) {}

  private fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    if (url.pathname === "/api/health") return Response.json({ ok: true });
    const handler = ROUTES[`${method} ${url.pathname}`];
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
    return res;
  };

  /** Make this device's database and transport the active ones. */
  use(): this {
    selectDatabase(this.name);
    setTransport({ baseUrl: "http://demo", fetch: this.fetchImpl }, this.name);
    return this;
  }

  async reset(): Promise<this> {
    await deleteDatabase(this.name);
    this.use();
    await db().open();
    return this;
  }

  async login(phone: string, password: string, label: string) {
    this.use();
    return login({ phone, password, deviceLabel: label });
  }

  /** Push everything, then pull. Throws (with the server's reasons) if any op was refused. */
  async sync(): Promise<void> {
    this.use();
    await resetSending();
    for (let i = 0; i < 200; i++) {
      const r = await pushOnce();
      if (r.sent === 0 || !r.more) break;
    }
    const stuck = await db().outbox.toArray();
    if (stuck.length > 0) {
      const lines = stuck
        .slice(0, 8)
        .map((o) => `  ${o.entity} ${o.entityId} [${o.status}] ${o.lastError ?? ""}`);
      throw new Error(`${stuck.length} op(s) not accepted by the server on ${this.name}:\n${lines.join("\n")}`);
    }
    await pullAll();
  }
}

/**
 * Route-handler helpers: JSON responses, error codes (never sentences), structured logs.
 * Plain Web Request/Response only (host-portable, callable directly from tests).
 */
import { ZodError } from "zod";
import type { ApiErrorCode } from "@/domain/schemas";
import { installZodErrorMap } from "@/i18n/zodErrorMap";
import { ServerConfigError } from "./env";

installZodErrorMap();

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    public readonly detail?: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(NO_STORE)) headers.set(k, v);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorJson(status: number, code: ApiErrorCode, detail?: string): Response {
  return json(detail ? { error: code, detail } : { error: code }, { status });
}

export function log(entry: Record<string, unknown>): void {
  if (process.env.DK_QUIET_LOGS === "1" && entry.level !== "error") return;
  console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
}

/** Wrap a handler: maps ApiError/ZodError to codes, logs one structured line per request. */
export async function handle(
  route: string,
  request: Request,
  fn: () => Promise<Response>,
): Promise<Response> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fn();
  } catch (e) {
    if (e instanceof ApiError) res = errorJson(e.status, e.code, e.detail);
    else if (e instanceof ZodError)
      res = errorJson(400, "BAD_REQUEST", e.issues[0]?.path.join("."));
    else if (e instanceof SyntaxError) res = errorJson(400, "BAD_REQUEST");
    else {
      console.error(
        JSON.stringify({
          route,
          error: e instanceof Error ? e.message : String(e),
          config: e instanceof ServerConfigError,
        }),
      );
      res = errorJson(500, "SERVER_ERROR");
    }
  }
  log({ route, method: request.method, status: res.status, durationMs: Date.now() - started });
  return res;
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 2_000_000) throw new ApiError(413, "BAD_REQUEST", "too large");
  return JSON.parse(text) as unknown;
}

export function clientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get("x-nf-client-connection-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

export function getCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

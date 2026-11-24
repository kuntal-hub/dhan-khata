/**
 * HTTP transport for the active device database: base URL + fetch implementation + the
 * in-memory access token (never persisted). Tests register a fake fetch per simulated device.
 */
import type { ApiErrorCode } from "@/domain/schemas";
import { currentDbName } from "../db/dexie";

export interface Transport {
  baseUrl: string;
  fetch: typeof fetch;
}

interface TokenState {
  token: string | null;
  expiresAt: number;
}

const transports = new Map<string, Transport>();
const tokens = new Map<string, TokenState>();

export function setTransport(t: Transport, dbName: string = currentDbName()): void {
  transports.set(dbName, t);
}

export function transport(): Transport {
  return (
    transports.get(currentDbName()) ?? {
      baseUrl: "",
      fetch: (...args) => globalThis.fetch(...args),
    }
  );
}

export function setAccessToken(token: string | null, expiresAtIso?: string): void {
  tokens.set(currentDbName(), {
    token,
    expiresAt: expiresAtIso ? Date.parse(expiresAtIso) : 0,
  });
}

export function accessToken(): TokenState {
  return tokens.get(currentDbName()) ?? { token: null, expiresAt: 0 };
}

/** The request never reached the server or got no usable answer (offline, DNS, 5xx…). */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("NETWORK", { cause });
    this.name = "NetworkError";
  }
}

/** The server answered with an error code. */
export class ApiCallError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    /** Server detail (a code, never a sentence), e.g. "HAS_TRANSACTIONS". */
    public readonly detail?: string,
  ) {
    super(code);
    this.name = "ApiCallError";
  }
}

export interface CallOptions {
  method?: "GET" | "POST";
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
}

/** Raw call; maps transport failures to NetworkError and error bodies to ApiCallError. */
export async function apiCall<T>(path: string, opts: CallOptions = {}): Promise<T> {
  const t = transport();
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth) {
    const tok = accessToken().token;
    if (!tok) throw new ApiCallError(401, "UNAUTHORIZED");
    headers.Authorization = `Bearer ${tok}`;
  }
  let res: Response;
  try {
    res = await t.fetch(`${t.baseUrl}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    throw new NetworkError(e);
  }
  if (res.status >= 500 || res.status === 429) {
    if (res.status === 429) throw new ApiCallError(429, "RATE_LIMITED");
    throw new NetworkError(res.status);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    throw new NetworkError(e);
  }
  if (!res.ok) {
    const code = (data as { error?: ApiErrorCode }).error ?? "SERVER_ERROR";
    throw new ApiCallError(res.status, code, (data as { detail?: string }).detail);
  }
  return data as T;
}

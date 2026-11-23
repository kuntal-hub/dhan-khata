/** Server configuration from environment variables (spec §18.2). Read lazily, never at import. */

export interface ServerEnv {
  mongoUri: string;
  dbName: string;
  jwtSecret: Uint8Array;
  refreshSecret: string;
  cronSecret: string | undefined;
  accessTtlSec: number;
  refreshTtlDays: number;
  /** Only for local http testing: drop the `Secure` flag from the refresh cookie. */
  insecureCookie: boolean;
}

export class ServerConfigError extends Error {
  constructor(variable: string) {
    super(`Missing or invalid environment variable: ${variable}`);
    this.name = "ServerConfigError";
  }
}

function required(name: string, minLength = 1): string {
  const v = process.env[name];
  if (!v || v.length < minLength) throw new ServerConfigError(name);
  return v;
}

export function serverEnv(): ServerEnv {
  const ttl = parseInt(process.env.AUTH_ACCESS_TTL_SEC ?? "900", 10);
  return {
    mongoUri: required("MONGODB_URI"),
    dbName: process.env.MONGODB_DB || "dhankhata",
    jwtSecret: new TextEncoder().encode(required("AUTH_JWT_SECRET", 32)),
    refreshSecret: required("AUTH_REFRESH_SECRET", 32),
    cronSecret: process.env.CRON_SECRET,
    accessTtlSec: Number.isInteger(ttl) && ttl > 0 ? ttl : 900,
    refreshTtlDays: 90,
    insecureCookie: process.env.AUTH_COOKIE_INSECURE === "1",
  };
}

/**
 * E2E web server: in-memory MongoDB replica set + seed (owner, two godowns) + `next start`
 * on the production build (run `pnpm build` first). Used by playwright.config.ts.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { MongoMemoryReplSet } from "mongodb-memory-server";

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_OWNER = { phone: "9830012345", password: "e2e-owner-pass", name: "E2E Owner" };

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const env = {
    ...process.env,
    MONGODB_URI: replSet.getUri(),
    MONGODB_DB: "dhangola_e2e",
    AUTH_JWT_SECRET: "e2e-jwt-secret-0123456789-0123456789-abcdefgh",
    AUTH_REFRESH_SECRET: "e2e-refresh-secret-0123456789-0123456789-xyz",
    AUTH_COOKIE_INSECURE: "1",
    DK_QUIET_LOGS: "1",
    TZ: "Asia/Kolkata",
  };
  Object.assign(process.env, env);

  const { getDb, closeMongo } = await import("@/server/db");
  const { createBusinessWithOwner } = await import("@/server/business");
  const { createGodown } = await import("@/server/godownService");
  const db = await getDb();
  const { owner } = await createBusinessWithOwner(db, {
    ownerName: E2E_OWNER.name,
    mobile: E2E_OWNER.phone,
    password: E2E_OWNER.password,
    businessName: "ধান গোলা ট্রেডার্স",
  });
  await createGodown(db, owner, { name: "Rampur", code: "RP" });
  await createGodown(db, owner, { name: "Sonapur", code: "SP" });
  await closeMongo();

  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(E2E_PORT)], {
    env,
    stdio: "inherit",
  });
  const stop = async () => {
    child.kill();
    await replSet.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  child.on("exit", async (code) => {
    await replSet.stop();
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

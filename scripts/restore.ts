/**
 * Disaster recovery (spec §17.2): restore an in-app "full backup" JSON into an EMPTY database.
 *   pnpm restore --file=dhan-khata-backup-all-2026-11-24.json [--db=dhankhata]
 * Reads `.env` / `.env.local` (MONGODB_URI, MONGODB_DB). Refuses when the target already has
 * godowns. Ledger lines and stock moves are rebuilt by re-posting every voucher.
 * For the nightly `mongodump` archives use `mongorestore` instead (docs/RESTORE.md).
 */
import { existsSync, readFileSync } from "node:fs";
import { restoreBackup, type Backup } from "@/server/admin";
import { closeMongo, getMongoClient } from "@/server/db";
import { serverEnv } from "@/server/env";

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

async function main() {
  for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
  const a = args();
  if (!a.file) {
    console.error("Usage: pnpm restore --file=<backup.json> [--db=<database name>]");
    process.exit(2);
  }
  const backup = JSON.parse(readFileSync(a.file, "utf8")) as Backup;
  const client = await getMongoClient();
  const db = client.db(a.db ?? serverEnv().dbName);
  const counts = await restoreBackup(db, null, backup);
  console.log(JSON.stringify({ restoredInto: db.databaseName, counts }, null, 2));
  await closeMongo();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeMongo();
  process.exit(1);
});

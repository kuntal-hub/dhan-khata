/**
 * D54 data repair: due dates changed from the reminders tab before the fix were stored only in the
 * reminder, not on the deal (src/server/fixDueDates.ts). This copies them onto their deals.
 *
 *   pnpm fix:due-dates                 # dry run: report only, nothing written
 *   pnpm fix:due-dates --apply         # write (one transaction per Gola)
 *   options: --db=<database> --godown=<id>
 *
 * Reads `.env` / `.env.local` (MONGODB_URI, MONGODB_DB). Only due dates change, never money.
 * Idempotent: a second run finds nothing left to change.
 */
import { existsSync } from "node:fs";
import { closeMongo, cols, getMongoClient } from "@/server/db";
import { serverEnv } from "@/server/env";
import { fixDueDates } from "@/server/fixDueDates";

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]!] = m[2] ?? "true";
  }
  return out;
}

async function main() {
  for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
  const a = args();
  const client = await getMongoClient();
  const db = client.db(a.db ?? serverEnv().dbName);
  const owner = await cols(db).users.findOne({ isOwner: true });
  if (!owner) throw new Error("No owner user in this database");
  const report = await fixDueDates(db, {
    apply: a.apply === "true",
    actorId: owner._id,
    ...(a.godown ? { godownIds: [a.godown] } : {}),
  });
  console.log(`database: ${db.databaseName} · ${report.apply ? "APPLY" : "dry run"}`);
  for (const c of report.changes) {
    console.log(`  ${c.type} ${c.number}: ${c.from || "(none)"} → ${c.to}`);
  }
  for (const s of report.skipped) {
    console.log(`  skipped ${s.type || "?"} ${s.number || s.docId}: ${s.reason} (${s.to})`);
  }
  console.log(
    `${report.changes.length} due date(s) ${report.apply ? "copied onto their deals" : "to copy"}, ${report.skipped.length} skipped`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());

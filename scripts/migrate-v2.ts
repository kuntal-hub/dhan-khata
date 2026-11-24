/**
 * Data migration v1 (Dhan Khata) → v2 (Dhan Gola). See docs/MIGRATION_V2.md.
 *
 *   pnpm migrate:v2                    # DRY RUN against MONGODB_URI / MONGODB_DB: prints the plan
 *                                      # and the reconciliation report; writes nothing
 *   pnpm migrate:v2 --copy-to-memory   # rehearsal: copies the database into a throw-away
 *                                      # in-memory MongoDB, applies there, verifies; source untouched
 *   pnpm migrate:v2 --apply            # writes (only if the reconciliation is OK)
 *
 * Reads `.env` / `.env.local` if present. Idempotent: a second --apply stops at the marker.
 */
import { existsSync } from "node:fs";
import { MongoClient, type Db } from "mongodb";
import { closeMongo, getDb, mongoClientOptions } from "@/server/db";
import { applyMigration, planMigration, summarizePlan } from "@/server/migrateV2";
import { fromDbLine } from "@/server/convert";
import { deriveAll } from "@/domain/v2/replay";
import type { Doc } from "@/domain/schemas";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function verify(db: Db): Promise<boolean> {
  // After applying: stored lines must equal a fresh re-posting, and every Gola must balance.
  const docs = (await db.collection("vouchers").find({}).toArray()) as unknown as Doc[];
  const want = deriveAll(docs);
  const stored = (await db.collection("ledgerLines").find({}).toArray()).map((l) =>
    fromDbLine(l as never),
  );
  const a = new Set(stored.map((l) => `${l._id}|${l.debitPaise}|${l.creditPaise}`));
  const b = new Set(want.lines.map((l) => `${l._id}|${l.debitPaise}|${l.creditPaise}`));
  const same = a.size === b.size && [...a].every((x) => b.has(x));
  const byGodown = new Map<string, bigint>();
  for (const l of stored)
    byGodown.set(
      l.godownId,
      (byGodown.get(l.godownId) ?? 0n) + BigInt(l.debitPaise) - BigInt(l.creditPaise),
    );
  const balanced = [...byGodown.values()].every((v) => v === 0n);
  console.log(
    `verify: stored == re-posted: ${same ? "yes" : "NO"}; every Gola balanced: ${balanced ? "yes" : "NO"}`,
  );
  return same && balanced;
}

async function main() {
  for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
  if (flag("copy-to-memory")) {
    const { MongoMemoryReplSet } = await import("mongodb-memory-server");
    const source = new MongoClient(process.env.MONGODB_URI ?? "", mongoClientOptions());
    await source.connect();
    const src = source.db(process.env.MONGODB_DB);
    const repl = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    process.env.MONGODB_URI = repl.getUri();
    process.env.MONGODB_DB = "migration_rehearsal";
    const db = await getDb();
    for (const c of await src.listCollections().toArray()) {
      const docs = await src.collection(c.name).find({}).toArray();
      if (docs.length) await db.collection(c.name).insertMany(docs);
    }
    await source.close();
    console.log("Copied the database into an in-memory replica set (source untouched).");
    const plan = await planMigration(db);
    console.log(summarizePlan(plan));
    if (!plan.recon.ok) process.exitCode = 1;
    else {
      const r = await applyMigration(db, plan);
      console.log(`applied on the copy: ${r.changelog} changelog entries`);
      if (!(await verify(db))) process.exitCode = 1;
    }
    await closeMongo();
    await repl.stop();
    return;
  }
  const db = await getDb();
  const plan = await planMigration(db);
  console.log(summarizePlan(plan));
  if (!flag("apply")) {
    console.log("\nDry run: nothing written. Re-run with --apply to migrate.");
  } else if (plan.alreadyDone) {
    console.log("Nothing to do.");
  } else if (!plan.recon.ok) {
    console.error("Reconciliation failed: NOT applying.");
    process.exitCode = 1;
  } else {
    const r = await applyMigration(db, plan);
    console.log(`Applied: ${r.changelog} changelog entries written.`);
    if (!(await verify(db))) process.exitCode = 1;
  }
  await closeMongo();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeMongo().catch(() => {});
  process.exit(1);
});

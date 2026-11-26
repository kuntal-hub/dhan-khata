/**
 * v2.1 data repair: money direction with rice mills (docs/BUGFIX_MILL_DIRECTION.md).
 *
 *   pnpm fix:mill-direction                      # dry run: report only, nothing written
 *   pnpm fix:mill-direction --apply              # write (one transaction per Gola)
 *   options: --db=<database> --godown=<id> --decisions=<file.json>
 *
 * ALWAYS run it on a COPY of the database first (mongodump → mongorestore into another database,
 * then --db=<copy>). Reads `.env` / `.env.local` (MONGODB_URI, MONGODB_DB).
 *
 * Writes:
 *   docs/MILL_FIX_REVIEW.md          items that need the owner's decision
 *   docs/MILL_FIX_RECONCILIATION.md  before / after per Gola with every check
 *   docs/mill-fix-decisions.json     decisions template (only when it doesn't exist yet)
 * Idempotent: a second run finds nothing left to change.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { todayIST } from "@/domain/dates";
import { closeMongo, cols, getMongoClient } from "@/server/db";
import { serverEnv } from "@/server/env";
import {
  fixMillDirection,
  reconciliationMarkdown,
  reviewMarkdown,
  type FixDecisions,
} from "@/server/fixMillDirection";

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
  const decisionsFile = a.decisions ?? "docs/mill-fix-decisions.json";
  const decisions: FixDecisions = existsSync(decisionsFile)
    ? (JSON.parse(readFileSync(decisionsFile, "utf8")) as FixDecisions)
    : {};
  const client = await getMongoClient();
  const db = client.db(a.db ?? serverEnv().dbName);
  const owner = await cols(db).users.findOne({ isOwner: true });
  if (!owner) throw new Error("No owner user in this database");

  const report = await fixMillDirection(db, {
    apply: a.apply === "true",
    decisions,
    actorId: owner._id,
    today: todayIST(),
    ...(a.godown ? { godownIds: [a.godown] } : {}),
  });

  const mills = await cols(db).parties.find({ roles: "MILL" }).toArray();
  const names = new Map(mills.map((p) => [p._id as string, p.name as string]));
  writeFileSync("docs/MILL_FIX_REVIEW.md", reviewMarkdown(report, names));
  writeFileSync("docs/MILL_FIX_RECONCILIATION.md", reconciliationMarkdown(report, names));
  if (!existsSync(decisionsFile)) {
    // Empty strings = undecided; fill in "IN" / "REFUND", a rupee rate, or a credit / "DEFAULT".
    const template: Record<"payments" | "rates" | "credits", Record<string, string>> = {
      payments: {},
      rates: {},
      credits: {},
    };
    for (const g of report.golas) {
      for (const r of g.review) {
        if (r.kind === "PAYMENT_DIRECTION") template.payments[r.docId] = "";
        if (r.kind === "MILLING_RATE") template.rates[r.docId] = "";
        if (r.kind === "RETURN_CREDIT") template.credits[r.docId] = "";
      }
    }
    writeFileSync(decisionsFile, `${JSON.stringify(template, null, 2)}\n`);
  }

  console.log(`database: ${db.databaseName} · ${report.apply ? "APPLY" : "dry run"}`);
  for (const g of report.golas) {
    const fails = g.checks.filter((c) => c.startsWith("FAIL"));
    const open = g.review.filter((r) => r.blocking && !r.decided).length;
    console.log(
      `${g.name}: ${g.status} · ${g.changedDocs} documents · ${g.auto.length} automatic · ` +
        `${g.review.length} to review (${open} blocking, undecided) · ${fails.length} failed checks` +
        (g.problems.length ? ` · ${g.problems.length} problems` : ""),
    );
    for (const f of fails) console.log(`  ${f}`);
    for (const p of g.problems) console.log(`  ${p}`);
  }
  console.log("See docs/MILL_FIX_REVIEW.md and docs/MILL_FIX_RECONCILIATION.md");
  await closeMongo();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeMongo();
  process.exit(1);
});

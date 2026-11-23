/**
 * First-run seed (spec §18.3):
 *   pnpm seed --owner-phone=98300xxxxx --owner-name="Name" [--owner-password=…]
 *             [--godown-name=Rampur --godown-code=RP]
 * Creates the owner user (password printed once if generated) and, optionally, the first godown
 * with its chart of accounts, TRANSIT location, seeded varieties/categories and settings.
 * Reads `.env` / `.env.local` if present. Idempotent for an existing owner phone.
 */
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { normalizePhone } from "@/domain/phone";
import { closeMongo, cols, getDb } from "@/server/db";
import { createGodown } from "@/server/godownService";
import { createUser } from "@/server/users";

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
  const phone = normalizePhone(a["owner-phone"] ?? "");
  const name = a["owner-name"]?.trim();
  if (!phone || !name) {
    console.error(
      "Usage: pnpm seed --owner-phone=<10-digit mobile> --owner-name=<name> [--owner-password=…] [--godown-name=… --godown-code=…]",
    );
    process.exit(2);
  }
  const db = await getDb();
  let owner = await cols(db).users.findOne({ phone });
  if (owner) {
    console.log(`Owner already exists: ${owner.name} (${owner._id})`);
  } else {
    const password = a["owner-password"] ?? randomBytes(9).toString("base64url");
    owner = await createUser(db, { name, phone, password, isOwner: true });
    console.log(`Owner created: ${owner.name} (${owner._id})`);
    if (!a["owner-password"]) console.log(`Generated password (shown once): ${password}`);
  }
  if (a["godown-name"] && a["godown-code"]) {
    const g = await createGodown(db, owner, {
      name: a["godown-name"],
      code: a["godown-code"].toUpperCase(),
    });
    console.log(`Godown created: ${g.name} [${g.code}] (${g._id})`);
  }
  await closeMongo();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeMongo().catch(() => {});
  process.exit(1);
});

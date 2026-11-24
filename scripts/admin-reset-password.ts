/**
 * Developer fallback for a locked-out owner (requirement_v2 §2.2):
 *   pnpm admin:reset-password --mobile=98300xxxxx
 * Sets a random temporary password and a NEW recovery code (both printed once), and signs out
 * every session. The owner logs in with the temporary password and changes it in Profile.
 * Reads `.env` / `.env.local`.
 */
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { normalizePhone } from "@/domain/phone";
import { hashPassword } from "@/server/auth";
import { audit } from "@/server/changelog";
import { closeMongo, cols, getDb } from "@/server/db";
import { generateRecoveryCode, hashRecoveryCode } from "@/server/recovery";

async function main() {
  for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
  const arg = process.argv.slice(2).find((a) => a.startsWith("--mobile="));
  const mobile = normalizePhone(arg?.slice("--mobile=".length) ?? "");
  if (!mobile) {
    console.error("Usage: pnpm admin:reset-password --mobile=<10-digit mobile>");
    process.exit(2);
  }
  const db = await getDb();
  const user = await cols(db).users.findOne({ phone: mobile });
  if (!user) {
    console.error(`No user with mobile ${mobile}.`);
    await closeMongo();
    process.exit(1);
  }
  const temp = randomBytes(9).toString("base64url");
  const code = generateRecoveryCode();
  await cols(db).users.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await hashPassword(temp),
        recoveryCodeHash: await hashRecoveryCode(code),
        updatedAt: new Date().toISOString(),
      },
    },
  );
  await cols(db).refreshTokens.deleteMany({ userId: user._id });
  await cols(db).loginAttempts.deleteMany({
    key: { $in: [`phone:${mobile}`, `phone:recover:${mobile}`] },
  });
  await audit(db, undefined, {
    userId: user._id,
    deviceId: "cli",
    entity: "user",
    entityId: user._id,
    action: "password_reset",
    detail: "cli",
  });
  console.log(`Password reset for ${user.name} (${mobile}).`);
  console.log(`Temporary password (shown once): ${temp}`);
  console.log(`New recovery code (shown once):  ${code}`);
  console.log("Every session was signed out. Ask the owner to log in and change the password.");
  await closeMongo();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeMongo().catch(() => {});
  process.exit(1);
});

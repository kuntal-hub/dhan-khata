/**
 * Account recovery code (requirement_v2 §2.2): 12 random characters shown ONCE to the owner
 * (e.g. `DG-7KQ4-M2XP-9TRA`), stored only as an argon2id hash. Used with the mobile number to
 * set a new password; every use issues a new code. No SMS or paid service.
 */
import { randomInt } from "node:crypto";
import { hashPassword, verifyPassword } from "./auth";

/** No 0/O, 1/I/L: easy to copy by hand. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateRecoveryCode(): string {
  let raw = "";
  for (let i = 0; i < 12; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `DG-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Canonical form for hashing/verifying: uppercase, no spaces or dashes, no "DG" prefix. */
export function normalizeRecoveryCode(input: string): string {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return s.startsWith("DG") && s.length === 14 ? s.slice(2) : s;
}

export function hashRecoveryCode(code: string): Promise<string> {
  return hashPassword(normalizeRecoveryCode(code));
}

export function verifyRecoveryCode(hash: string | undefined, input: string): Promise<boolean> {
  if (!hash) return Promise.resolve(false);
  const n = normalizeRecoveryCode(input);
  if (n.length !== 12) return Promise.resolve(false);
  return verifyPassword(hash, n);
}

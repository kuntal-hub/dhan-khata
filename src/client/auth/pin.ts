/**
 * Offline PIN unlock (spec §12.8): 4–6 digits, PBKDF2-SHA256 with ≥ 200k iterations and a
 * per-device random salt (WebCrypto), stored in Dexie `meta`. The PIN itself is never stored.
 */
import { normalizeDigits } from "@/domain/digits";
import { META, getMeta, setMeta, type PinMeta } from "../db/meta";

export const PIN_ITERATIONS = 210_000;
export const PIN_RE = /^\d{4,6}$/;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function derive(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function normalizePin(pin: string): string {
  return normalizeDigits(pin).trim();
}

export async function hasPin(): Promise<boolean> {
  return (await getMeta<PinMeta>(META.pin)) !== undefined;
}

export async function setPin(pin: string): Promise<void> {
  const p = normalizePin(pin);
  if (!PIN_RE.test(p)) throw new Error("PIN_FORMAT");
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const hash = await derive(p, salt, PIN_ITERATIONS);
  const meta: PinMeta = {
    saltB64: toB64(salt),
    hashB64: toB64(hash),
    iterations: PIN_ITERATIONS,
    failedAttempts: 0,
  };
  await setMeta(META.pin, meta);
}

/** Verify a PIN. Counts failures (the UI slows down after several wrong attempts). */
export async function verifyPin(pin: string): Promise<boolean> {
  const meta = await getMeta<PinMeta>(META.pin);
  if (!meta) return false;
  const p = normalizePin(pin);
  if (!PIN_RE.test(p)) return false;
  const hash = await derive(p, fromB64(meta.saltB64), meta.iterations);
  const ok = timingSafeEqual(hash, fromB64(meta.hashB64));
  await setMeta(META.pin, { ...meta, failedAttempts: ok ? 0 : meta.failedAttempts + 1 });
  return ok;
}

export async function failedPinAttempts(): Promise<number> {
  return (await getMeta<PinMeta>(META.pin))?.failedAttempts ?? 0;
}

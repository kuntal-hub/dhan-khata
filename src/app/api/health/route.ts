import { connection } from "next/server";

/**
 * Cheap liveness probe (no database): the client treats a successful response as "online"
 * (spec §12.6) and compares `serverTime` with its own clock (skew warning, §12.9).
 */
export async function GET(): Promise<Response> {
  await connection();
  return new Response(JSON.stringify({ ok: true, serverTime: new Date().toISOString() }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

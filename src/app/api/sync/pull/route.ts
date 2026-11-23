import { connection } from "next/server";
import { pull } from "@/server/routes/sync";

/** Always request-time (never prerendered): the feed depends on the caller. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  return pull(request);
}

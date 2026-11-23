/** Owner-only, online party maintenance routes. */
import { z } from "zod";
import { authenticate } from "../auth";
import { getDb } from "../db";
import { handle, json, readJson } from "../http";
import { mergeParties } from "../partyMerge";

const MergeSchema = z.strictObject({
  godownId: z.string().min(1).max(64),
  keepId: z.string().min(1).max(64),
  dropId: z.string().min(1).max(64),
});

export function merge(request: Request): Promise<Response> {
  return handle("parties/merge", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const body = MergeSchema.parse(await readJson(request));
    const res = await mergeParties(db, auth.user, auth.device._id, body);
    return json(res);
  });
}

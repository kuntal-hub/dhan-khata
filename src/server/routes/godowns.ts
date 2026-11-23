/** Owner-only, online godown management routes (create / archive). */
import { z } from "zod";
import { CreateGodownRequestSchema } from "@/domain/schemas";
import { authenticate } from "../auth";
import { getDb } from "../db";
import { archiveGodown, createGodown } from "../godownService";
import { handle, json, readJson } from "../http";

export function create(request: Request): Promise<Response> {
  return handle("godowns/create", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const body = CreateGodownRequestSchema.parse(await readJson(request));
    const godown = await createGodown(db, auth.user, body, auth.device._id);
    return json({ godown }, { status: 201 });
  });
}

const ArchiveSchema = z.strictObject({ godownId: z.string().min(1).max(64) });

export function archive(request: Request): Promise<Response> {
  return handle("godowns/archive", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const { godownId } = ArchiveSchema.parse(await readJson(request));
    await archiveGodown(db, auth.user, godownId, auth.device._id);
    return json({ ok: true });
  });
}

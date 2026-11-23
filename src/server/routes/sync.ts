/** Sync route logic: push (apply ops) and pull (godown-filtered feed). */
import { MAX_PULL_LIMIT, PushRequestSchema, type PushOpResult } from "@/domain/schemas";
import { applyOp } from "../apply/applyOp";
import { authenticate } from "../auth";
import { getDb } from "../db";
import { ApiError, handle, json, log, readJson } from "../http";
import { pullChanges } from "../pull";

export function push(request: Request): Promise<Response> {
  return handle("sync/push", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const body = PushRequestSchema.parse(await readJson(request));
    if (body.deviceId !== auth.device._id) throw new ApiError(401, "DEVICE_MISMATCH");

    const results: PushOpResult[] = [];
    const failed = new Set<string>();
    for (const op of body.ops) {
      if (failed.has(op.entityId)) {
        results.push({ opId: op.opId, result: "rejected", reason: "DEPENDS_ON_FAILED" });
        continue;
      }
      const started = Date.now();
      const r = await applyOp({ db, user: auth.user, deviceId: auth.device._id }, op);
      log({
        route: "sync/push/op",
        opId: op.opId,
        deviceId: auth.device._id,
        entity: op.entity,
        result: r.result,
        reason: r.reason,
        durationMs: Date.now() - started,
      });
      if (r.result === "rejected" || r.result === "conflict") failed.add(op.entityId);
      results.push(r);
    }
    return json({ results, serverTime: new Date().toISOString() });
  });
}

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) throw new ApiError(400, "BAD_REQUEST", name);
  return n;
}

export function pull(request: Request): Promise<Response> {
  return handle("sync/pull", request, async () => {
    const db = await getDb();
    const auth = await authenticate(db, request);
    const url = new URL(request.url);
    const since = intParam(url, "since", 0);
    const limit = Math.min(Math.max(intParam(url, "limit", MAX_PULL_LIMIT), 1), MAX_PULL_LIMIT);
    const avRaw = url.searchParams.get("av");
    const godownId = url.searchParams.get("godownId") ?? undefined;
    const res = await pullChanges(db, auth.user, {
      since,
      limit,
      ...(godownId ? { godownId } : {}),
      ...(avRaw !== null ? { av: intParam(url, "av", 0) } : {}),
      count: url.searchParams.get("count") === "1",
    });
    return json(res);
  });
}

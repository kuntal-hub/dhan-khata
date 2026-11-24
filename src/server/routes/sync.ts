/** Sync route logic: push (apply ops) and pull (godown-filtered feed). */
import { MAX_PULL_LIMIT, PushRequestSchema, type PushOpResult } from "@/domain/schemas";
import { applyGroup } from "../apply/applyOp";
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
    // Consecutive ops sharing an opGroup are applied in ONE transaction (all or nothing).
    let i = 0;
    while (i < body.ops.length) {
      const first = body.ops[i]!;
      let j = i + 1;
      while (first.opGroup && j < body.ops.length && body.ops[j]!.opGroup === first.opGroup) j++;
      const group = body.ops.slice(i, j);
      i = j;
      if (group.some((op) => failed.has(op.entityId))) {
        for (const op of group) {
          results.push({ opId: op.opId, result: "rejected", reason: "DEPENDS_ON_FAILED" });
          failed.add(op.entityId);
        }
        continue;
      }
      const started = Date.now();
      const rs = await applyGroup({ db, user: auth.user, deviceId: auth.device._id }, group);
      group.forEach((op, k) => {
        const r = rs[k]!;
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
      });
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

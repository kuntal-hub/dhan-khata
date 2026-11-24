/**
 * Owner-only, online godown management (spec §1.4 rule 7, §9.11): create, edit profile, archive.
 * The server is the only writer of godown records; the device receives them through sync.
 */
import type { CreateGodownRequest, Godown, UpdateGodownRequest } from "@/domain/schemas";
import { authedCall } from "../auth/session";
import { db } from "../db/dexie";
import { getSyncEngine } from "../sync/instance";

async function syncAndWait(godownId: string, until: (g: Godown | undefined) => boolean) {
  await getSyncEngine().syncNow();
  for (let i = 0; i < 20 && !until(await db().godowns.get(godownId)); i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (i % 4 === 3) await getSyncEngine().syncNow();
  }
}

export async function createGodownOnline(input: CreateGodownRequest): Promise<Godown> {
  const { godown } = await authedCall<{ godown: Godown }>("/api/godowns", { body: input });
  await syncAndWait(godown._id, (g) => !!g);
  return godown;
}

export async function updateGodownOnline(input: UpdateGodownRequest): Promise<Godown> {
  const { godown } = await authedCall<{ godown: Godown }>("/api/godowns/update", { body: input });
  await syncAndWait(godown._id, (g) => (g?.rev ?? 0) >= godown.rev);
  return godown;
}

export async function archiveGodownOnline(godownId: string): Promise<void> {
  await authedCall<{ ok: true }>("/api/godowns/archive", { body: { godownId } });
  await syncAndWait(godownId, (g) => g?.status === "archived");
}

/** Owner-only, online: merge a duplicate party into another (server batch, spec §9.12). */
import { authedCall } from "../auth/session";

export async function mergePartiesOnline(
  godownId: string,
  keepId: string,
  dropId: string,
): Promise<{ vouchers: number }> {
  return authedCall<{ vouchers: number }>("/api/parties/merge", {
    body: { godownId, keepId, dropId },
  });
}

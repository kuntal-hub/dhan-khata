/** Map any client-side error to an i18n key (codes, never sentences). */
import { DomainError } from "@/domain/errors";
import type { TKey } from "@/i18n/translate";
import { ApiCallError, NetworkError } from "./sync/transport";

export function errorKey(e: unknown): TKey {
  if (e instanceof NetworkError) return "errors.api.NETWORK";
  if (e instanceof ApiCallError) return `errors.api.${e.code}` as TKey;
  if (e instanceof DomainError) return `errors.domain.${e.code}` as TKey;
  return "errors.generic";
}

/** i18n key for a push rejection / conflict reason (domain code or sync reason). */
export function reasonKey(reason: string | undefined): TKey {
  if (!reason) return "sync.reason.REJECTED";
  if (
    [
      "REV_CONFLICT",
      "VOIDED",
      "DEPENDS_ON_FAILED",
      "GODOWN_MISMATCH",
      "ID_MISMATCH",
      "UNKNOWN_ENTITY",
      "SERVER_ERROR",
    ].includes(reason)
  ) {
    return `sync.reason.${reason}` as TKey;
  }
  return `errors.domain.${reason}` as TKey;
}

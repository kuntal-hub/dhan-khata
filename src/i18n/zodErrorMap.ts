/**
 * Map Zod issues to i18n error KEYS (never English sentences reach the user; spec §11.4).
 * Schemas may set `{ error: "errors.validation.x" }` explicitly; that key is kept as-is.
 * The UI renders `t(issue.message)`.
 */
import { z } from "zod";
import type { TKey } from "./translate";

type Issue = Parameters<NonNullable<Parameters<typeof z.config>[0]>["customError"] & object>[0];

export function zodIssueToKey(issue: Issue): TKey {
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined ? "errors.validation.required" : "errors.validation.invalid";
    case "too_small":
      return issue.origin === "string"
        ? issue.minimum === 1
          ? "errors.validation.required"
          : "errors.validation.tooShort"
        : "errors.validation.tooSmall";
    case "too_big":
      return issue.origin === "string" ? "errors.validation.tooLong" : "errors.validation.tooBig";
    case "unrecognized_keys":
      return "errors.validation.unknownField";
    default:
      return "errors.validation.invalid";
  }
}

let installed = false;

/** Install once at app start (client) and in server routes. Idempotent. */
export function installZodErrorMap(): void {
  if (installed) return;
  installed = true;
  z.config({ customError: (issue) => zodIssueToKey(issue as Issue) });
}

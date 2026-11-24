/**
 * Domain error codes. Never sentences: the UI maps codes to `errors.*` i18n keys,
 * the server returns them verbatim (spec §11.4).
 */
export type DomainErrorCode =
  | "CROSS_GODOWN_REFERENCE"
  | "GODOWN_IMMUTABLE"
  | "CALC_MISMATCH"
  | "NET_NOT_POSITIVE"
  | "TOTAL_NEGATIVE"
  | "BANK_ACCOUNT_REQUIRED"
  | "PARTY_REQUIRED"
  | "TRANSPORTER_REQUIRED"
  | "HIRER_REQUIRED"
  | "RATE_REQUIRED"
  | "COMMISSION_REQUIRED"
  | "JOURNAL_UNBALANCED"
  | "JOURNAL_LINE_INVALID"
  | "NOTE_REQUIRED"
  | "NET_EXCEEDS_GROSS"
  | "INVALID_REFERENCE"
  // Write-path / authorization rules (Phase 2), shared by the local repo and the server.
  | "FORBIDDEN"
  | "DAY_LOCKED"
  | "GODOWN_ARCHIVED"
  | "GODOWN_NOT_FOUND"
  | "NOT_FOUND"
  | "VOUCHER_VOID"
  | "TYPE_IMMUTABLE"
  | "EDIT_WINDOW_EXPIRED"
  | "VALIDATION_FAILED"
  | "NOT_SIGNED_IN"
  | "LINKED_READ_ONLY"
  // Phase 4: day close and inter-godown transfers.
  | "DAY_ALREADY_CLOSED"
  | "DAY_NOT_CLOSED"
  | "TRANSFER_SAME_GODOWN"
  | "TRANSFER_NEEDS_BOTH"
  | "TRANSFER_NOT_PENDING"
  // v2 (requirement_v2).
  | "MILL_REQUIRED"
  | "FUTURE_DATE"
  | "OVERPAYMENT"
  | "SOURCE_MISMATCH"
  | "LINKED_PAYMENTS"
  | "ALREADY_LINKED"
  | "CATEGORY_IS_PAYMENT"
  | "DISPATCH_TYPE_MISMATCH"
  | "DUPLICATE_VARIETY";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    public readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "DomainError";
  }
}

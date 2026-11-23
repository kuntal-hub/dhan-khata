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
  | "INVALID_REFERENCE";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    public readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "DomainError";
  }
}

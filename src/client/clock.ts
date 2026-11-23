/** Device clock (overridable in tests). Business dates come from the user; this is for audit. */
let override: (() => Date) | null = null;

export function now(): Date {
  return override ? override() : new Date();
}

export function nowIso(): string {
  return now().toISOString();
}

export function setClockForTests(fn: (() => Date) | null): void {
  override = fn;
}

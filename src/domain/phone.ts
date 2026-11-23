import { normalizeDigits } from "./digits";

/**
 * Normalize an Indian mobile number to 10 digits ("+91 98300 12345" / "০৯৮৩০০১২৩৪৫" →
 * "9830012345"). Returns null when it isn't a valid mobile number.
 */
export function normalizePhone(input: string): string | null {
  let d = normalizeDigits(input).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

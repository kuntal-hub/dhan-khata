/** Bengali (০-৯) ↔ ASCII (0-9) digit conversion. Pure, language-neutral. */

const BN_ZERO = 0x09e6; // '০'

export type DigitStyle = "bn" | "en";

/** Convert every Bengali digit in `s` to ASCII. Other characters are untouched. */
export function normalizeDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= BN_ZERO && code <= BN_ZERO + 9) {
      out += String.fromCharCode(48 + (code - BN_ZERO));
    } else {
      out += ch;
    }
  }
  return out;
}

/** Convert every ASCII digit in `s` to a Bengali digit. */
export function toBnDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 48 && code <= 57) {
      out += String.fromCharCode(BN_ZERO + (code - 48));
    } else {
      out += ch;
    }
  }
  return out;
}

export function applyDigits(s: string, digits: DigitStyle): string {
  return digits === "bn" ? toBnDigits(s) : s;
}

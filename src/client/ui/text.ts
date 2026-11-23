/**
 * Tiny joiners for composed display text (keeps separators out of JSX, where the
 * no-literal-strings rule applies). Never used for translatable words.
 */
type Part = string | number | null | undefined | false;

/** "a · b · c" (empty parts dropped). */
export function dot(...parts: Part[]): string {
  return parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "").join(" · ");
}

/** "a b" (empty parts dropped). */
export function spaced(...parts: Part[]): string {
  return parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "").join(" ");
}

/** "(x)" */
export function paren(s: string): string {
  return `(${s})`;
}

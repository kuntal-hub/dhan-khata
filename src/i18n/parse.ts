/**
 * Input parsing that understands unit words in both languages (spec §11.3):
 *   "12 কু. 45.5 কেজি" / "12 qtl 45.5 kg" / "1245.5" (kg) / "১২কু ৪৫.৫"
 * Digits in either script. Never rounds: > 3 kg decimals is an error.
 */
import { parseScaled, type ParseResult } from "@/domain/decimal";
import { normalizeDigits } from "@/domain/digits";
import { GRAMS_PER_QUINTAL } from "@/domain/money";
import { grams, parseKg, type Grams } from "@/domain/weight";

const QTL_RE = /^\s*([\d,]+)\s*(?:কু\.?|কুইন্টাল|qtl\.?|q)\s*(.*)$/i;

export function parseWeightInput(input: string): ParseResult<Grams> {
  const s = normalizeDigits(input).trim();
  const m = QTL_RE.exec(s);
  if (!m) return parseKg(s);
  const q = parseScaled(m[1] ?? "", 0);
  if (!q.ok) return q;
  const rest = (m[2] ?? "").trim();
  let kgPart = 0n;
  if (rest !== "") {
    const k = parseKg(rest);
    if (!k.ok) return k;
    kgPart = k.value;
  }
  return { ok: true, value: grams(q.value * GRAMS_PER_QUINTAL + kgPart) };
}

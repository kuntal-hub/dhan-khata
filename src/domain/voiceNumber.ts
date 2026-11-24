/**
 * Spoken-number parser for voice input (requirement_v2 §14.1). Local, no AI, no network.
 * Turns a speech transcript into a plain decimal string ("2400", "52.5") that the normal field
 * parser then validates. Exact: values are scaled integers (× 1000), never floats.
 *
 * Bengali: এক…নিরানব্বই (with common spoken variants), শো/শ (hundred, also glued: "পাঁচশো"),
 * হাজার, লাখ/লক্ষ, কোটি, দশমিক/পয়েন্ট, সাড়ে (+½), দেড় (1½), আড়াই (2½), পৌনে (−¼).
 * English: zero…ninety-nine, hundred, thousand, lakh/lac, crore, million, point, "and", "a".
 * Digits (Bengali or ASCII) may be mixed in: "২৪ হাজার", "1.5 lakh".
 */
import { BN_0_99 } from "./amountInWords";
import { normalizeDigits } from "./digits";

export type SpokenNumberResult = { ok: true; value: string } | { ok: false };

const SCALE = 1000n; // three decimals

const nfc = (s: string) => s.normalize("NFC");

const BN_WORDS = new Map<string, bigint>();
BN_0_99.forEach((w, i) => BN_WORDS.set(nfc(w), BigInt(i) * SCALE));
const BN_VARIANTS: Array<[string, number]> = [
  ["দু", 2],
  ["দুটো", 2],
  ["দুটি", 2],
  ["একটা", 1],
  ["ছ", 6],
  ["ছয়", 6],
  ["ন", 9],
  ["নয়", 9],
  ["এগার", 11],
  ["বার", 12],
  ["তের", 13],
  ["চৌদ্দ", 14],
  ["পনের", 15],
  ["ষোল", 16],
  ["সতের", 17],
  ["আঠার", 18],
  ["বিশ", 20],
  ["ত্রিশ", 30],
  ["অষ্টাশি", 88],
  ["ঊনআশি", 79],
  ["উনাশি", 79],
  ["শুন্য", 0],
];
for (const [w, n] of BN_VARIANTS) BN_WORDS.set(nfc(w), BigInt(n) * SCALE);
BN_WORDS.set(nfc("দেড়"), 1500n);
BN_WORDS.set(nfc("আড়াই"), 2500n);

const EN_ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
const EN_WORDS = new Map<string, bigint>();
EN_ONES.forEach((w, i) => EN_WORDS.set(w, BigInt(i) * SCALE));
EN_TENS.forEach((w, i) => {
  if (w) EN_WORDS.set(w, BigInt(i * 10) * SCALE);
});
EN_WORDS.set("a", SCALE);
EN_WORDS.set("an", SCALE);

const MULTIPLIERS = new Map<string, bigint>([
  [nfc("শো"), 100n],
  [nfc("শ"), 100n],
  [nfc("শত"), 100n],
  [nfc("একশো"), 100n],
  [nfc("হাজার"), 1000n],
  [nfc("লাখ"), 100_000n],
  [nfc("লক্ষ"), 100_000n],
  [nfc("কোটি"), 10_000_000n],
  ["hundred", 100n],
  ["thousand", 1000n],
  ["lakh", 100_000n],
  ["lakhs", 100_000n],
  ["lac", 100_000n],
  ["lacs", 100_000n],
  ["million", 1_000_000n],
  ["crore", 10_000_000n],
  ["crores", 10_000_000n],
]);
/** Suffixes that may be glued to a number word: "পাঁচশো", "দুহাজার". */
const GLUED = [nfc("শো"), nfc("শত"), nfc("শ"), nfc("হাজার"), nfc("লাখ"), nfc("লক্ষ"), nfc("কোটি")];

const DECIMAL_WORDS = new Set([nfc("দশমিক"), nfc("পয়েন্ট"), nfc("পয়েন্ট"), "point", "dot"]);
const HALF_PLUS = nfc("সাড়ে");
const QUARTER_MINUS = nfc("পৌনে");
/** Spoken words that carry no number (units, currency, filler). */
const IGNORED = new Set(
  [
    "টাকা",
    "রুপি",
    "রুপিয়া",
    "কেজি",
    "কিলো",
    "কুইন্টাল",
    "মণ",
    "বস্তা",
    "গ্রাম",
    "মাত্র",
    "and",
    "rupees",
    "rupee",
    "rs",
    "kg",
    "kilo",
    "kilos",
    "quintal",
    "quintals",
    "only",
  ].map(nfc),
);

type Token =
  | { kind: "num"; v: bigint; small: boolean }
  | { kind: "mult"; m: bigint }
  | { kind: "decimal" }
  | { kind: "halfPlus" }
  | { kind: "quarterMinus" }
  | { kind: "digits"; raw: string };

function lookupWord(w: string): bigint | undefined {
  return BN_WORDS.get(w) ?? EN_WORDS.get(w);
}

function tokenize(text: string): Token[] | null {
  const cleaned = nfc(normalizeDigits(text))
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/[₹,।?!]/g, " ")
    .replace(/-/g, " ");
  const tokens: Token[] = [];
  for (const raw of cleaned.split(/\s+/).filter(Boolean)) {
    if (/^\d+(\.\d+)?$/.test(raw)) {
      tokens.push({ kind: "digits", raw });
      continue;
    }
    if (IGNORED.has(raw)) continue;
    if (DECIMAL_WORDS.has(raw)) {
      tokens.push({ kind: "decimal" });
      continue;
    }
    if (raw === HALF_PLUS) {
      tokens.push({ kind: "halfPlus" });
      continue;
    }
    if (raw === QUARTER_MINUS) {
      tokens.push({ kind: "quarterMinus" });
      continue;
    }
    const m = MULTIPLIERS.get(raw);
    if (m !== undefined) {
      if (raw === nfc("একশো")) tokens.push({ kind: "num", v: SCALE, small: true });
      tokens.push({ kind: "mult", m });
      continue;
    }
    const v = lookupWord(raw);
    if (v !== undefined) {
      tokens.push({ kind: "num", v, small: v < 10n * SCALE });
      continue;
    }
    // Glued multiplier: "পাঁচশো", "আড়াইশো", "দুহাজার".
    const suffix = GLUED.find((s) => raw.endsWith(s) && raw.length > s.length);
    if (suffix) {
      const head = raw.slice(0, -suffix.length);
      const hv = lookupWord(head);
      if (hv !== undefined) {
        tokens.push({ kind: "num", v: hv, small: hv < 10n * SCALE });
        tokens.push({ kind: "mult", m: MULTIPLIERS.get(suffix)! });
        continue;
      }
    }
    return null;
  }
  return tokens;
}

function digitsToScaled(raw: string): bigint | null {
  const [i = "0", f = ""] = raw.split(".");
  if (f.length > 3) return null;
  return BigInt(i) * SCALE + BigInt(f.padEnd(3, "0") || "0");
}

/** Parse a spoken number. Returns a plain ASCII decimal string with at most 3 decimals. */
export function parseSpokenNumber(text: string): SpokenNumberResult {
  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return { ok: false };

  let total = 0n;
  let current = 0n;
  let hasCurrent = false;
  let pendingHalf = false;
  let pendingQuarterMinus = false;
  let i = 0;

  const addNumber = (v: bigint): boolean => {
    let n = v;
    if (pendingHalf) {
      n += SCALE / 2n;
      pendingHalf = false;
    }
    if (pendingQuarterMinus) {
      n -= SCALE / 4n;
      pendingQuarterMinus = false;
    }
    if (!hasCurrent) {
      current = n;
      hasCurrent = true;
      return true;
    }
    // "twenty five" → 25; "দুশো পঞ্চাশ" → 250; "one hundred twenty" → 120.
    const units = current % (100n * SCALE);
    if (current < 100n * SCALE && current % (10n * SCALE) === 0n && n < 10n * SCALE) {
      current += n;
      return true;
    }
    if (current >= 100n * SCALE && units === 0n && n < 100n * SCALE) {
      current += n;
      return true;
    }
    return false;
  };

  for (; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === "decimal") break;
    switch (t.kind) {
      case "digits": {
        const v = digitsToScaled(t.raw);
        if (v === null || !addNumber(v)) return { ok: false };
        break;
      }
      case "num":
        if (!addNumber(t.v)) return { ok: false };
        break;
      case "halfPlus":
        pendingHalf = true;
        break;
      case "quarterMinus":
        pendingQuarterMinus = true;
        break;
      case "mult": {
        const base = hasCurrent ? current : SCALE;
        if (t.m === 100n) {
          current = base * 100n;
          hasCurrent = true;
        } else {
          // A big multiplier closes the group: "এক লাখ পঁচিশ হাজার".
          if (hasCurrent && current >= t.m * SCALE) return { ok: false };
          total += base * t.m;
          current = 0n;
          hasCurrent = false;
        }
        break;
      }
    }
  }
  if (pendingHalf || pendingQuarterMinus) return { ok: false };

  let value = total + (hasCurrent ? current : 0n);

  // Fraction after দশমিক / point: single digits ("দুই পাঁচ" → .25) or one number ("পঁচিশ" → .25).
  if (i < tokens.length) {
    if (value % SCALE !== 0n) return { ok: false };
    const rest = tokens.slice(i + 1);
    let frac = "";
    const allSingle = rest.every(
      (t) =>
        (t.kind === "num" && t.v % SCALE === 0n && t.v < 10n * SCALE) ||
        (t.kind === "digits" && /^\d$/.test(t.raw)),
    );
    if (rest.length === 0) return { ok: false };
    if (allSingle) {
      frac = rest
        .map((t) =>
          t.kind === "num" ? (t.v / SCALE).toString() : t.kind === "digits" ? t.raw : "",
        )
        .join("");
    } else if (rest.length === 1) {
      const t = rest[0]!;
      if (t.kind === "num" && t.v % SCALE === 0n) frac = (t.v / SCALE).toString();
      else if (t.kind === "digits" && /^\d+$/.test(t.raw)) frac = t.raw;
      else return { ok: false };
    } else return { ok: false };
    if (frac.length === 0 || frac.length > 3) return { ok: false };
    value += BigInt(frac.padEnd(3, "0"));
  }

  if (value < 0n) return { ok: false };
  const intPart = (value / SCALE).toString();
  const fracPart = (value % SCALE).toString().padStart(3, "0").replace(/0+$/, "");
  return { ok: true, value: fracPart ? `${intPart}.${fracPart}` : intPart };
}

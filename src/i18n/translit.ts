/**
 * Cross-script search (spec §11.4): a simple Bengali → Latin phonetic transliteration plus a
 * normalization that maps common spelling variants together, so "রহিম শেখ" and "rahim shekh"
 * (or "Rahim Sheikh") produce comparable keys. Not a linguistic transliterator — a search aid.
 */
import { normalizeDigits } from "@/domain/digits";

const CONSONANTS: Record<string, string> = {
  ক: "k",
  খ: "kh",
  গ: "g",
  ঘ: "gh",
  ঙ: "ng",
  চ: "ch",
  ছ: "chh",
  জ: "j",
  ঝ: "jh",
  ঞ: "n",
  ট: "t",
  ঠ: "th",
  ড: "d",
  ঢ: "dh",
  ণ: "n",
  ত: "t",
  থ: "th",
  দ: "d",
  ধ: "dh",
  ন: "n",
  প: "p",
  ফ: "ph",
  ব: "b",
  ভ: "bh",
  ম: "m",
  য: "j",
  র: "r",
  ল: "l",
  শ: "sh",
  ষ: "sh",
  স: "s",
  হ: "h",
};
/** Base consonant + nukta (U+09BC): ড় (r), ঢ় (rh), য় (y). Handled explicitly after NFD. */
const NUKTA_FORMS: Record<string, string> = { ড: "r", ঢ: "rh", য: "y" };
const INDEPENDENT_VOWELS: Record<string, string> = {
  অ: "o",
  আ: "a",
  ই: "i",
  ঈ: "i",
  উ: "u",
  ঊ: "u",
  ঋ: "ri",
  এ: "e",
  ঐ: "oi",
  ও: "o",
  ঔ: "ou",
};
const VOWEL_SIGNS: Record<string, string> = {
  "া": "a",
  "ি": "i",
  "ী": "i",
  "ু": "u",
  "ূ": "u",
  "ৃ": "ri",
  "ে": "e",
  "ৈ": "oi",
  "ো": "o",
  "ৌ": "ou",
};
const OTHERS: Record<string, string> = { ৎ: "t", "ং": "ng", "ঃ": "h", "ঁ": "" };
const HASANTA = "্";
const NUKTA = "়";

/** Bengali script → rough Latin. Inherent vowel "a" is added between consonants, dropped at word end. */
export function bengaliToLatin(input: string): string {
  // NFD splits precomposed ড়/ঢ়/য় into base + nukta, so there is exactly one form to handle.
  const chars = [...input.normalize("NFD")];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === NUKTA) continue;
    if (CONSONANTS[ch] !== undefined) {
      const hasNukta = chars[i + 1] === NUKTA;
      // য-ফলা (consonant + hasanta + য, e.g. শ্যা) sounds like "y", not "j".
      const yaPhala = ch === "য" && chars[i - 1] === HASANTA;
      out += hasNukta ? (NUKTA_FORMS[ch] ?? CONSONANTS[ch]) : yaPhala ? "y" : CONSONANTS[ch];
      if (hasNukta) i++;
      const nextCh = chars[i + 1];
      const nextIsSign =
        nextCh !== undefined && (VOWEL_SIGNS[nextCh] !== undefined || nextCh === HASANTA);
      const nextIsLetter =
        nextCh !== undefined &&
        (CONSONANTS[nextCh] !== undefined || OTHERS[nextCh] !== undefined) &&
        nextCh !== "ঁ";
      // Inherent vowel only when followed by another consonant within the word (word-final dropped).
      if (!nextIsSign && nextIsLetter) out += "a";
      continue;
    }
    if (VOWEL_SIGNS[ch] !== undefined) {
      // NFD splits ো into ে + া (U+09C7 U+09BE) and ৌ into ে + ৗ (U+09C7 U+09D7).
      if (ch === "ে" && chars[i + 1] === "া") {
        out += "o";
        i++;
      } else if (ch === "ে" && chars[i + 1] === "ৗ") {
        out += "ou";
        i++;
      } else {
        out += VOWEL_SIGNS[ch];
      }
      continue;
    }
    if (ch === HASANTA) continue;
    if (INDEPENDENT_VOWELS[ch] !== undefined) {
      out += INDEPENDENT_VOWELS[ch];
      continue;
    }
    if (OTHERS[ch] !== undefined) {
      out += OTHERS[ch];
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Normalize Latin text to a phonetic key: lowercase, aspirates collapsed (kh→k, bh→b),
 * sh/s→s, ph→f, v/w→b, z→j, ee→i, oo→u, y→i, o→a, doubled letters collapsed.
 */
export function phoneticKey(latin: string): string {
  let s = normalizeDigits(latin)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
  s = s
    .replace(/ph/g, "f")
    .replace(/chh/g, "c")
    .replace(/ch/g, "c")
    .replace(/sh/g, "s")
    .replace(/([kgcjtdpb])h/g, "$1")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/[vw]/g, "b")
    .replace(/z/g, "j")
    .replace(/y/g, "i")
    .replace(/o/g, "a")
    .replace(/ei/g, "e")
    .replace(/(.)\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  // Bengali's inherent vowel is often silent ("রামপুর" = Rampur, "সুব্রত" = Subrata/Subroto):
  // drop every non-initial "a" on BOTH sides so these spelling differences don't matter.
  return s
    .split(" ")
    .map((w) => (w.length > 1 ? w[0] + w.slice(1).replace(/a/g, "") : w))
    .join(" ")
    .replace(/(.)\1+/g, "$1");
}

const BENGALI_RE = /[ঀ-৿]/;

/** Key for any text in either script. */
export function searchKeyOf(text: string): string {
  const latin = BENGALI_RE.test(text) ? bengaliToLatin(text) : text;
  return phoneticKey(latin);
}

/** Stored `searchKey` for a party: name + alternate-script name (+ village), space-joined. */
export function buildSearchKey(...parts: Array<string | undefined>): string {
  return parts
    .filter((p): p is string => !!p && p.trim().length > 0)
    .map(searchKeyOf)
    .join(" ")
    .trim();
}

/** Does a stored key match the user's query (typed in either script)? */
export function matchesSearch(storedKey: string, query: string): boolean {
  const q = searchKeyOf(query);
  if (q === "") return true;
  return storedKey.includes(q);
}

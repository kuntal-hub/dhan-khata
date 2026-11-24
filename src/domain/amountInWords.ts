/**
 * Amount in words, Indian numbering system (lakh/crore, লক্ষ/কোটি), for receipts.
 * amountInWords(2606875n, 'en') → "Rupees Twenty-Six Thousand Sixty-Eight and Seventy-Five Paise Only"
 * amountInWords(2606875n, 'bn') → "ছাব্বিশ হাজার আটষট্টি টাকা পঁচাত্তর পয়সা মাত্র"
 */

export type Lang = "bn" | "en";

const EN_ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const EN_TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

// Bengali numbers 0–99 are irregular; full table (also used by the voice number parser).
export const BN_0_99 = [
  "শূন্য",
  "এক",
  "দুই",
  "তিন",
  "চার",
  "পাঁচ",
  "ছয়",
  "সাত",
  "আট",
  "নয়",
  "দশ",
  "এগারো",
  "বারো",
  "তেরো",
  "চোদ্দ",
  "পনেরো",
  "ষোলো",
  "সতেরো",
  "আঠারো",
  "উনিশ",
  "কুড়ি",
  "একুশ",
  "বাইশ",
  "তেইশ",
  "চব্বিশ",
  "পঁচিশ",
  "ছাব্বিশ",
  "সাতাশ",
  "আঠাশ",
  "উনত্রিশ",
  "তিরিশ",
  "একত্রিশ",
  "বত্রিশ",
  "তেত্রিশ",
  "চৌত্রিশ",
  "পঁয়ত্রিশ",
  "ছত্রিশ",
  "সাঁইত্রিশ",
  "আটত্রিশ",
  "উনচল্লিশ",
  "চল্লিশ",
  "একচল্লিশ",
  "বিয়াল্লিশ",
  "তেতাল্লিশ",
  "চুয়াল্লিশ",
  "পঁয়তাল্লিশ",
  "ছেচল্লিশ",
  "সাতচল্লিশ",
  "আটচল্লিশ",
  "উনপঞ্চাশ",
  "পঞ্চাশ",
  "একান্ন",
  "বাহান্ন",
  "তিপ্পান্ন",
  "চুয়ান্ন",
  "পঞ্চান্ন",
  "ছাপ্পান্ন",
  "সাতান্ন",
  "আটান্ন",
  "উনষাট",
  "ষাট",
  "একষট্টি",
  "বাষট্টি",
  "তেষট্টি",
  "চৌষট্টি",
  "পঁয়ষট্টি",
  "ছেষট্টি",
  "সাতষট্টি",
  "আটষট্টি",
  "উনসত্তর",
  "সত্তর",
  "একাত্তর",
  "বাহাত্তর",
  "তিয়াত্তর",
  "চুয়াত্তর",
  "পঁচাত্তর",
  "ছিয়াত্তর",
  "সাতাত্তর",
  "আটাত্তর",
  "উনআশি",
  "আশি",
  "একাশি",
  "বিরাশি",
  "তিরাশি",
  "চুরাশি",
  "পঁচাশি",
  "ছিয়াশি",
  "সাতাশি",
  "আটাশি",
  "উননব্বই",
  "নব্বই",
  "একানব্বই",
  "বিরানব্বই",
  "তিরানব্বই",
  "চুরানব্বই",
  "পঁচানব্বই",
  "ছিয়ানব্বই",
  "সাতানব্বই",
  "আটানব্বই",
  "নিরানব্বই",
];

function enBelow100(n: number): string {
  if (n < 20) return EN_ONES[n] ?? "";
  const t = EN_TENS[(n - (n % 10)) / 10] ?? "";
  const o = n % 10;
  return o === 0 ? t : `${t}-${EN_ONES[o] ?? ""}`;
}

function enBelow1000(n: number): string {
  const h = (n - (n % 100)) / 100;
  const r = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(`${EN_ONES[h] ?? ""} Hundred`);
  if (r > 0) parts.push(enBelow100(r));
  return parts.join(" ");
}

function bnBelow1000(n: number): string {
  const h = (n - (n % 100)) / 100;
  const r = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(`${BN_0_99[h] ?? ""} শত`);
  if (r > 0) parts.push(BN_0_99[r] ?? "");
  return parts.join(" ");
}

/** Words for a non-negative integer using crore / lakh / thousand / hundred. */
function integerWords(n: bigint, lang: Lang): string {
  if (n === 0n) return lang === "en" ? "Zero" : "শূন্য";
  const below1000 = lang === "en" ? enBelow1000 : bnBelow1000;
  const below100 = lang === "en" ? enBelow100 : (x: number) => BN_0_99[x] ?? "";
  const unit =
    lang === "en"
      ? { crore: "Crore", lakh: "Lakh", thousand: "Thousand" }
      : { crore: "কোটি", lakh: "লক্ষ", thousand: "হাজার" };

  const parts: string[] = [];
  const crore = n / 10_000_000n;
  let rest = n % 10_000_000n;
  if (crore > 0n) parts.push(`${integerWords(crore, lang)} ${unit.crore}`);
  const lakh = Number(rest / 100_000n); // float-ok: word-table index < 100
  rest %= 100_000n;
  if (lakh > 0) parts.push(`${below100(lakh)} ${unit.lakh}`);
  const thousand = Number(rest / 1000n); // float-ok: word-table index < 100
  rest %= 1000n;
  if (thousand > 0) parts.push(`${below100(thousand)} ${unit.thousand}`);
  const last = Number(rest); // float-ok: word-table index < 1000
  if (last > 0) parts.push(below1000(last));
  return parts.join(" ");
}

export function amountInWords(paiseValue: bigint, lang: Lang): string {
  const negative = paiseValue < 0n;
  const a = negative ? -paiseValue : paiseValue;
  const rupees = a / 100n;
  const p = Number(a % 100n); // float-ok: word-table index < 100

  if (lang === "en") {
    const minus = negative ? "Minus " : "";
    if (rupees === 0n && p > 0) return `${minus}${enBelow100(p)} Paise Only`;
    const r = `${minus}Rupees ${integerWords(rupees, "en")}`;
    return p > 0 ? `${r} and ${enBelow100(p)} Paise Only` : `${r} Only`;
  }
  const minus = negative ? "ঋণাত্মক " : "";
  if (rupees === 0n && p > 0) return `${minus}${BN_0_99[p] ?? ""} পয়সা মাত্র`;
  const r = `${minus}${integerWords(rupees, "bn")} টাকা`;
  return p > 0 ? `${r} ${BN_0_99[p] ?? ""} পয়সা মাত্র` : `${r} মাত্র`;
}

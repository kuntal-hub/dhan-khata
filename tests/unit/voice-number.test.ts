/**
 * Spoken-number parser (requirement_v2 §14.1).
 */
import { describe, expect, it } from "vitest";
import { parseSpokenNumber } from "@/domain/voiceNumber";

const ok = (value: string) => ({ ok: true, value });

describe("Bengali number words", () => {
  it.each([
    ["এক", "1"],
    ["নিরানব্বই", "99"],
    ["চব্বিশ", "24"],
    ["পঞ্চাশ", "50"],
    ["একশো", "100"],
    ["পাঁচশো", "500"],
    ["দুশো পঞ্চাশ", "250"],
    ["দুই হাজার চারশো", "2400"],
    ["দু হাজার চারশ", "2400"],
    ["চব্বিশ হাজার", "24000"],
    ["এক লাখ চৌত্রিশ হাজার চারশো", "134400"],
    ["এক লক্ষ চৌত্রিশ হাজার চারশো টাকা", "134400"],
    ["দেড় হাজার", "1500"],
    ["দেড়শো", "150"],
    ["আড়াই হাজার", "2500"],
    ["আড়াইশো", "250"],
    ["সাড়ে তিন", "3.5"],
    ["সাড়ে তিনশো", "350"],
    ["সাড়ে তিন হাজার", "3500"],
    ["পৌনে দুই", "1.75"],
    ["বাহান্ন দশমিক পাঁচ", "52.5"],
    ["আটচল্লিশ পয়েন্ট দুই পাঁচ", "48.25"],
    ["আটচল্লিশ পয়েন্ট পঁচিশ", "48.25"],
    ["২৪ হাজার", "24000"],
    ["৫৬ কুইন্টাল", "56"],
    ["কুড়ি", "20"],
    ["বিশ", "20"],
    ["তিরিশ", "30"],
    ["ত্রিশ", "30"],
    ["এক কোটি", "10000000"],
  ])("%s → %s", (input, expected) => {
    expect(parseSpokenNumber(input)).toEqual(ok(expected));
  });
});

describe("English words and digits", () => {
  it.each([
    ["two thousand four hundred", "2400"],
    ["twenty five", "25"],
    ["twenty-five thousand", "25000"],
    ["one hundred and five", "105"],
    ["a hundred", "100"],
    ["one lakh thirty four thousand four hundred", "134400"],
    ["1.5 lakh", "150000"],
    ["fifty two point five", "52.5"],
    ["2400", "2400"],
    ["২,৪০০", "2400"],
    ["52.25 kg", "52.25"],
    ["ten crore", "100000000"],
  ])("%s → %s", (input, expected) => {
    expect(parseSpokenNumber(input)).toEqual(ok(expected));
  });
});

describe("rejects what it can't understand", () => {
  it.each(["", "হ্যালো", "বাহান্ন পাঁচ", "সাড়ে", "point", "one two three", "52.1234"])(
    "%s",
    (input) => {
      expect(parseSpokenNumber(input)).toEqual({ ok: false });
    },
  );
});

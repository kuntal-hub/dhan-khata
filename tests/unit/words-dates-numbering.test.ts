import { describe, expect, it } from "vitest";
import { amountInWords } from "@/domain/amountInWords";
import { addDays, diffDays, fyOf, fyRange, isValidYmd, seasonOf, todayIST } from "@/domain/dates";
import {
  deviceCodeFromIndex,
  deviceIndexFromCode,
  formatVoucherNumber,
  parseVoucherNumber,
  voucherSeqKey,
} from "@/domain/numbering";

describe("amountInWords", () => {
  it("spec example in both languages", () => {
    expect(amountInWords(2_606_875n, "bn")).toBe("ছাব্বিশ হাজার আটষট্টি টাকা পঁচাত্তর পয়সা মাত্র");
    expect(amountInWords(2_606_875n, "en")).toBe(
      "Rupees Twenty-Six Thousand Sixty-Eight and Seventy-Five Paise Only",
    );
  });
  it.each([
    [0n, "Rupees Zero Only", "শূন্য টাকা মাত্র"],
    [100n, "Rupees One Only", "এক টাকা মাত্র"],
    [75n, "Seventy-Five Paise Only", "পঁচাত্তর পয়সা মাত্র"],
    [10_000_000n, "Rupees One Lakh Only", "এক লক্ষ টাকা মাত্র"],
    [
      12_345_678_00n,
      "Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only",
      "এক কোটি তেইশ লক্ষ পঁয়তাল্লিশ হাজার ছয় শত আটাত্তর টাকা মাত্র",
    ],
    [1_000_000_000_00n, "Rupees One Hundred Crore Only", "এক শত কোটি টাকা মাত্র"],
    [
      10_380_000n,
      "Rupees One Lakh Three Thousand Eight Hundred Only",
      "এক লক্ষ তিন হাজার আট শত টাকা মাত্র",
    ],
  ])("%s", (paise, en, bnText) => {
    expect(amountInWords(paise, "en")).toBe(en);
    expect(amountInWords(paise, "bn")).toBe(bnText);
  });
});

describe("dates (IST business day)", () => {
  it("todayIST uses Asia/Kolkata regardless of device timezone", () => {
    // 2026-11-22 20:00 UTC = 2026-11-23 01:30 IST
    expect(todayIST(new Date(Date.UTC(2026, 10, 22, 20, 0)))).toBe("2026-11-23");
    expect(todayIST(new Date(Date.UTC(2026, 10, 23, 18, 29)))).toBe("2026-11-23");
    expect(todayIST(new Date(Date.UTC(2026, 10, 23, 18, 30)))).toBe("2026-11-24");
  });
  it("financial year April–March", () => {
    expect(fyOf("2026-11-23")).toBe("2026-27");
    expect(fyOf("2027-03-31")).toBe("2026-27");
    expect(fyOf("2027-04-01")).toBe("2027-28");
    expect(fyOf("2099-12-31")).toBe("2099-00");
    expect(fyRange("2026-27")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
  });
  it("season from default map", () => {
    expect(seasonOf("2026-11-23")).toBe("AMAN");
    expect(seasonOf("2026-05-10")).toBe("BORO");
    expect(seasonOf("2026-09-01")).toBe("AUS");
    expect(seasonOf("2026-03-15")).toBeUndefined();
  });
  it("validation and day arithmetic", () => {
    expect(isValidYmd("2026-02-29")).toBe(false);
    expect(isValidYmd("2028-02-29")).toBe(true);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-11-01", "2026-12-01")).toBe(30);
  });
});

describe("voucher numbering", () => {
  it("format and parse", () => {
    const n = formatVoucherNumber("RP", "A", "PURCHASE", 123);
    expect(n).toBe("RP-A-PUR-000123");
    expect(parseVoucherNumber(n)).toEqual({
      godownCode: "RP",
      deviceCode: "A",
      typeCode: "PUR",
      seq: 123,
    });
  });
  it("rejects bad parts", () => {
    expect(() => formatVoucherNumber("rp", "A", "SALE", 1)).toThrow();
    expect(() => formatVoucherNumber("RP", "A", "SALE", 0)).toThrow();
  });
  it("device codes A…Z, AA, AB… round-trip", () => {
    expect(deviceCodeFromIndex(0)).toBe("A");
    expect(deviceCodeFromIndex(25)).toBe("Z");
    expect(deviceCodeFromIndex(26)).toBe("AA");
    expect(deviceCodeFromIndex(27)).toBe("AB");
    expect(deviceCodeFromIndex(701)).toBe("ZZ");
    expect(deviceCodeFromIndex(702)).toBe("AAA");
    for (let i = 0; i < 800; i++) expect(deviceIndexFromCode(deviceCodeFromIndex(i))).toBe(i);
  });
  it("sequence key is per godown and type", () => {
    expect(voucherSeqKey("g1", "SALE")).toBe("voucherSeq:g1:SALE");
  });
});

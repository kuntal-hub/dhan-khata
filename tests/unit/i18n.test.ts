import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bn } from "@/i18n/bn";
import { en } from "@/i18n/en";
import { formatDate, formatMoney, formatRate, formatWeight } from "@/i18n/format";
import { leafKeys, translate } from "@/i18n/translate";
import { bengaliToLatin, buildSearchKey, matchesSearch, searchKeyOf } from "@/i18n/translit";
import { installZodErrorMap } from "@/i18n/zodErrorMap";
import { PartySchema } from "@/domain/schemas/masters";

describe("dictionaries", () => {
  it("bn and en have identical key sets", () => {
    expect(leafKeys(en).sort()).toEqual(leafKeys(bn).sort());
  });

  it("no empty values in either language", () => {
    for (const dict of [bn, en]) {
      for (const key of leafKeys(dict)) {
        expect(translate(dict === bn ? "bn" : "en", key).trim().length, key).toBeGreaterThan(0);
        expect(translate(dict === bn ? "bn" : "en", key), key).not.toBe(key);
      }
    }
  });

  it("every string uses the same {placeholders} in Bengali and English", () => {
    const vars = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(",");
    // Calendar formats differ on purpose (day / month order, weekday).
    const mismatched = leafKeys(bn).filter(
      (k) => !k.startsWith("calendar.") && vars(translate("bn", k)) !== vars(translate("en", k)),
    );
    expect(mismatched).toEqual([]);
  });

  it("every domain error code and seeded code has a translation", () => {
    for (const lang of ["bn", "en"] as const) {
      expect(translate(lang, "errors.domain.CROSS_GODOWN_REFERENCE")).not.toContain("errors.");
      expect(translate(lang, "variety.GOBINDOBHOG")).not.toContain("variety.");
      expect(translate(lang, "pay.UPI")).not.toContain("pay.");
    }
  });

  it("interpolation and plurals", () => {
    expect(translate("en", "sync.pendingCount", { count: 1 })).toBe("1 pending");
    expect(translate("en", "units.bags", { count: 1 })).toBe("1 bag");
    expect(translate("en", "units.bags", { count: 5 })).toBe("5 bags");
    expect(translate("bn", "sync.pendingCount", { count: 5, countDisplay: "৫" })).toBe(
      "৫টি অপেক্ষায়",
    );
    expect(translate("bn", "gola.switcher", { name: "রামপুর" })).toBe("গোলা: রামপুর");
  });

  it("unknown keys return the key (never throw)", () => {
    expect(translate("en", "nope.missing")).toBe("nope.missing");
  });
});

describe("format", () => {
  it("money in both digit styles", () => {
    expect(formatMoney(12_345_600n, { digits: "bn" })).toBe("₹১,২৩,৪৫৬.০০");
    expect(formatMoney(12_345_600n, { digits: "en" })).toBe("₹1,23,456.00");
  });
  it("weight per language and mode", () => {
    expect(formatWeight(1_245_500n, { lang: "bn", digits: "en" })).toBe("12 কু. 45.500 কেজি");
    expect(formatWeight(1_245_500n, { lang: "en", digits: "en" })).toBe("12 qtl 45.500 kg");
    expect(formatWeight(1_212_500n, { lang: "bn", digits: "bn", weight: "kg" })).toBe(
      "১,২১২.৫০০ কেজি",
    );
  });
  it("rate", () => {
    expect(formatRate(215_000n, { lang: "en", digits: "en" })).toBe("₹2,150.00/qtl");
  });
  it("dates in bn and en", () => {
    expect(formatDate("2026-11-23", { lang: "bn", digits: "bn" })).toBe("২৩ নভেম্বর ২০২৬, সোমবার");
    expect(formatDate("2026-11-23", { lang: "en", digits: "en" })).toBe("Mon, 23 Nov 2026");
    expect(formatDate("2026-11-23", { lang: "bn", digits: "en" })).toBe("23 নভেম্বর 2026, সোমবার");
  });
  it("short dates, every month and weekday (no date library)", () => {
    expect(formatDate("2026-09-03", { lang: "bn", digits: "bn" }, "short")).toBe("৩ সেপ্ট ২০২৬");
    expect(formatDate("2026-09-03", { lang: "en", digits: "en" }, "short")).toBe("3 Sep 2026");
    expect(formatDate("2026-11-26", { lang: "bn", digits: "bn" })).toBe(
      "২৬ নভেম্বর ২০২৬, বৃহস্পতিবার",
    );
    expect(formatDate("2024-02-29", { lang: "en", digits: "en" })).toBe("Thu, 29 Feb 2024");
    expect(formatDate("2027-01-31", { lang: "en", digits: "en" })).toBe("Sun, 31 Jan 2027");
    const months = Array.from({ length: 12 }, (_, i) =>
      formatDate(
        `2026-${String(i + 1).padStart(2, "0")}-01`,
        { lang: "en", digits: "en" },
        "short",
      ),
    );
    expect(months.join("|")).toBe(
      "1 Jan 2026|1 Feb 2026|1 Mar 2026|1 Apr 2026|1 May 2026|1 Jun 2026|1 Jul 2026|1 Aug 2026|1 Sep 2026|1 Oct 2026|1 Nov 2026|1 Dec 2026",
    );
  });
});

describe("transliteration search", () => {
  it.each([
    ["রহিম শেখ", "rahim shekh"],
    ["রহিম শেখ", "Rahim Sheikh"],
    ["গোবিন্দভোগ", "Gobindobhog"],
    ["শ্যামল ঘোষ", "shyamal ghosh"],
    ["বাপি মণ্ডল", "bapi mondal"],
    ["সুব্রত পাল", "subrata pal"],
  ])("%s ≈ %s", (bnName, latin) => {
    expect(searchKeyOf(bnName)).toBe(searchKeyOf(latin));
  });

  it("nukta letters and split vowel signs survive Unicode normalization", () => {
    expect(bengaliToLatin("বড়ো".normalize("NFC"))).toBe(bengaliToLatin("বড়ো".normalize("NFD")));
    expect(bengaliToLatin("গোপাল")).toBe("gopal");
  });

  it("matches partial queries across scripts and digits", () => {
    const key = buildSearchKey("রহিম শেখ", "Rahim Sheikh", "Rampur");
    expect(matchesSearch(key, "rahim")).toBe(true);
    expect(matchesSearch(key, "শেখ")).toBe(true);
    expect(matchesSearch(key, "রামপুর")).toBe(true);
    expect(matchesSearch(key, "karim")).toBe(false);
  });
});

describe("zod error map → i18n keys", () => {
  it("issues become translatable keys, never English sentences", () => {
    installZodErrorMap();
    const r = PartySchema.safeParse({ name: "" });
    expect(r.success).toBe(false);
    for (const issue of r.error!.issues) {
      expect(issue.message.startsWith("errors.")).toBe(true);
      expect(translate("bn", issue.message)).not.toBe(issue.message);
    }
    const phone = z.object({ p: PartySchema.shape.phone }).safeParse({ p: "12345" });
    expect(phone.error?.issues[0]?.message).toBe("errors.validation.phone");
  });
});

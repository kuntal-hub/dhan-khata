/**
 * requirement_v2 §11: exactly eight main sections, four on the mobile bottom bar, every label
 * translated in both languages, and quick actions only for real screens.
 */
import { describe, expect, it } from "vitest";
import { QUICK_ACTIONS } from "@/components/shell/QuickAdd";
import { SECTIONS, sectionOf } from "@/components/shell/sections";
import { translate } from "@/i18n/translateAll";

describe("navigation", () => {
  it("has exactly eight sections with unique keys and routes; four primary", () => {
    expect(SECTIONS).toHaveLength(8);
    expect(new Set(SECTIONS.map((s) => s.key)).size).toBe(8);
    expect(new Set(SECTIONS.map((s) => s.href)).size).toBe(8);
    expect(SECTIONS.filter((s) => s.primary).map((s) => s.key)).toEqual([
      "dashboard",
      "purchase",
      "sales",
      "dues",
    ]);
  });

  it("every section and tab label exists in Bengali and English", () => {
    for (const s of SECTIONS) {
      for (const key of [s.label, s.short, ...s.tabs.map((t) => t.label)]) {
        const bn = translate("bn", key);
        const en = translate("en", key);
        expect(bn, key).not.toBe(key);
        expect(en, key).not.toBe(key);
        expect(bn, key).not.toBe(en);
      }
    }
  });

  it("maps paths to their section; header pages belong to none", () => {
    expect(sectionOf("/")?.key).toBe("dashboard");
    expect(sectionOf("/purchase/new")?.key).toBe("purchase");
    expect(sectionOf("/mill")?.key).toBe("mill");
    for (const p of ["/profile", "/business", "/golas", "/sessions", "/sync"])
      expect(sectionOf(p)).toBeUndefined();
  });

  it("offers the eight quick actions of §11", () => {
    expect(QUICK_ACTIONS.map((a) => a.key)).toEqual([
      "purchase",
      "sale",
      "expense",
      "paid",
      "received",
      "load",
      "dispatch",
      "trip",
    ]);
  });
});

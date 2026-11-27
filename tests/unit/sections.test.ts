/**
 * requirement_v2 §11: exactly eight main sections, four on the mobile bottom bar, every label
 * translated in both languages, and quick actions only for real screens.
 */
import { describe, expect, it } from "vitest";
import { QUICK_ACTIONS } from "@/components/shell/QuickAdd";
import {
  SECTIONS,
  actionsOf,
  sectionByKey,
  sectionOf,
  tabsOf,
  type Section,
} from "@/components/shell/sections";
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

  it("every section, tab and add-button label exists in Bengali and English", () => {
    for (const s of SECTIONS) {
      for (const key of [
        s.label,
        s.short,
        ...s.tabs.map((t) => t.label),
        ...s.actions.map((a) => a.label),
      ]) {
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

  it("every section but the dashboard has its own add-button on every tab with a form", () => {
    const keysOn = (key: Section["key"], tab: string, rice = true) =>
      actionsOf(sectionByKey(key), tab, rice).map((a) => a.key);
    for (const s of SECTIONS.filter((x) => x.key !== "dashboard")) {
      expect(keysOn(s.key, s.tabs[0]!.key).length, s.key).toBeGreaterThan(0);
      // Each button opens a real form route (static, ids via search params).
      for (const a of s.actions)
        expect(a.href, a.key).toMatch(
          /^\/[a-z/]+\/new(\?[a-z]+=[A-Z]+)?$|^\/dues\/pay\?direction=(IN|OUT)$/,
        );
    }
    expect(keysOn("dashboard", "overview")).toEqual([]);
    expect(keysOn("purchase", "varieties")).toEqual(["new"]);
    // Dues: collect where money comes in, pay where it goes out, both on the summary.
    expect(keysOn("dues", "summary")).toEqual(["received", "paid"]);
    expect(keysOn("dues", "receivable")).toEqual(["received"]);
    expect(keysOn("dues", "payable")).toEqual(["paid"]);
    expect(keysOn("dues", "mill")).toEqual(["received"]); // mills pay the broker (D53)
    expect(keysOn("dues", "reminders")).toEqual([]);
    // Mill: one form per tab.
    expect(keysOn("mill", "secondParty")).toEqual(["entry"]);
    expect(keysOn("mill", "dispatch")).toEqual(["dispatch"]);
    expect(keysOn("mill", "return")).toEqual(["return"]);
    expect(keysOn("mill", "conversion")).toEqual(["conversion"]);
    // Test ids stay unique within a section (one page shows them together).
    for (const s of SECTIONS) {
      for (const tab of s.tabs) {
        const ids = actionsOf(s, tab.key, true).map((a) => a.testId);
        expect(new Set(ids).size, `${s.key}/${tab.key}`).toBe(ids.length);
      }
    }
  });

  it("rice hidden: no conversion tab or form, everything else unchanged", () => {
    const mill = sectionByKey("mill");
    expect(tabsOf(mill, true).map((t) => t.key)).toContain("conversion");
    expect(tabsOf(mill, false).map((t) => t.key)).not.toContain("conversion");
    expect(actionsOf(mill, "conversion", false)).toEqual([]);
    for (const s of SECTIONS.filter((x) => x.key !== "mill")) {
      expect(tabsOf(s, false)).toEqual(s.tabs);
      for (const tab of s.tabs)
        expect(actionsOf(s, tab.key, false)).toEqual(actionsOf(s, tab.key, true));
    }
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

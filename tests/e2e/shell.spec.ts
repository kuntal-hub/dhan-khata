/**
 * v2 shell (requirement_v2 §11, §15): exactly eight sections at 360 / 768 / 1280 px, mobile bottom
 * bar (4 + "সব বিভাগ" sheet of 8), desktop sidebar of 8, Gola switcher, bn and en, reduced motion.
 * Screenshots for the visual review are written to test-results/v2-shell/.
 */
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, loginFresh, openBrowser, switchToEnglish } from "./helpers";

const SECTIONS = [
  "dashboard",
  "purchase",
  "sales",
  "expenses",
  "loads",
  "dues",
  "vehicles",
  "mill",
];
const SHOTS = "test-results/v2-shell";

test("eight sections, bn and en, at phone / tablet / desktop widths", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);

  // Phone: bottom bar with the 4 primary sections + "all sections".
  await expect(page.getByTestId("section-dashboard")).toBeVisible();
  for (const k of ["dashboard", "purchase", "sales", "dues"])
    await expect(page.getByTestId(`tab-${k}`)).toBeVisible();
  await expect(page.locator('[data-testid^="tab-"]:visible')).toHaveCount(5);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/bn-360-dashboard.png`, fullPage: true });

  await page.getByTestId("tab-all").click();
  await expect(page.getByTestId("all-sections")).toBeVisible();
  await expect(page.getByTestId("all-sections").locator('a[data-testid^="all-"]')).toHaveCount(8);
  await page.screenshot({ path: `${SHOTS}/bn-360-all-sections.png` });
  for (const k of SECTIONS) {
    if (!(await page.getByTestId("all-sections").isVisible()))
      await page.getByTestId("tab-all").click();
    await page.getByTestId(`all-${k}`).click();
    await expect(page.getByTestId(`section-${k}`)).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
  await page.getByTestId("tab-purchase").click();
  await page.screenshot({ path: `${SHOTS}/bn-360-purchase.png`, fullPage: true });

  // Gola switcher menu.
  await page.getByTestId("tab-dashboard").click();
  await page.getByTestId("godown-switcher").click();
  await expect(page.getByTestId("godown-item-RP")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/bn-360-gola-menu.png` });
  await page.getByTestId("godown-item-SP").click();
  await expect(page.getByTestId("godown-switcher")).toContainText("Sonapur");

  // Tablet: still the bottom bar.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByTestId("bottom-bar")).toBeVisible();
  await expect(page.getByTestId("sidebar")).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/bn-768-dashboard.png`, fullPage: true });

  // Desktop: the sidebar lists exactly 8 sections.
  await page.setViewportSize({ width: 1280, height: 860 });
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("bottom-bar")).toBeHidden();
  await expect(page.locator('[data-testid^="nav-"]')).toHaveCount(8);
  await page.screenshot({ path: `${SHOTS}/bn-1280-dashboard.png`, fullPage: true });

  // English.
  await page.setViewportSize({ width: 360, height: 740 });
  await switchToEnglish(page);
  await expect(page.getByTestId("tab-dashboard")).toContainText("Dashboard");
  await page.screenshot({ path: `${SHOTS}/en-360-dashboard.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.getByTestId("nav-mill").click();
  await expect(page.getByTestId("section-mill")).toContainText("Mill & Second Party");
  await page.screenshot({ path: `${SHOTS}/en-1280-mill.png`, fullPage: true });
  await ctx.close();
});

test("reduced motion: everything is shown at once", async () => {
  const { ctx, page } = await openBrowser();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await expect(page.getByTestId("overview-cards")).toBeVisible();
  await expect(page.getByTestId("m-cash")).toHaveAttribute("data-value", "0");
  await ctx.close();
});

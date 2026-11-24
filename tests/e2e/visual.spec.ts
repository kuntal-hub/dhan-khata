/**
 * Visual snapshots at 360 px in BOTH languages (spec §11.4 / Phase 5 §G): Home, reports,
 * settings and the purchase form, on an empty godown (stable numbers). Dates and live sync state
 * are masked. Baselines are written on the first run per platform (`updateSnapshots: "missing"`).
 */
import { expect, test, type Page } from "@playwright/test";
import { createGodownViaWizard, loginFresh, openBrowser, switchToEnglish, vis } from "./helpers";

async function shoot(page: Page, name: string) {
  // Transient toasts ("গোডাউন তৈরি হয়েছে") would cover the header: wait until they are gone.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
    mask: [
      page.locator('[data-testid="sync-badge"]'),
      page.locator('[data-testid$="-label"]'),
      page.locator('input[type="date"]'),
      page.locator("p.text-muted-foreground.text-xs"),
      page.locator('[data-testid="banner-reminders"]'),
    ],
  });
}

test("main screens at 360 px in bn and en", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 780 });
  await loginFresh(page);
  await createGodownViaWizard(page, { name: "Visual", code: "VIS" });
  for (const lang of ["bn", "en"] as const) {
    if (lang === "en") await switchToEnglish(page);
    await vis(page, "tab-home").click();
    await expect(vis(page, "dashboard")).toBeVisible();
    await shoot(page, `${lang}-home`);
    await vis(page, "tab-more").click();
    await vis(page, "more-reports").click();
    await expect(page.getByTestId("report-dayBook")).toBeVisible();
    await shoot(page, `${lang}-reports`);
    await page.goto("/settings");
    await expect(vis(page, "about")).toBeVisible();
    await shoot(page, `${lang}-settings`);
    await vis(page, "tab-home").click();
    await vis(page, "qa-purchase").click();
    await expect(vis(page, "purchase-form")).toBeVisible();
    await shoot(page, `${lang}-purchase-form`);
    await page.goto("/");
  }
  await ctx.close();
});

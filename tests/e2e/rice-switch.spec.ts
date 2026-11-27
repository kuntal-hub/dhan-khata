/**
 * D55: the business-profile switch "show rice and other products" (default on). Off hides every
 * rice / other-product choice, tab, button and report; on brings them back. Display only.
 * Restores the switch at the end (the e2e server is shared by the spec files, one at a time).
 */
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, loginFresh, openBrowser, unlockIfAsked, vis } from "./helpers";

async function open(page: Page, path: string, ready: string) {
  await page.goto(path);
  await unlockIfAsked(page);
  await expect(vis(page, ready)).toBeVisible();
}

async function setRice(page: Page, on: boolean) {
  await open(page, "/business", "biz-rice");
  const sw = vis(page, "biz-rice");
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(on));
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/business") && r.ok());
  await vis(page, "biz-save").click();
  await saved;
  await expect(vis(page, "biz-save")).toBeEnabled();
}

test("rice switch: on by default, off hides rice and other products, on restores them", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  try {
    // Default: shown.
    await open(page, "/business", "biz-rice");
    await expect(vis(page, "biz-rice")).toHaveAttribute("aria-checked", "true");
    await open(page, "/sales/new", "sale-form");
    await expect(vis(page, "sale-product-RICE")).toBeVisible();
    await open(page, "/mill", "section-mill");
    await expect(vis(page, "stab-conversion")).toBeVisible();

    await setRice(page, false);
    await open(page, "/sales/new", "sale-form");
    await expect(page.getByTestId("sale-product-RICE")).toHaveCount(0);
    await open(page, "/mill/return/new", "return-form");
    await expect(page.getByTestId("return-product-RICE")).toHaveCount(0);
    await open(page, "/?tab=stock", "stock-tab");
    await expect(page.getByTestId("stock-product-RICE")).toHaveCount(0);
    // The conversion tab (and its add button) is gone; asking for it lands on the first tab.
    await open(page, "/mill?tab=conversion", "section-mill");
    await expect(page.getByTestId("stab-conversion")).toHaveCount(0);
    await expect(vis(page, "stab-secondParty")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("conversion-new")).toHaveCount(0);
    await expect(vis(page, "sp-new")).toBeVisible();
    await expectNoHorizontalScroll(page);
    // Rice-only reports are not offered.
    await open(page, "/?tab=reports", "reports-dashboard");
    await expect(page.getByRole("tab", { name: "চাল ও অন্যান্য স্টক" })).toHaveCount(0);
  } finally {
    await setRice(page, true);
  }
  await open(page, "/sales/new", "sale-form");
  await expect(vis(page, "sale-product-RICE")).toBeVisible();
  await ctx.close();
});

/**
 * G5 dashboard e2e (Phase 4 §J), in BOTH languages, each in a godown created through the
 * add-godown wizard: opening cash ₹50,000 (yesterday) → farmer payment ₹20,000 → labour ₹1,200
 * → mill cash via the driver ₹75,000 → expected closing ₹1,03,800.00 → day close with a counted
 * ₹300 shortage → CASH_DIFF posted (expected cash becomes the counted ₹1,03,500).
 */
import { expect, test, type Page } from "@playwright/test";
import {
  createGodownViaWizard,
  createParty,
  expectNoHorizontalScroll,
  istDate,
  loginFresh,
  openBrowser,
  pick,
  switchToEnglish,
  vis,
} from "./helpers";

const RUNS = [
  { lang: "bn", name: "G5 বাংলা", code: "GFB", labour: "লেবার" },
  { lang: "en", name: "G5 English", code: "GFE", labour: "Labour" },
] as const;

async function goHome(page: Page) {
  await vis(page, "tab-home").click();
  await expect(vis(page, "dashboard")).toBeVisible();
}

for (const run of RUNS) {
  test(`G5 dashboard + day close in ${run.lang}`, async () => {
    const { ctx, page } = await openBrowser();
    await loginFresh(page);
    if (run.lang === "en") await switchToEnglish(page);

    await createGodownViaWizard(page, {
      name: run.name,
      code: run.code,
      cash: "50000",
      goLive: istDate(-1),
    });
    await expect(vis(page, "dash-opening-cash-value")).toHaveAttribute("data-paise", "5000000");
    await expectNoHorizontalScroll(page);

    const farmer = `${run.lang} G5 Farmer`;
    const mill = `${run.lang} G5 Mill`;
    await createParty(page, farmer);
    await createParty(page, mill, "mill");

    // Farmer payment ₹20,000 cash.
    await goHome(page);
    await vis(page, "qa-payment").click();
    await pick(page, "money-party", farmer);
    await vis(page, "money-amount").fill("20000");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/payment\/view\?id=/);

    // Labour ₹1,200 cash.
    await goHome(page);
    await vis(page, "qa-expense").click();
    await pick(page, "expense-category", run.labour);
    await vis(page, "expense-amount").fill("1200");
    await vis(page, "expense-description").fill("loading labour");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/voucher\/view\?id=/);

    // Mill sends ₹75,000 cash with the truck driver.
    await goHome(page);
    await vis(page, "qa-receipt").click();
    await pick(page, "money-party", mill);
    await vis(page, "money-amount").fill("75000");
    await vis(page, "money-via").fill("WB12AB3456");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/payment\/view\?id=/);

    // Expected closing ₹1,03,800.00.
    await goHome(page);
    await expect(vis(page, "home-cash")).toHaveAttribute("data-paise", "10380000");
    await expect(vis(page, "home-cash")).toContainText(run.lang === "bn" ? "১,০৩,৮০০" : "1,03,800");
    await expect(vis(page, "dash-expense-value")).toHaveAttribute("data-paise", "120000");
    await expectNoHorizontalScroll(page);

    // Daily expense screen shows the farmer payment block and the labour block.
    await vis(page, "tab-more").click();
    await vis(page, "more-expense").click();
    await expect(vis(page, "expense-farmer-total")).toHaveAttribute("data-paise", "2000000");
    await expect(vis(page, "expense-subtotal-LABOUR")).toHaveAttribute("data-paise", "120000");
    await expect(vis(page, "expense-grand-total")).toHaveAttribute("data-paise", "2120000");

    // Day close: counted ₹1,03,500 → ₹300 short, note required, CASH_DIFF posted.
    await goHome(page);
    await vis(page, "dash-close-day").click();
    await expect(vis(page, "day-close-expected")).toHaveAttribute("data-paise", "10380000");
    await vis(page, "denom-500").fill("207");
    await vis(page, "denom-use").click();
    await expect(vis(page, "day-close-diff")).toHaveAttribute("data-paise", "-30000");
    await vis(page, "day-close-save").click();
    await expect(vis(page, "day-close-note")).toBeVisible();
    await vis(page, "day-close-note").fill("₹300 short");
    await vis(page, "day-close-save").click();
    await expect(vis(page, "day-closed")).toBeVisible();
    await expectNoHorizontalScroll(page);

    await goHome(page);
    await expect(vis(page, "home-cash")).toHaveAttribute("data-paise", "10350000");
    await expect(vis(page, "dash-day-closed")).toBeVisible();
    await expect(
      page.locator('[data-testid="voucher-row"][data-number*="-DCL-"]:visible'),
    ).toHaveCount(1);
    await ctx.close();
  });
}

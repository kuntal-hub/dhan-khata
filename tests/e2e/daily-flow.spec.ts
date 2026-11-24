/**
 * Full daily flow (spec §19.1), in BOTH languages, each in its own new godown:
 * opening cash (yesterday) → purchase with paid-now → load (OWN_TRADE) → store sale → mill pays
 * cash via the driver → labour expense → every dashboard number checked against hand-computed
 * values → day close with no difference.
 *
 * Hand-computed (₹): opening 1,00,000. Purchase F1 1,000 kg @ 2,000 = 20,000 (5,000 paid now).
 * Load F2 → mill 2,000 kg, party 2,100 / mill 2,300 → purchase 42,000 + sale 46,000.
 * Store sale 500 kg @ 2,400 = 12,000. Mill cash 40,000. Labour 1,200.
 *   cash: 1,00,000 + 40,000 − 5,000 − 1,200 = 1,33,800
 *   STORE stock 1,000 − 500 = 500 kg; sold 2,500 kg for 58,000; bought 3,000 kg for 62,000
 *   receivable mill 46,000 + 12,000 − 40,000 = 18,000; payable 15,000 + 42,000 = 57,000
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
  { lang: "bn", name: "দৈনিক বাংলা", code: "DFB", variety: /^স্বর্ণ$/, labour: "লেবার" },
  { lang: "en", name: "Daily English", code: "DFE", variety: /^Swarna$/, labour: "Labour" },
] as const;

async function goHome(page: Page) {
  await vis(page, "tab-home").click();
  await expect(vis(page, "dashboard")).toBeVisible();
}

const paise = (page: Page, card: string) => vis(page, card).locator("[data-paise]").first();
const grams = (page: Page, card: string) => vis(page, card).locator("[data-grams]").first();

for (const run of RUNS) {
  test(`full daily flow in ${run.lang}`, async () => {
    const { ctx, page } = await openBrowser();
    await loginFresh(page);
    if (run.lang === "en") await switchToEnglish(page);
    await createGodownViaWizard(page, {
      name: run.name,
      code: run.code,
      cash: "100000",
      goLive: istDate(-1),
    });
    const F1 = `${run.lang} DF Farmer 1`;
    const F2 = `${run.lang} DF Farmer 2`;
    const M = `${run.lang} DF Mill`;
    await createParty(page, F1);
    await createParty(page, F2);
    await createParty(page, M, "mill");

    // Purchase with ₹5,000 paid now.
    await goHome(page);
    await vis(page, "qa-purchase").click();
    await pick(page, "purchase-party", F1);
    await pick(page, "line-0-variety", run.variety);
    await vis(page, "line-0-gross").fill("1000");
    await vis(page, "line-0-rate").fill("2000");
    await vis(page, "purchase-paid").fill("5000");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/purchase\/view\?id=/);

    // Load (OWN_TRADE).
    await goHome(page);
    await vis(page, "qa-load").click();
    await pick(page, "load-seller", F2);
    await pick(page, "load-mill", M);
    await vis(page, "load-vehicle").fill("WB12AB3456");
    await pick(page, "load-variety", run.variety);
    await vis(page, "load-gross").fill("2000");
    await vis(page, "load-sell-rate").fill("2100");
    await vis(page, "load-mill-rate").fill("2300");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/load\/view\?id=/);

    // Store sale.
    await goHome(page);
    await vis(page, "qa-sale").click();
    await pick(page, "sale-party", M);
    await pick(page, "line-0-variety", run.variety);
    await vis(page, "line-0-gross").fill("500");
    await vis(page, "line-0-rate").fill("2400");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/sale\/view\?id=/);

    // Mill sends cash with the driver.
    await goHome(page);
    await vis(page, "qa-receipt").click();
    await pick(page, "money-party", M);
    await vis(page, "money-amount").fill("40000");
    await vis(page, "money-via").fill("WB12AB3456");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/payment\/view\?id=/);

    // Labour.
    await goHome(page);
    await vis(page, "qa-expense").click();
    await pick(page, "expense-category", run.labour);
    await vis(page, "expense-amount").fill("1200");
    await vis(page, "expense-description").fill("loading");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/voucher\/view\?id=/);

    // Every dashboard number.
    await goHome(page);
    await expect(vis(page, "dash-opening-cash-value")).toHaveAttribute("data-paise", "10000000");
    await expect(vis(page, "home-cash")).toHaveAttribute("data-paise", "13380000");
    await expect(vis(page, "dash-stock-value")).toHaveAttribute("data-grams", "500000");
    await expect(grams(page, "dash-sale-qty")).toHaveAttribute("data-grams", "2500000");
    await expect(paise(page, "dash-sale-amount")).toHaveAttribute("data-paise", "5800000");
    await expect(grams(page, "dash-purchase")).toHaveAttribute("data-grams", "3000000");
    await expect(vis(page, "dash-purchase")).toContainText(run.lang === "bn" ? "৬২,০০০" : "62,000");
    await expect(vis(page, "dash-expense-value")).toHaveAttribute("data-paise", "120000");
    await expect(paise(page, "dash-receivable")).toHaveAttribute("data-paise", "1800000");
    await expect(paise(page, "dash-payable")).toHaveAttribute("data-paise", "5700000");
    await expect(page.locator('[data-testid="voucher-row"]:visible')).toHaveCount(8);
    await expectNoHorizontalScroll(page);

    // Day close: counted = expected → no note needed.
    await vis(page, "dash-close-day").click();
    await expect(vis(page, "day-close-expected")).toHaveAttribute("data-paise", "13380000");
    await vis(page, "day-close-counted").fill("133800");
    await expect(vis(page, "day-close-diff")).toHaveAttribute("data-paise", "0");
    await vis(page, "day-close-save").click();
    await expect(vis(page, "day-closed")).toBeVisible();
    await goHome(page);
    await expect(vis(page, "dash-day-closed")).toBeVisible();
    await expect(vis(page, "home-cash")).toHaveAttribute("data-paise", "13380000");
    await ctx.close();
  });
}

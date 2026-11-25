/**
 * requirement_v2 §21 Test 6 (Partial sales collection), in Bengali and in English, at phone width:
 * sale 10 qtl × ₹2,500 = ₹25,000; ₹10,000 received as the advance on the form (day 1) and ₹5,000
 * collected later (day 2) → due ₹10,000; the customer ledger shows the sale and both collections
 * on their own dates. Also: buyer created inline, the negative-stock warning ("Save anyway"),
 * delivery steps, the invoice, the list and refresh. Screenshots go to test-results/v2-sales/.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  istDate,
  loginFresh,
  openBrowser,
  pick,
  switchToEnglish,
  vis,
} from "./helpers";

const SHOTS = "test-results/v2-sales";
const D0 = istDate(-4);
const D1 = istDate(-3);
const D2 = istDate(-1);

async function runTest6(page: Page, lang: "bn" | "en") {
  const buyer = lang === "bn" ? "মা দুর্গা ট্রেডার্স" : "Laxmi Traders";
  await page.goto("/sales/new");
  await expect(vis(page, "sale-form")).toBeVisible();
  await vis(page, "sale-party").click();
  await vis(page, "sale-party-search").fill(buyer);
  await vis(page, "sale-party-create").click();
  await expect(vis(page, "new-party-name")).toHaveValue(buyer);
  await vis(page, "new-party-phone").fill("9876501234");
  await vis(page, "new-party-save").click();
  await expect(vis(page, "sale-party")).toContainText(buyer);

  await vis(page, "sale-date").fill(D0);
  // A variety nobody bought in this test server: the stock warning must appear.
  const variety = lang === "bn" ? "গোবিন্দভোগ" : "Gobindobhog";
  await pick(page, "sale-variety", variety);
  await expect(vis(page, "sale-variety")).toContainText(variety);
  await vis(page, "sale-weight-mode-MANUAL").click();
  await vis(page, "sale-weight-manual").fill("10");
  await expect(vis(page, "sale-weight-total-qtl")).toHaveAttribute("data-grams", "1000000");
  await vis(page, "sale-rate").fill("2500");
  await expect(vis(page, "sale-total")).toHaveAttribute("data-paise", "2500000");
  await vis(page, "sale-pay-amount").fill("10000");
  await vis(page, "sale-pay-date").fill(D1);
  await expect(vis(page, "sale-due")).toContainText(lang === "bn" ? "১৫,০০০" : "15,000");
  await vis(page, "sale-delivery-LOADED").click();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-new-sale.png`, fullPage: true });
  await vis(page, "form-save").click();

  // No stock of this variety: an explicit "Save anyway" is needed (§9.3).
  await expect(vis(page, "sale-stock-warning")).toBeVisible();
  await vis(page, "sale-save-anyway").click();
  await expect(vis(page, "sale-saved")).toBeVisible();
  await vis(page, "sale-open-detail").click();
  await expect(vis(page, "sale-detail")).toBeVisible();
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "1500000");

  // Second collection on another date.
  await vis(page, "add-due-payment").click();
  await expect(vis(page, "add-payment")).toBeVisible();
  await vis(page, "add-pay-amount").fill("5000");
  await vis(page, "add-pay-date").fill(D2);
  await vis(page, "add-pay-save").click();
  await expect(page.getByTestId("add-payment")).toHaveCount(0);
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "1000000");
  await expect(vis(page, "payment-row")).toHaveCount(2);
  await expect(vis(page, "detail-paid")).toContainText(lang === "bn" ? "১৫,০০০" : "15,000");

  // Delivery: LOADED → IN_TRANSIT.
  await vis(page, "delivery-next").click();
  await expect(vis(page, "delivery-timeline")).toContainText(
    lang === "bn" ? "পথে আছে" : "In transit",
  );
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/${lang}-360-sale-detail.png`, fullPage: true });

  // Survives a refresh.
  await page.reload();
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "1000000");

  // Invoice.
  await vis(page, "sale-print").click();
  await expect(vis(page, "sale-invoice")).toBeVisible();
  await expect(vis(page, "sale-invoice")).toContainText(buyer);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-invoice.png`, fullPage: true });

  // List.
  await page.goto("/sales");
  await vis(page, "sale-search").fill(buyer);
  const row = vis(page, "sale-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(lang === "bn" ? "১০,০০০" : "10,000");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-sale-list.png`, fullPage: true });

  // Customer ledger: sale on D0, collections on D1 and D2; they owe ₹10,000.
  await page.goto("/sales?tab=customers");
  await vis(page, "customer-row").filter({ hasText: buyer }).click();
  await expect(vis(page, "customer-balance")).toHaveAttribute("data-paise", "1000000");
  const dates = await vis(page, "customer-ledger-row").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-date")),
  );
  expect(dates).toEqual([D0, D1, D2]);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-customer.png`, fullPage: true });
}

test("Test 6 — sale with two collections (বাংলা)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await runTest6(page, "bn");
  await ctx.close();
});

test("Test 6 — sale with two collections (English)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await switchToEnglish(page);
  await runTest6(page, "en");
  await ctx.close();
});

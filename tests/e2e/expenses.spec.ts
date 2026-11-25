/**
 * requirement_v2 §21 Test 5 (Backdated expense), in Bengali and in English, at phone width:
 * labour ₹5,000 with the expense date 4 days ago and today's entry date; ₹3,000 paid on the
 * expense date, ₹2,000 today → balance 0; two payments with their own dates; the day view of the
 * expense date lists it under লেবার. Also the farmer-payment flow (a payment, shown with the
 * "পেমেন্ট" badge, never an expense). Screenshots go to test-results/v2-expenses/.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  istDate,
  loginFresh,
  openBrowser,
  switchToEnglish,
  vis,
} from "./helpers";

const SHOTS = "test-results/v2-expenses";
const D1 = istDate(-4);
const TODAY = istDate(0);

async function runTest5(page: Page, lang: "bn" | "en") {
  const title = lang === "bn" ? "ধান তোলার লেবার" : "Unloading labour";
  await page.goto("/expenses/new");
  await expect(vis(page, "expense-form")).toBeVisible();
  await vis(page, "expense-cat-LABOUR").click();
  await vis(page, "expense-title").fill(title);
  await vis(page, "expense-amount").fill("5000");
  await vis(page, "expense-date").fill(D1);
  await expect(vis(page, "expense-entry-date")).toBeVisible();
  await vis(page, "expense-paystate-PART").click();
  await vis(page, "expense-pay-amount").fill("3000");
  await vis(page, "expense-pay-date").fill(D1);
  await expect(vis(page, "expense-left")).toContainText(lang === "bn" ? "২,০০০" : "2,000");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-new-expense.png`, fullPage: true });
  await vis(page, "form-save").click();

  await expect(vis(page, "expense-saved")).toBeVisible();
  await vis(page, "expense-open-detail").click();
  await expect(vis(page, "expense-detail")).toBeVisible();
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "200000");
  await expect(vis(page, "detail-expense-date")).toHaveAttribute("data-date", D1);
  await expect(vis(page, "detail-entry-date")).toHaveAttribute("data-date", TODAY);

  await vis(page, "add-due-payment").click();
  await expect(vis(page, "add-payment")).toBeVisible();
  await expect(vis(page, "add-pay-amount")).toHaveValue("2000");
  await vis(page, "add-pay-save").click();
  await expect(page.getByTestId("add-payment")).toHaveCount(0);
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "0");
  await expect(vis(page, "payment-row")).toHaveCount(2);
  await expect(vis(page, "detail-paid")).toContainText(lang === "bn" ? "৫,০০০" : "5,000");
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/${lang}-360-expense-detail.png`, fullPage: true });

  // The expense date's day view lists it under Labour; it is not in the unpaid list.
  await page.goto("/expenses");
  await vis(page, "xp-day").fill(D1);
  await expect(vis(page, "xp-group-LABOUR")).toBeVisible();
  await expect(vis(page, "expense-row").filter({ hasText: title })).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-day.png`, fullPage: true });
  await page.goto("/expenses?tab=unpaid");
  await expect(page.getByTestId("expense-row").filter({ hasText: title })).toHaveCount(0);

  // Farmer payment from the expense screen: saved as a payment (advance), shown with a badge.
  const farmer = lang === "bn" ? "হারু মণ্ডল" : "Haru Mondal";
  await page.goto("/expenses/new");
  await vis(page, "expense-cat-FARMER_PAYMENT").click();
  await expect(vis(page, "farmer-payment")).toBeVisible();
  await vis(page, "farmer-pay-party").click();
  await vis(page, "farmer-pay-party-search").fill(farmer);
  await vis(page, "farmer-pay-party-create").click();
  await vis(page, "new-party-save").click();
  await vis(page, "farmer-bill-advance").click();
  await vis(page, "farmer-pay-amount").fill("1500");
  await vis(page, "form-save").click();
  await expect(vis(page, "xp-farmer-payments")).toContainText(farmer);

  // All expenses by payment date today includes the labour expense (its ₹2,000 payment).
  await page.goto("/expenses?tab=all");
  await vis(page, "expense-by").selectOption("PAYMENT");
  await vis(page, "expense-search").fill(title);
  await expect(vis(page, "expense-row")).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-all.png`, fullPage: true });
}

test("Test 5 — backdated expense with two payments (বাংলা)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await runTest5(page, "bn");
  await ctx.close();
});

test("Test 5 — backdated expense with two payments (English)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await switchToEnglish(page);
  await runTest5(page, "en");
  await ctx.close();
});

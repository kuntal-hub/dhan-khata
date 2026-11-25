/**
 * requirement_v2 §21 Test 1 (Purchase), in Bengali and in English, at phone width:
 * 56 qtl × ₹2,400 = ₹1,34,400; initial ₹50,000 cash (day 1) → due ₹84,400; + ₹30,000 bank (day 3)
 * → ₹54,400; + ₹20,000 cash (day 5) → ₹34,400. Three payment records with their own dates.
 * Also: a farmer and a bank account created inline, the bag-wise weight entry, the list, refresh.
 * Screenshots for the visual review go to test-results/v2-purchase/.
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

const SHOTS = "test-results/v2-purchase";
const D1 = istDate(-5);
const D2 = istDate(-3);
const D3 = istDate(-1);

async function addBank(page: Page, name: string) {
  await page.goto("/banks");
  await vis(page, "bank-add").click();
  await vis(page, "bank-name").fill(name);
  await vis(page, "bank-bank").fill("SBI");
  await vis(page, "bank-last4").fill("4321");
  await vis(page, "bank-opening").fill("100000");
  await vis(page, "bank-save").click();
  await expect(vis(page, "bank-row").filter({ hasText: name })).toBeVisible();
}

async function addPayment(page: Page, amount: string, date: string, bank?: string) {
  await vis(page, "add-due-payment").click();
  await expect(vis(page, "add-payment")).toBeVisible();
  await vis(page, "add-pay-amount").fill(amount);
  await vis(page, "add-pay-date").fill(date);
  if (bank) {
    await vis(page, "add-pay-mode-BANK").click();
    await pick(page, "add-pay-bank", bank);
  }
  await vis(page, "add-pay-save").click();
  await expect(page.getByTestId("add-payment")).toHaveCount(0);
}

async function runTest1(page: Page, lang: "bn" | "en") {
  const farmer = lang === "bn" ? "রহিম শেখ" : "Karim Mondal";
  const bank = lang === "bn" ? "স্টেট ব্যাংক চলতি" : "SBI Current";
  await addBank(page, bank);

  await page.goto("/purchase/new");
  await expect(vis(page, "purchase-form")).toBeVisible();
  // New farmer, created inline from the picker (works offline).
  await vis(page, "purchase-party").click();
  await vis(page, "purchase-party-search").fill(farmer);
  await vis(page, "purchase-party-create").click();
  await expect(vis(page, "new-party-name")).toHaveValue(farmer);
  await vis(page, "new-party-phone").fill("9876543210");
  await vis(page, "new-party-save").click();
  await expect(vis(page, "purchase-party")).toContainText(farmer);

  await vis(page, "purchase-date").fill(D1);
  // Full name: "স্বর্ণ" alone also matches "লাল স্বর্ণ".
  const variety = lang === "bn" ? "স্বর্ণ (MTU-7029)" : "Swarna (MTU-7029)";
  await pick(page, "purchase-variety", variety);
  await expect(vis(page, "purchase-variety")).toContainText(variety);

  if (lang === "bn") {
    await vis(page, "purchase-weight-mode-MANUAL").click();
    await vis(page, "purchase-weight-manual").fill("56");
  } else {
    // Bag by bag: Enter moves to the next bag. 4 × 1,400 kg = 56 qtl.
    for (let i = 0; i < 4; i++) {
      await vis(page, `purchase-weight-bag-${i}`).fill("1400");
      if (i < 3) await vis(page, `purchase-weight-bag-${i}`).press("Enter");
    }
  }
  await expect(vis(page, "purchase-weight-total-qtl")).toHaveAttribute("data-grams", "5600000");
  await vis(page, "purchase-rate").fill("2400");
  await expect(vis(page, "purchase-total")).toHaveAttribute("data-paise", "13440000");

  await vis(page, "purchase-pay-amount").fill("50000");
  await vis(page, "purchase-pay-date").fill(D1);
  await expect(vis(page, "purchase-due")).toContainText(lang === "bn" ? "৮৪,৪০০" : "84,400");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-new-purchase.png`, fullPage: true });
  await vis(page, "form-save").click();

  await expect(vis(page, "purchase-saved")).toBeVisible();
  await vis(page, "purchase-open-detail").click();
  await expect(vis(page, "purchase-detail")).toBeVisible();
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "8440000");
  await expect(vis(page, "detail-variety")).toHaveText(variety);

  await addPayment(page, "30000", D2, bank);
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "5440000");
  await addPayment(page, "20000", D3);
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "3440000");

  const rows = vis(page, "payment-row");
  await expect(rows).toHaveCount(3);
  await expect(vis(page, "detail-paid")).toContainText(lang === "bn" ? "১,০০,০০০" : "1,00,000");
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/${lang}-360-purchase-detail.png`, fullPage: true });

  // Survives a refresh; the list shows it as partly paid with the due.
  await page.reload();
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "3440000");
  await expect(vis(page, "payment-row")).toHaveCount(3);
  await page.goto("/purchase");
  await vis(page, "purchase-search").fill(farmer);
  const row = vis(page, "purchase-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(lang === "bn" ? "৩৪,৪০০" : "34,400");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-purchase-list.png`, fullPage: true });

  // Farmer account: we owe ₹34,400.
  await page.goto("/purchase?tab=farmers");
  await vis(page, "farmer-row").filter({ hasText: farmer }).click();
  await expect(vis(page, "farmer-balance")).toHaveAttribute("data-paise", "-3440000");
}

test("Test 1 — purchase with three payments (বাংলা)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await runTest1(page, "bn");
  await ctx.close();
});

test("Test 1 — purchase with three payments (English)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await switchToEnglish(page);
  await runTest1(page, "en");
  await ctx.close();
});

/**
 * requirement_v2 §21 Test 4 (Daily cashbook), in Bengali and in English, at phone width:
 * opening ₹50,000; cash received ₹25,000; cash paid ₹40,000; cash expenses ₹5,000 → expected
 * ₹30,000; counted ₹29,500 → short ₹500 and the next day opens with ₹29,500; reopened and counted
 * ₹30,200 instead → excess ₹200 and the next day opens with ₹30,200.
 * Each language uses its own past dates (the e2e server is shared): the day before is closed at
 * ₹50,000 first, so the test day's opening is exactly ₹50,000.
 * Also: Overview (range filter, metric cards, chart → day view), Daily Stock (opening stock,
 * count → adjustment), Daily Overview table. Screenshots go to test-results/v2-dashboard/.
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

const SHOTS = "test-results/v2-dashboard";

async function closeDayWith(page: Page, amount: string, note: string) {
  await vis(page, "cb-close").click();
  await expect(vis(page, "close-sheet")).toBeVisible();
  await vis(page, "cb-actual").fill(amount);
  if (await page.getByTestId("cb-note").count()) await vis(page, "cb-note").fill(note);
  await vis(page, "cb-close-save").click();
  await expect(vis(page, "cb-closed")).toBeVisible();
}

async function contra(page: Page, kind: string, amount: string) {
  await vis(page, `cb-action-${kind}`).click();
  await expect(vis(page, "contra-sheet")).toBeVisible();
  await vis(page, "contra-amount").fill(amount);
  await vis(page, "contra-save").click();
  await expect(page.getByTestId("contra-sheet")).toHaveCount(0);
}

async function runTest4(page: Page, lang: "bn" | "en", base: number) {
  const D0 = istDate(base);
  const D1 = istDate(base + 1);
  const D2 = istDate(base + 2);
  const note = lang === "bn" ? "হিসাব মেলানো" : "count";

  // The day before: close at ₹50,000 so the test day opens with exactly ₹50,000.
  await page.goto(`/?tab=cashbook&date=${D0}`);
  await expect(vis(page, "cb-date")).toHaveValue(D0);
  await closeDayWith(page, "50000", note);

  // Test day: received ₹25,000, paid ₹40,000 (cashbook actions), expense ₹5,000 (expense form).
  await vis(page, "cb-next-day").click();
  await expect(vis(page, "cb-date")).toHaveValue(D1);
  await expect(vis(page, "cb-opening")).toHaveAttribute("data-paise", "5000000");
  await contra(page, "CAPITAL_IN", "25000");
  await contra(page, "DRAWINGS", "40000");
  await page.goto("/expenses/new");
  await vis(page, "expense-cat-LABOUR").click();
  await vis(page, "expense-title").fill(lang === "bn" ? "দিনমজুরি" : "Daily wages");
  await vis(page, "expense-amount").fill("5000");
  await vis(page, "expense-date").fill(D1);
  await vis(page, "expense-pay-date").fill(D1);
  await vis(page, "form-save").click();
  await expect(vis(page, "expense-saved")).toBeVisible();

  await page.goto(`/?tab=cashbook&date=${D1}`);
  await expect(vis(page, "cb-opening")).toHaveAttribute("data-paise", "5000000");
  await expect(vis(page, "cb-received")).toHaveAttribute("data-paise", "2500000");
  await expect(vis(page, "cb-paid")).toHaveAttribute("data-paise", "4000000");
  await expect(vis(page, "cb-expenses")).toHaveAttribute("data-paise", "500000");
  await expect(vis(page, "cb-expected")).toHaveAttribute("data-paise", "3000000");
  await expect(vis(page, "cb-item")).toHaveCount(3);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-cashbook.png`, fullPage: true });

  // Counted ₹29,500 → short ₹500; the next day opens with ₹29,500.
  await vis(page, "cb-close").click();
  await vis(page, "cb-actual").fill("29500");
  await expect(vis(page, "cb-diff")).toHaveAttribute("data-paise", "-50000");
  await page.screenshot({ path: `${SHOTS}/${lang}-360-close.png`, fullPage: true });
  await vis(page, "cb-note").fill(note);
  await vis(page, "cb-close-save").click();
  await expect(vis(page, "cb-closed-diff")).toHaveAttribute("data-paise", "-50000");
  await vis(page, "cb-next-day").click();
  await expect(vis(page, "cb-date")).toHaveValue(D2);
  await expect(vis(page, "cb-opening")).toHaveAttribute("data-paise", "2950000");

  // Reopen and count ₹30,200 instead → excess ₹200; the next day opens with ₹30,200.
  await vis(page, "cb-prev-day").click();
  await vis(page, "cb-reopen").click();
  await vis(page, "reopen-reason").fill(note);
  await vis(page, "confirm-yes").click();
  await expect(vis(page, "cb-close")).toBeVisible();
  await vis(page, "cb-close").click();
  await vis(page, "cb-actual").fill("30200");
  await expect(vis(page, "cb-diff")).toHaveAttribute("data-paise", "20000");
  await vis(page, "cb-note").fill(note);
  await vis(page, "cb-close-save").click();
  await expect(vis(page, "cb-closed-diff")).toHaveAttribute("data-paise", "20000");
  await vis(page, "cb-next-day").click();
  await expect(vis(page, "cb-opening")).toHaveAttribute("data-paise", "3020000");
}

async function overviewAndStock(page: Page, lang: "bn" | "en", base: number) {
  // Daily Stock: opening stock on an old date, then a physical count → adjustment.
  const D = istDate(base);
  await page.goto(`/?tab=stock&date=${D}`);
  await expect(vis(page, "stock-tab")).toBeVisible();
  await vis(page, "stock-opening-add").click();
  const variety = lang === "bn" ? "মিনিকিট" : "Minikit";
  await pick(page, "opening-variety", variety);
  await vis(page, "opening-qty").fill("100");
  await vis(page, "opening-rate").fill("2000");
  await vis(page, "opening-save").click();
  await expect(page.getByTestId("opening-stock-sheet")).toHaveCount(0);
  const vid = await vis(page, "stock-variety")
    .locator("option", { hasText: variety })
    .first()
    .getAttribute("value");
  await vis(page, "stock-variety").selectOption(vid!);
  await expect(vis(page, "stock-adjust")).toHaveAttribute("data-grams", /^\d+$/);
  const closing = BigInt((await vis(page, "stock-closing").getAttribute("data-grams"))!);
  // Count 1 qtl less than the books → shortage → approve (drying).
  await vis(page, "stock-counted").fill(((closing - 100_000n) / 100_000n).toString());
  await expect(vis(page, "stock-diff")).toHaveAttribute("data-grams", "-100000");
  await vis(page, "stock-approve").click();
  await expect(vis(page, "stock-closing")).toHaveAttribute(
    "data-grams",
    (closing - 100_000n).toString(),
  );
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-stock.png`, fullPage: true });

  // Overview: this month; cards, chart, alerts and recent entries render with real data.
  await page.goto("/");
  await vis(page, "dash-range-month").click();
  await expect(vis(page, "m-cash")).toHaveAttribute("data-value", /^-?\d+$/);
  await expect(vis(page, "m-paddy")).toBeVisible();
  await expect(vis(page, "recent")).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-overview.png`, fullPage: true });

  // Daily Overview with a custom range over the test days; tapping a date opens that day.
  await page.goto("/?tab=daily");
  await vis(page, "dash-range-custom").click();
  await vis(page, "dash-from").fill(istDate(base));
  await vis(page, "dash-to").fill(istDate(base + 2));
  await expect(vis(page, "daily-row")).toHaveCount(3);
  await expect(vis(page, "daily-total")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${lang}-360-daily.png`, fullPage: true });
  await vis(page, "daily-row").first().locator("a").click();
  await expect(vis(page, "day-entries")).toBeVisible();
}

test("Test 4 — daily cashbook, close, reopen (বাংলা)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await runTest4(page, "bn", -30);
  await overviewAndStock(page, "bn", -30);
  await ctx.close();
});

test("Test 4 — daily cashbook, close, reopen (English)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await switchToEnglish(page);
  await runTest4(page, "en", -20);
  await overviewAndStock(page, "en", -20);
  await ctx.close();
});

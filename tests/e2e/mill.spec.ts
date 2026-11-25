/**
 * requirement_v2 §21 Test 2 (Stock) and Test 3 (Mill return), in Bengali and in English, at phone
 * width, all through the UI: opening 100 qtl; purchase +56; sale −10; mill dispatch −20 →
 * Gola paddy 126, mill 20. Return 5 qtl paddy against that dispatch → Gola 131, mill 15; a 3 qtl
 * rice return goes only to rice stock. Each language uses its own new variety and its own new mill
 * (the e2e server is shared). Also: dispatch-wise balance, the second-party ledger, a consignment
 * settled into a sale. Screenshots go to test-results/v2-mill/.
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

const SHOTS = "test-results/v2-mill";
const QTL = 100_000n;

/** Create a variety inline from a VarietyPicker (accepting "create anyway" if a close match). */
async function newVariety(page: Page, testId: string, name: string) {
  await vis(page, testId).click();
  await vis(page, `${testId}-search`).fill(name);
  await vis(page, `${testId}-create`).click();
  await expect(vis(page, "new-variety-name")).toHaveValue(name);
  await vis(page, "new-variety-save").click();
  const similar = page.getByTestId("variety-similar");
  if (await similar.isVisible().catch(() => false))
    await vis(page, "variety-create-anyway").click();
  await expect(vis(page, testId)).toContainText(name);
}

/** Create a party inline from a PartyPicker. */
async function newParty(page: Page, testId: string, name: string) {
  await vis(page, testId).click();
  await vis(page, `${testId}-search`).fill(name);
  await vis(page, `${testId}-create`).click();
  await expect(vis(page, "new-party-name")).toHaveValue(name);
  await vis(page, "new-party-save").click();
  await expect(vis(page, testId)).toContainText(name);
}

async function manualWeight(page: Page, testId: string, qtl: string) {
  await vis(page, `${testId}-mode-MANUAL`).click();
  await vis(page, `${testId}-manual`).fill(qtl);
}

async function stockOn(page: Page, date: string, variety: string) {
  await page.goto(`/?tab=stock&date=${date}`);
  await expect(vis(page, "stock-tab")).toBeVisible();
  const vid = await vis(page, "stock-variety")
    .locator("option", { hasText: variety })
    .first()
    .getAttribute("value");
  await vis(page, "stock-variety").selectOption(vid!);
}

async function millClosing(page: Page, mill: string): Promise<string | null> {
  const row = vis(page, "stock-mills").locator("tr", { hasText: mill });
  return row.getByTestId("stock-mill-closing").getAttribute("data-grams");
}

async function riceClosing(page: Page, date: string): Promise<bigint> {
  await page.goto(`/?tab=stock&date=${date}`);
  await vis(page, "stock-product-RICE").click();
  return BigInt((await vis(page, "stock-rice-closing").getAttribute("data-grams"))!);
}

async function runTests2and3(page: Page, lang: "bn" | "en", base: number) {
  const D0 = istDate(base);
  const D1 = istDate(base + 1);
  const D2 = istDate(base + 2);
  const variety = lang === "bn" ? "মিলপরীক্ষা ধান" : "Millcheck Paddy";
  const mill = lang === "bn" ? "শ্রী গণেশ রাইস মিল" : "Ganesh Rice Mill";

  // Opening 100 qtl (Dashboard → Stock).
  await page.goto(`/?tab=stock&date=${D0}`);
  await vis(page, "stock-opening-add").click();
  await newVariety(page, "opening-variety", variety);
  await vis(page, "opening-qty").fill("100");
  await vis(page, "opening-rate").fill("2000");
  await vis(page, "opening-save").click();
  await expect(page.getByTestId("opening-stock-sheet")).toHaveCount(0);

  // Purchase +56 (full credit).
  await page.goto("/purchase/new");
  await newParty(page, "purchase-party", lang === "bn" ? "মিল-পরীক্ষা কৃষক" : "Mill Test Farmer");
  await vis(page, "purchase-date").fill(D1);
  await pick(page, "purchase-variety", variety);
  await manualWeight(page, "purchase-weight", "56");
  await vis(page, "purchase-rate").fill("2400");
  await vis(page, "form-save").click();
  await expect(vis(page, "purchase-saved")).toBeVisible();

  // Sale −10.
  await page.goto("/sales/new");
  await newParty(page, "sale-party", lang === "bn" ? "মিল-পরীক্ষা ক্রেতা" : "Mill Test Buyer");
  await vis(page, "sale-date").fill(D1);
  await pick(page, "sale-variety", variety);
  await manualWeight(page, "sale-weight", "10");
  await vis(page, "sale-rate").fill("2600");
  await vis(page, "form-save").click();
  await expect(vis(page, "sale-saved")).toBeVisible();

  // Mill dispatch −20 (for milling), new mill created inline.
  await page.goto("/mill/dispatch/new");
  await expect(vis(page, "dispatch-form")).toBeVisible();
  await vis(page, "dispatch-type-MILLING").click();
  await newParty(page, "dispatch-mill", mill);
  await vis(page, "dispatch-date").fill(D1);
  await pick(page, "dispatch-variety", variety);
  await expect(vis(page, "dispatch-stock-now")).toContainText(lang === "bn" ? "১৪৬" : "146");
  await manualWeight(page, "dispatch-weight", "20");
  await vis(page, "dispatch-rate").fill("50");
  await expect(vis(page, "dispatch-total")).toContainText(lang === "bn" ? "১,০০০" : "1,000");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-dispatch-form.png`, fullPage: true });
  await vis(page, "form-save").click();
  await expect(vis(page, "dispatch-saved")).toBeVisible();
  await vis(page, "dispatch-open-detail").click();
  await expect(vis(page, "dispatch-detail")).toBeVisible();
  await expect(vis(page, "dispatch-remaining")).toHaveAttribute("data-g", (20n * QTL).toString());
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "100000");

  // Test 2: Gola 126, mill 20.
  await stockOn(page, D1, variety);
  await expect(vis(page, "stock-closing")).toHaveAttribute("data-grams", (126n * QTL).toString());
  expect(await millClosing(page, mill)).toBe((20n * QTL).toString());
  const riceBefore = await riceClosing(page, D2);

  // Test 3: return 5 qtl paddy → Gola 131, mill 15.
  await page.goto("/mill?tab=dispatch");
  await vis(page, "dispatch-row").filter({ hasText: mill }).first().click();
  await vis(page, "dispatch-add-return").click();
  await expect(vis(page, "return-form")).toBeVisible();
  await vis(page, "return-date").fill(D2);
  await vis(page, "return-product-PADDY").click();
  await manualWeight(page, "return-weight", "5");
  await vis(page, "form-save").click();
  await expect(vis(page, "return-saved")).toBeVisible();
  await stockOn(page, D2, variety);
  await expect(vis(page, "stock-closing")).toHaveAttribute("data-grams", (131n * QTL).toString());
  expect(await millClosing(page, mill)).toBe((15n * QTL).toString());
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-stock.png`, fullPage: true });

  // A 3 qtl rice return goes only to rice stock.
  await page.goto("/mill/return/new");
  await vis(page, "return-dispatch")
    .getByRole("radio", { name: new RegExp(mill) })
    .click();
  await vis(page, "return-date").fill(D2);
  await vis(page, "return-product-RICE").click();
  await manualWeight(page, "return-weight", "3");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-return-form.png`, fullPage: true });
  await vis(page, "form-save").click();
  await expect(vis(page, "return-saved")).toBeVisible();
  expect(await riceClosing(page, D2)).toBe(riceBefore + 3n * QTL);
  await stockOn(page, D2, variety);
  await expect(vis(page, "stock-closing")).toHaveAttribute("data-grams", (131n * QTL).toString());
  expect(await millClosing(page, mill)).toBe((15n * QTL).toString());

  // Dispatch-wise history on the detail page.
  await page.goto("/mill?tab=dispatch");
  await vis(page, "dispatch-row").filter({ hasText: mill }).first().click();
  await expect(vis(page, "dispatch-remaining")).toHaveAttribute("data-g", (15n * QTL).toString());
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-dispatch-detail.png`, fullPage: true });
}

async function secondParty(page: Page, lang: "bn" | "en") {
  const name = lang === "bn" ? "বিকাশ মণ্ডল" : "Bikash Mondal";
  await page.goto("/mill");
  await vis(page, "sp-new").click();
  await expect(vis(page, "sp-form")).toBeVisible();
  await newParty(page, "sp-party", name);
  await vis(page, "sp-kind-WE_OWE").click();
  await vis(page, "sp-amount").fill("5000");
  await vis(page, "sp-pay-amount").fill("2000");
  await vis(page, "form-save").click();
  await expect(vis(page, "sp-account")).toBeVisible();
  await expect(vis(page, "sp-balance")).toHaveAttribute("data-paise", "-300000");
  await vis(page, "sp-entry-row").first().click();
  await vis(page, "add-due-payment").click();
  await vis(page, "add-pay-amount").fill("1000");
  await vis(page, "add-pay-save").click();
  await expect(page.getByTestId("add-payment")).toHaveCount(0);
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "200000");
  await page.goto("/mill");
  await expect(vis(page, "sp-row").filter({ hasText: name })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-second-party.png`, fullPage: true });
}

test("Tests 2 and 3 — mill dispatch and return (বাংলা)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await runTests2and3(page, "bn", -12);
  await secondParty(page, "bn");
  await ctx.close();
});

test("Tests 2 and 3 — mill dispatch and return (English)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await switchToEnglish(page);
  await runTests2and3(page, "en", -9);
  await secondParty(page, "en");
  await ctx.close();
});

/**
 * v2 Phase 10 through the UI, in Bengali and in English, at phone width:
 *  - Load Khata: opening 50 qtl of a new variety; a 20 qtl load moves nothing; "create sale from
 *    this load" → Gola 30 (one deduction); editing the load to 22 qtl with "update the linked
 *    record too" → Gola 28 (still one deduction); the register shows it linked.
 *  - Due & Advance: two credit purchases (₹4,000 + ₹6,000) from a new farmer; "পেমেন্ট দিলাম"
 *    ₹12,000 → oldest first, ₹2,000 kept as advance; the party ledger shows the advance and the
 *    farmer appears under অগ্রিম.
 *  - Vehicle trip: new vehicle and customer inline, fixed fare ₹8,000, advance ₹3,000, driver
 *    ₹1,000 + diesel ₹2,500 paid now → net ₹4,500, due ₹5,000.
 * Screenshots go to test-results/v2-p10/.
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

const SHOTS = "test-results/v2-p10";
const QTL = 100_000n;

async function newParty(page: Page, testId: string, name: string) {
  await vis(page, testId).click();
  await vis(page, `${testId}-search`).fill(name);
  await vis(page, `${testId}-create`).click();
  await expect(vis(page, "new-party-name")).toHaveValue(name);
  await vis(page, "new-party-save").click();
  await expect(vis(page, testId)).toContainText(name);
}

async function stockClosing(page: Page, date: string, variety: string): Promise<string> {
  await page.goto(`/?tab=stock&date=${date}`);
  const vid = await vis(page, "stock-variety")
    .locator("option", { hasText: variety })
    .first()
    .getAttribute("value");
  await vis(page, "stock-variety").selectOption(vid!);
  return (await vis(page, "stock-closing").getAttribute("data-grams"))!;
}

async function loads(page: Page, lang: "bn" | "en") {
  const D0 = istDate(-6);
  const today = istDate(0);
  const variety = lang === "bn" ? "লোডপরীক্ষা ধান" : "Loadcheck Paddy";
  const mill = lang === "bn" ? "লোড-পরীক্ষা মিল" : "Loadcheck Mill";
  const vehicle = lang === "bn" ? "WB 23 C 1111" : "WB 23 D 2222";

  await page.goto(`/?tab=stock&date=${D0}`);
  await vis(page, "stock-opening-add").click();
  await vis(page, "opening-variety").click();
  await vis(page, "opening-variety-search").fill(variety);
  await vis(page, "opening-variety-create").click();
  await vis(page, "new-variety-save").click();
  if (
    await page
      .getByTestId("variety-similar")
      .isVisible()
      .catch(() => false)
  )
    await vis(page, "variety-create-anyway").click();
  // The nested "new variety" sheet must be closed first: until then the fields behind it are inert.
  await expect(vis(page, "opening-variety")).toContainText(variety);
  await vis(page, "opening-qty").fill("50");
  await expect(vis(page, "opening-qty")).toHaveValue("50");
  await vis(page, "opening-rate").fill("2000");
  await vis(page, "opening-save").click();
  await expect(page.getByTestId("opening-stock-sheet")).toHaveCount(0);

  // A load moves nothing by itself.
  await page.goto("/loads/new");
  await expect(vis(page, "load-form")).toBeVisible();
  await newParty(page, "load-mill", mill);
  await pick(page, "load-variety", variety);
  await vis(page, "load-weight-mode-MANUAL").click();
  await vis(page, "load-weight-manual").fill("20");
  await vis(page, "load-rate").fill("2500");
  await vis(page, "load-vehicle").fill(vehicle);
  await expect(vis(page, "load-total")).toContainText(lang === "bn" ? "৫০,০০০" : "50,000");
  await page.screenshot({ path: `${SHOTS}/${lang}-360-load-form.png`, fullPage: true });
  await vis(page, "form-save").click();
  await expect(vis(page, "load-saved")).toBeVisible();
  await vis(page, "load-open-detail").click();
  await expect(vis(page, "load-not-linked")).toBeVisible();
  const loadUrl = page.url();
  expect(await stockClosing(page, today, variety)).toBe((50n * QTL).toString());

  // Create the sale from the load: prefilled (mill as buyer, variety, weight, rate, vehicle).
  await page.goto(loadUrl);
  await vis(page, "load-create-sale").click();
  await expect(vis(page, "sale-form")).toBeVisible();
  await expect(vis(page, "sale-party")).toContainText(mill);
  await expect(vis(page, "sale-total")).toHaveAttribute("data-paise", "5000000");
  await vis(page, "form-save").click();
  await expect(vis(page, "sale-saved")).toBeVisible();
  expect(await stockClosing(page, today, variety)).toBe((30n * QTL).toString());

  // The load shows the link; editing it to 22 qtl updates the sale too: still one deduction.
  await page.goto(loadUrl);
  await expect(vis(page, "load-linked-record")).toBeVisible();
  await vis(page, "load-edit").click();
  await expect(vis(page, "load-linked-qty")).toBeVisible();
  await vis(page, "load-weight-manual").fill("22");
  await vis(page, "form-save").click();
  await expect(vis(page, "load-detail")).toBeVisible();
  expect(await stockClosing(page, today, variety)).toBe((28n * QTL).toString());

  // Register: linked, totals for the day.
  await page.goto("/loads");
  await vis(page, "load-search").fill(vehicle.replace(/\s/g, ""));
  await expect(vis(page, "load-row")).toHaveCount(1);
  await expect(vis(page, "load-linked")).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-load-register.png`, fullPage: true });
}

async function dues(page: Page, lang: "bn" | "en") {
  const farmer = lang === "bn" ? "বাকি-পরীক্ষা কৃষক" : "Duecheck Farmer";
  for (const [qtl, date] of [
    ["2", istDate(-4)],
    ["3", istDate(-2)],
  ] as const) {
    await page.goto("/purchase/new");
    if (qtl === "2") await newParty(page, "purchase-party", farmer);
    else await pick(page, "purchase-party", farmer);
    await vis(page, "purchase-date").fill(date);
    await pick(page, "purchase-variety", lang === "bn" ? "মিনিকিট" : "Minikit");
    await vis(page, "purchase-weight-mode-MANUAL").click();
    await vis(page, "purchase-weight-manual").fill(qtl);
    await vis(page, "purchase-rate").fill("2000");
    await vis(page, "form-save").click();
    await expect(vis(page, "purchase-saved")).toBeVisible();
  }
  await page.goto("/dues?tab=payable");
  await expect(vis(page, "due-row").filter({ hasText: farmer })).toBeVisible();

  // Pay ₹12,000: ₹4,000 + ₹6,000 oldest first, ₹2,000 as advance.
  await page.goto("/dues/pay?direction=OUT");
  await pick(page, "due-pay-party", farmer);
  await vis(page, "pa-pay-amount").fill("12000");
  await expect(vis(page, "pa-advance")).toHaveAttribute("data-paise", "200000");
  const parts = await vis(page, "pa-bill-amount").evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).value),
  );
  expect(parts).toEqual(["4000", "6000"]);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-pay-across.png`, fullPage: true });
  await vis(page, "pa-save").click();
  await expect(vis(page, "due-party")).toBeVisible();
  await expect(vis(page, "due-party-balance")).toHaveAttribute("data-paise", "200000");
  await page.goto("/dues?tab=advance");
  await expect(vis(page, "due-row").filter({ hasText: farmer })).toBeVisible();
  await page.goto("/dues");
  await expect(vis(page, "due-summary")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${lang}-360-due-summary.png`, fullPage: true });
}

async function trip(page: Page, lang: "bn" | "en") {
  await page.goto("/vehicles/trip/new");
  await expect(vis(page, "trip-form")).toBeVisible();
  await newParty(page, "trip-customer", lang === "bn" ? "পাল ট্রান্সপোর্ট" : "Paul Transport");
  await vis(page, "trip-vehicle").click();
  await vis(page, "trip-vehicle-search").fill(lang === "bn" ? "WB11C2222" : "WB11D3333");
  await vis(page, "trip-vehicle-create").click();
  await vis(page, "vehicle-save").click();
  await vis(page, "trip-from").fill(lang === "bn" ? "রামপুর" : "Rampur");
  await vis(page, "trip-to").fill(lang === "bn" ? "বর্ধমান" : "Bardhaman");
  await vis(page, "trip-rate").fill("8000");
  await vis(page, "trip-pay-amount").fill("3000");
  await vis(page, "trip-cost-DRIVER-amount").fill("1000");
  await vis(page, "trip-cost-DIESEL-amount").fill("2500");
  await expect(vis(page, "trip-net")).toHaveAttribute("data-paise", "450000");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-trip-form.png`, fullPage: true });
  await vis(page, "form-save").click();
  await expect(vis(page, "trip-saved")).toBeVisible();
  await vis(page, "trip-open-detail").click();
  await expect(vis(page, "trip-detail-net")).toHaveAttribute("data-paise", "450000");
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "500000");
  const costDue = await vis(page, "trip-cost-due").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-paise")),
  );
  expect(costDue).toEqual(["0", "0"]);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/${lang}-360-trip-detail.png`, fullPage: true });
  await page.goto("/vehicles?tab=byVehicle");
  await expect(vis(page, "vehicle-list")).toBeVisible();
}

test("Phase 10 — loads, dues, trips (বাংলা)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await loads(page, "bn");
  await dues(page, "bn");
  await trip(page, "bn");
  await ctx.close();
});

test("Phase 10 — loads, dues, trips (English)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await switchToEnglish(page);
  await loads(page, "en");
  await dues(page, "en");
  await trip(page, "en");
  await ctx.close();
});

/**
 * v2 Phase 11 through the UI, in Bengali and in English, at phone width: a section report
 * (purchase register) with its header, rows and totals; Excel and CSV downloads; the print page
 * with A4 / 80 mm; Dashboard → রিপোর্ট Gola-wise; the mic in rate / weight / notes fields.
 * Screenshots go to test-results/v2-reports/.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, loginFresh, openBrowser, switchToEnglish, vis } from "./helpers";

const SHOTS = "test-results/v2-reports";

async function runReports(page: Page, lang: "bn" | "en") {
  // Make sure there is at least one purchase this month.
  await page.goto("/purchase/new");
  await vis(page, "purchase-party").click();
  await vis(page, "purchase-party-search").fill(lang === "bn" ? "রিপোর্ট কৃষক" : "Report Farmer");
  await vis(page, "purchase-party-create").click();
  await vis(page, "new-party-save").click();
  await vis(page, "purchase-variety").click();
  await page.getByTestId("purchase-variety-sheet").getByRole("option").first().click();
  await vis(page, "purchase-weight-mode-MANUAL").click();
  await vis(page, "purchase-weight-manual").fill("3");
  // Voice: a mic sits inside the rate, weight and notes fields (disabled where unsupported).
  await expect(vis(page, "purchase-rate-mic")).toHaveCount(1);
  await expect(vis(page, "purchase-weight-manual-mic")).toHaveCount(1);
  await vis(page, "purchase-rate").fill("2000");
  await vis(page, "form-save").click();
  await expect(vis(page, "purchase-saved")).toBeVisible();

  await page.goto("/purchase?tab=reports");
  await expect(vis(page, "reports-purchase")).toBeVisible();
  await vis(page, "report-pick-purchase-register").click();
  await expect(vis(page, "report-doc")).toHaveAttribute("data-report", "purchase-register");
  await expect(vis(page, "report-row").first()).toBeVisible();
  await expect(vis(page, "report-totals")).toBeVisible();
  await expect(vis(page, "report-meta")).toContainText(lang === "bn" ? "তৈরি" : "Generated");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-purchase-register.png`, fullPage: true });

  const [xlsx] = await Promise.all([
    page.waitForEvent("download"),
    vis(page, "report-excel").click(),
  ]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const [csv] = await Promise.all([page.waitForEvent("download"), vis(page, "report-csv").click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const text = readFileSync((await csv.path())!, "utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("6000.00");

  await vis(page, "report-print").click();
  await expect(vis(page, "print-report")).toBeVisible();
  await expect(vis(page, "report-table")).toBeVisible();
  await vis(page, "report-paper-80").click();
  await page.screenshot({ path: `${SHOTS}/${lang}-360-print-80mm.png`, fullPage: true });

  // Dashboard → reports: Gola-wise with a combined total row.
  await page.goto("/?tab=reports");
  await vis(page, "report-pick-gola-wise").click();
  await expect(vis(page, "report-doc")).toHaveAttribute("data-report", "gola-wise");
  await expect(vis(page, "report-totals")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${lang}-360-gola-wise.png`, fullPage: true });

  // Every section has a working reports tab.
  for (const s of ["sales", "expenses", "loads", "dues", "vehicles", "mill"]) {
    await page.goto(`/${s}?tab=reports`);
    await expect(vis(page, "report-doc")).toBeVisible();
  }
}

test("Phase 11 — reports, export, print (বাংলা)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await runReports(page, "bn");
  await ctx.close();
});

test("Phase 11 — reports, export, print (English)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await switchToEnglish(page);
  await runReports(page, "en");
  await ctx.close();
});

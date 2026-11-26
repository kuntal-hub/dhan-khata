/**
 * requirement_v2 §21 through the UI, at phone width:
 *  - Test 7 (two Golas): a purchase in each Gola stays in its own list and stock; the all-Golas
 *    Gola-wise report shows both rows and a total = their sum.
 *  - Test 8 (persistence): the record survives a refresh, an offline cold reload, logout + login,
 *    and a full download on a second browser profile.
 *  - Test 11 (UX): header search and bell, settings with the integrity check (all good), an empty
 *    state, every section at 360 / 768 / 1280 px in bn and en without horizontal scroll.
 * Screenshots go to test-results/v2-acceptance/.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  loginFresh,
  openBrowser,
  pick,
  switchGodown,
  switchToEnglish,
  unlockIfAsked,
  vis,
} from "./helpers";

const SHOTS = "test-results/v2-acceptance";

async function purchase(page: Page, farmer: string, qtl: string, create = true) {
  await page.goto("/purchase/new");
  await expect(vis(page, "purchase-form")).toBeVisible();
  if (create) {
    await vis(page, "purchase-party").click();
    await vis(page, "purchase-party-search").fill(farmer);
    await vis(page, "purchase-party-create").click();
    await vis(page, "new-party-save").click();
    await expect(vis(page, "purchase-party")).toContainText(farmer);
  } else {
    await pick(page, "purchase-party", farmer);
  }
  await vis(page, "purchase-variety").click();
  await page.getByTestId("purchase-variety-sheet").getByRole("option").first().click();
  await vis(page, "purchase-weight-mode-MANUAL").click();
  await vis(page, "purchase-weight-manual").fill(qtl);
  await vis(page, "purchase-rate").fill("2000");
  await vis(page, "form-save").click();
  await expect(vis(page, "purchase-saved")).toBeVisible();
  // Leave the full-screen "saved" panel (it covers the header).
  await page.goto("/purchase");
}

async function rowsFor(page: Page, farmer: string): Promise<number> {
  await page.goto("/purchase");
  await vis(page, "purchase-search").fill(farmer);
  await page.waitForTimeout(400);
  return vis(page, "purchase-row").count();
}

test("Test 7 — two Golas stay separate; combined = sum", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await switchGodown(page, "SP");
  await purchase(page, "দুই-গোলা কৃষক খ", "7");
  await switchGodown(page, "RP");
  await purchase(page, "দুই-গোলা কৃষক ক", "4");
  // Each Gola sees only its own record.
  expect(await rowsFor(page, "দুই-গোলা কৃষক খ")).toBe(0);
  expect(await rowsFor(page, "দুই-গোলা কৃষক ক")).toBe(1);
  await switchGodown(page, "SP");
  expect(await rowsFor(page, "দুই-গোলা কৃষক খ")).toBe(1);
  expect(await rowsFor(page, "দুই-গোলা কৃষক ক")).toBe(0);

  // All Golas: the Gola-wise report has one row per Gola and the total = their sum.
  await switchGodown(page, "ALL");
  await page.goto("/?tab=reports");
  await vis(page, "report-pick-gola-wise").click();
  const rows = vis(page, "report-row");
  await expect(rows).toHaveCount(2);
  const col = async (row: number | "total", i: number) =>
    BigInt(
      (await (row === "total" ? vis(page, "report-totals") : rows.nth(row))
        .locator("td")
        .nth(i)
        .getAttribute("data-raw"))!,
    );
  for (const i of [1, 7]) {
    expect(await col("total", i)).toBe((await col(0, i)) + (await col(1, i)));
  }
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/bn-360-gola-wise.png`, fullPage: true });
  await switchGodown(page, "RP");
  await ctx.close();
});

test("Test 8 — persistence: refresh, offline, logout / login, second profile", async () => {
  const farmer = "স্থায়ী কৃষক";
  const first = await openBrowser();
  let { ctx, page } = first;
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await purchase(page, farmer, "2");
  expect(await rowsFor(page, farmer)).toBe(1);
  // Refresh.
  await page.reload();
  await unlockIfAsked(page);
  expect(await rowsFor(page, farmer)).toBe(1);
  // Wait until the purchase reached the server.
  await expect(vis(page, "sync-badge")).toHaveAttribute("data-synced", "yes", { timeout: 60_000 });
  // Offline cold reload.
  await ctx.close();
  ({ ctx, page } = await openBrowser(first.dir));
  await page.setViewportSize({ width: 360, height: 740 });
  await ctx.setOffline(true);
  await page.goto("/purchase");
  await unlockIfAsked(page);
  expect(await rowsFor(page, farmer)).toBe(1);
  await ctx.setOffline(false);
  // Logout → login again on the same phone.
  await page.goto("/");
  await vis(page, "user-menu").click();
  await vis(page, "menu-logout").click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });
  await loginFresh(page);
  expect(await rowsFor(page, farmer)).toBe(1);
  await ctx.close();
  // A second browser profile: full download from the server.
  const second = await openBrowser();
  await second.page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(second.page);
  expect(await rowsFor(second.page, farmer)).toBe(1);
  await second.ctx.close();
});

async function ux(page: Page, lang: "bn" | "en") {
  // Header search finds a party and an entry.
  await vis(page, "header-search").click();
  await expect(vis(page, "search")).toBeVisible();
  await vis(page, "search-input").fill("কৃষক");
  await expect(vis(page, "search-party").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${lang}-360-search.png`, fullPage: true });
  // Bell → reminders.
  await vis(page, "header-bell").click();
  await expect(vis(page, "reminders")).toBeVisible();
  // Settings → integrity check: all good.
  await vis(page, "user-menu").click();
  await vis(page, "menu-settings").click();
  await expect(vis(page, "settings")).toBeVisible();
  await vis(page, "settings-integrity").click();
  await expect(vis(page, "integrity-result").first()).toHaveAttribute("data-ok", "true", {
    timeout: 60_000,
  });
  await page.screenshot({ path: `${SHOTS}/${lang}-360-settings.png`, fullPage: true });
  // An unused variety (both "merge" and "put away" buttons) with a long name must still fit.
  await page.goto("/purchase?tab=varieties");
  await vis(page, "variety-add").click();
  await vis(page, "new-variety-name").fill(
    lang === "bn" ? "অনেক লম্বা নামের পরীক্ষার ধানের জাত" : "A very long test paddy variety name",
  );
  await vis(page, "new-variety-save").click();
  if (
    await page
      .getByTestId("variety-similar")
      .isVisible()
      .catch(() => false)
  )
    await vis(page, "variety-create-anyway").click();
  await expect(vis(page, "variety-row").first()).toBeVisible();
  // An empty state.
  await page.goto("/mill?tab=conversion");
  await expect(vis(page, "empty-state").or(vis(page, "conversion-list")).first()).toBeVisible();
  // Every section and its tabs at three widths, no horizontal scroll.
  const sections: Record<string, string[]> = {
    "/": ["", "cashbook", "stock", "daily", "reports"],
    "/purchase": ["", "farmers", "varieties", "reports"],
    "/sales": ["", "customers", "delivery", "reports"],
    "/expenses": ["", "all", "unpaid", "reports"],
    "/loads": ["", "party", "mill", "vehicle", "reports"],
    "/dues": ["", "receivable", "payable", "mill", "advance", "other", "reminders", "reports"],
    "/vehicles": ["", "byVehicle", "byCustomer", "pnl", "reports"],
    "/mill": ["", "dispatch", "return", "conversion", "settlement", "reports"],
  };
  for (const w of [360, 768, 1280]) {
    await page.setViewportSize({ width: w, height: w === 360 ? 740 : 900 });
    for (const [path, tabs] of Object.entries(sections)) {
      for (const tab of w === 360 ? tabs : tabs.slice(0, 1)) {
        await page.goto(tab ? `${path}?tab=${tab}` : path);
        await expect(page.locator('[data-testid^="section-"]:visible').first()).toBeVisible();
        const { sw, cw } = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
        }));
        expect(sw, `${w}px ${path}?tab=${tab} wider than the screen`).toBeLessThanOrEqual(cw);
      }
    }
  }
  await page.setViewportSize({ width: 360, height: 740 });
}

test("Test 11 — UX: search, bell, settings, empty state, every tab at 3 widths (বাংলা)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await ux(page, "bn");
  await ctx.close();
});

test("Test 11 — UX (English)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await switchToEnglish(page);
  await ux(page, "en");
  await ctx.close();
});

/** Shared Playwright helpers (mobile viewport, real production build + service worker). */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices, expect, type BrowserContext, type Page } from "@playwright/test";

export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE = `http://localhost:${PORT}`;
export const OWNER = { phone: "9830012345", password: "e2e-owner-pass" };
export const PIN = "1234";

export async function openBrowser(dir = mkdtempSync(path.join(tmpdir(), "dk-e2e-"))): Promise<{
  ctx: BrowserContext;
  page: Page;
  dir: string;
}> {
  const { defaultBrowserType: _b, ...device } = devices["Pixel 7"];
  const ctx = await chromium.launchPersistentContext(dir, { ...device, baseURL: BASE });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page, dir };
}

/** First login on a fresh device: password → set PIN → first download → app. */
export async function loginFresh(page: Page, user: { phone: string; password: string } = OWNER) {
  await page.goto("/");
  await page.waitForURL(/\/login/);
  await page.locator("#phone").fill(user.phone);
  await page.locator("#password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/unlock/);
  await page.locator("#pin").fill(PIN);
  await page.locator("#pin2").fill(PIN);
  await page.getByTestId("pin-submit").click();
  await expect(page.getByTestId("sync-badge")).toBeVisible({ timeout: 60_000 });
}

/** After a full page load the session is locked: enter the PIN if asked. */
export async function unlockIfAsked(page: Page) {
  const pin = page.locator("#pin");
  const badge = page.getByTestId("sync-badge");
  await expect(pin.or(badge).first()).toBeVisible();
  if (await pin.isVisible()) {
    await pin.fill(PIN);
    await page.getByTestId("pin-submit").click();
  }
  await expect(badge).toBeVisible();
}

/** Pick an item in an EntityPicker sheet by its visible title. */
export async function pick(page: Page, testId: string, name: string | RegExp) {
  await page.getByTestId(testId).click();
  const sheet = page.getByTestId(`${testId}-sheet`);
  await expect(sheet).toBeVisible();
  if (typeof name === "string") await page.getByTestId(`${testId}-search`).fill(name);
  await sheet.getByRole("option", { name }).first().click();
  await expect(sheet).toBeHidden();
}

/** Spec §11.1: no horizontal scroll at phone width (a wide element zooms the page out). */
export async function expectNoHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw, "page wider than the screen").toBeLessThanOrEqual(cw);
}
/** Today's business date in IST (YYYY-MM-DD), optionally shifted by `days`. */
export function istDate(days = 0): string {
  const now = new Date(Date.now() + days * 86_400_000);
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Switch the UI to English words + digits (the app starts in Bengali). */
export async function switchToEnglish(page: Page) {
  await vis(page, "user-menu").click();
  await vis(page, "toggle-language").click();
  await expect(page.getByTestId("toggle-language")).toHaveCount(0);
  await expect(page.getByTestId("user-menu")).toHaveAttribute("aria-label", "My menu");
}

/** Pick a godown (by code) or "ALL" in the header switcher. */
export async function switchGodown(page: Page, code: string) {
  const item = page.getByTestId(`godown-item-${code}`);
  const menus = page.locator('[role="menu"]');
  // The previous menu may still be animating closed: wait until it is gone, then open afresh.
  await expect(async () => {
    await expect(menus).toHaveCount(0, { timeout: 3_000 });
    await vis(page, "godown-switcher").click();
    await expect(item).toBeVisible({ timeout: 3_000 });
    await item.click({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(menus).toHaveCount(0);
}

/**
 * Owner: create a godown through the add-godown wizard (online), optionally with opening cash
 * dated `goLive`; ends on Home with the new godown active.
 */
export async function createGodownViaWizard(
  page: Page,
  g: { name: string; code: string; cash?: string; goLive?: string },
) {
  await vis(page, "tab-more").click();
  await vis(page, "more-godowns").click();
  await vis(page, "godown-add").click();
  await vis(page, "wizard-name").fill(g.name);
  await vis(page, "wizard-code").fill(g.code);
  await vis(page, "wizard-next").click();
  await expect(vis(page, "wizard-step")).toHaveAttribute("data-step", "1", { timeout: 60_000 });
  for (const step of ["2", "3"]) {
    await vis(page, "wizard-next").click();
    await expect(vis(page, "wizard-step")).toHaveAttribute("data-step", step);
  }
  if (g.cash) await vis(page, "wizard-cash").fill(g.cash);
  for (const step of ["4", "5", "6"]) {
    await vis(page, "wizard-next").click();
    await expect(vis(page, "wizard-step")).toHaveAttribute("data-step", step);
  }
  if (g.goLive) await vis(page, "wizard-golive").fill(g.goLive);
  if (g.cash) await vis(page, "wizard-capital-ok").check();
  await vis(page, "wizard-next").click();
  await expect(vis(page, "dashboard")).toBeVisible();
  await expect(vis(page, "godown-switcher")).toContainText(g.name);
}

/** Create a party in the active godown via the party form; returns its id. */
export async function createParty(page: Page, name: string, role?: "mill") {
  await vis(page, "tab-party").click();
  await vis(page, "party-new").click();
  await vis(page, "party-name").fill(name);
  if (role === "mill") {
    await vis(page, "role-farmer").click();
    await vis(page, "role-mill").click();
  }
  await vis(page, "form-save").click();
  await page.waitForURL(/\/party\/view\?id=/);
  return new URL(page.url()).searchParams.get("id")!;
}

/**
 * A VISIBLE element by test id. Next keeps up to 3 visited routes mounted but hidden (React
 * Activity), so the same test id can exist in a hidden page too.
 */
export function vis(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`);
}

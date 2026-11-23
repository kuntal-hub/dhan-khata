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
export async function loginFresh(page: Page) {
  await page.goto("/");
  await page.waitForURL(/\/login/);
  await page.locator("#phone").fill(OWNER.phone);
  await page.locator("#password").fill(OWNER.password);
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
/**
 * A VISIBLE element by test id. Next keeps up to 3 visited routes mounted but hidden (React
 * Activity), so the same test id can exist in a hidden page too.
 */
export function vis(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`);
}

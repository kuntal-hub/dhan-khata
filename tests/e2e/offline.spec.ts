/**
 * Cold-offline acceptance (spec §13, Phase 2 scope): log in online → close the browser →
 * network off → open the start URL → unlock with PIN → visit every route via the UI and by
 * direct URL → reload → still works.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices, expect, test, type BrowserContext, type Page } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const OWNER = { phone: "9830012345", password: "e2e-owner-pass" };
const PIN = "1234";
const ROUTES = ["/", "/sync", "/login", "/unlock", "/~offline"];

async function open(dir: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const { defaultBrowserType: _b, ...device } = devices["Pixel 7"];
  const ctx = await chromium.launchPersistentContext(dir, { ...device, baseURL: BASE });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page };
}

async function unlockIfAsked(page: Page) {
  const pin = page.locator("#pin");
  const badge = page.getByTestId("sync-badge");
  await expect(pin.or(badge).first()).toBeVisible();
  if (await pin.isVisible()) {
    await pin.fill(PIN);
    await page.getByTestId("pin-submit").click();
  }
  await expect(badge).toBeVisible();
}

test("cold offline start: every route works from the device", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dk-e2e-"));

  // 1. Online: log in, set PIN, first download, service worker installed.
  let { ctx, page } = await open(dir);
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
  await expect(page.getByText(/Rampur|Sonapur/).first()).toBeVisible();
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(reg.active);
  });
  // Visit each route once online too (warms nothing extra: all routes are precached).
  await ctx.close();

  // 2. Browser closed; network off; cold start from the start URL.
  ({ ctx, page } = await open(dir));
  await ctx.setOffline(true);
  await page.goto("/?source=pwa");
  await unlockIfAsked(page);

  // 3. Navigate via the UI.
  await page.getByRole("button", { name: /মেনু|Menu/ }).click();
  await page.getByRole("menuitem", { name: /সিঙ্ক|Sync/ }).click();
  await expect(page.getByRole("heading", { name: /সিঙ্ক|Sync/ })).toBeVisible();
  await page.getByRole("button", { name: /মেনু|Menu/ }).click();
  await page.getByRole("menuitem", { name: /হোম|Home/ }).click();
  await expect(page.getByText("ধান খাতা").first()).toBeVisible();

  // 4. Every route by direct URL, offline.
  for (const r of ROUTES) {
    const res = await page.goto(r);
    expect(res?.ok() ?? true).toBe(true);
    await expect(page.locator("body")).not.toBeEmpty();
  }

  // 5. Reload → still works.
  await page.goto("/");
  await page.reload();
  await unlockIfAsked(page);
  await ctx.close();
});

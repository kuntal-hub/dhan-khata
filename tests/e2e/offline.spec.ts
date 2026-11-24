/**
 * Cold-offline acceptance (spec §13): log in online → close the browser → network off → open the
 * start URL → unlock with PIN → visit every route via the UI and by direct URL → reload → works.
 */
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, loginFresh, openBrowser, unlockIfAsked } from "./helpers";

/**
 * Every static app route. TRANSITIONAL (v2 Phase 2): the v1 screens were removed with the v1 data
 * model; the 8 v2 sections are added back to this list as they are built (Phases 4–11), and the
 * full offline entry flow returns with the Purchase / Expense / Load screens.
 */
const ROUTES = [
  "/",
  "/sync",
  "/login",
  "/unlock",
  "/~offline",
  "/register",
  "/forgot",
  "/profile",
  "/business",
  "/golas",
  "/golas/new",
  "/golas/edit?id=x",
  "/sessions",
];

test("cold offline start: every route works from the device", async () => {
  // 1. Online: log in, set PIN, first download, service worker installed.
  const first = await openBrowser();
  const dir = first.dir;
  let { ctx, page } = first;
  await loginFresh(page);
  await expect(page.getByTestId("godown-switcher")).toBeVisible();
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(reg.active);
  });
  await ctx.close();

  // 2. Browser closed; network off; cold start from the start URL.
  ({ ctx, page } = await openBrowser(dir));
  await ctx.setOffline(true);
  await page.goto("/?source=pwa");
  await unlockIfAsked(page);
  await expectNoHorizontalScroll(page);
  await expect(page.getByTestId("home")).toBeVisible();

  // 3. Every route by direct URL, offline: served by the service worker, never the fallback.
  for (const r of ROUTES) {
    const res = await page.goto(r);
    expect(res?.ok() ?? true, r).toBe(true);
    if (r !== "/~offline") {
      await expect(page.locator("body")).not.toBeEmpty();
      await expect(page.getByText(/ইন্টারনেট নেই|No internet/)).toHaveCount(0);
    }
  }

  // 4. Reload → still works.
  await page.goto("/");
  await page.reload();
  await unlockIfAsked(page);
  await expect(page.getByTestId("home")).toBeVisible();
  await ctx.close();
});

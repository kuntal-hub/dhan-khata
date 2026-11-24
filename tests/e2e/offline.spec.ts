/**
 * Cold-offline acceptance (spec §13): log in online → close the browser → network off → open the
 * start URL → unlock with PIN → visit every route via the UI and by direct URL → reload → works.
 */
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, loginFresh, openBrowser, unlockIfAsked } from "./helpers";

/** Every static app route (Phase 3 adds the trade screens, Phase 4 the daily-money screens). */
const ROUTES = [
  "/",
  "/sync",
  "/login",
  "/unlock",
  "/~offline",
  "/purchase",
  "/purchase/new",
  "/purchase/view?id=x",
  "/purchase/edit?id=x",
  "/sale",
  "/sale/new",
  "/sale/view?id=x",
  "/sale/edit?id=x",
  "/sale/settle?id=x",
  "/load",
  "/load/new",
  "/load/view?id=x",
  "/load/edit?id=x",
  "/payment/new?type=RECEIPT",
  "/payment/view?id=x",
  "/payment/edit?id=x",
  "/party",
  "/party/new",
  "/party/view?id=x",
  "/party/edit?id=x",
  "/due",
  "/more",
  "/settings",
  "/settings/masters?tab=banks",
  "/print/voucher?id=x",
  "/print/statement?partyId=x",
  // Phase 4
  "/expense",
  "/expense/new",
  "/expense/edit?id=x",
  "/voucher/view?id=x",
  "/cashbank",
  "/cashbank/entry?kind=CASH_DEPOSIT",
  "/day-close",
  "/vehicle",
  "/vehicle/view?id=x",
  "/trip/new",
  "/trip/edit?id=x",
  "/stock",
  "/stock/register?varietyId=x",
  "/stock/adjust",
  "/transfer",
  "/transfer/accept?id=x",
  "/godowns",
  "/godowns/new",
  "/godowns/edit?id=x",
  "/search",
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

  // 3. Navigate via the UI (bottom tabs + links), all client-side and offline.
  for (const tab of ["tab-purchase", "tab-sale", "tab-party", "tab-more", "tab-home"]) {
    await page.getByTestId(tab).click();
    await expect(page.getByTestId(tab)).toHaveAttribute("aria-current", "page");
  }
  await page.getByTestId("tab-party").click();
  await page.getByTestId("go-due").click();
  await page.waitForURL(/\/due/);
  await page.getByTestId("tab-sale").click();
  await page.getByTestId("go-load").click();
  await page.waitForURL(/\/load$/);
  await page.getByTestId("tab-home").click();
  await page.getByTestId("qa-purchase").click();
  await expect(page.getByTestId("purchase-form")).toBeVisible();

  // 4. Every route by direct URL, offline: served by the service worker, never the fallback.
  for (const r of ROUTES) {
    const res = await page.goto(r);
    expect(res?.ok() ?? true, r).toBe(true);
    if (r !== "/~offline") {
      await expect(page.locator("body")).not.toBeEmpty();
      await expect(page.getByText(/ইন্টারনেট নেই|No internet/)).toHaveCount(0);
    }
  }

  // 5. Reload → still works.
  await page.goto("/");
  await page.reload();
  await unlockIfAsked(page);
  await ctx.close();
});

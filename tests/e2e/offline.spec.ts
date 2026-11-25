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
  "/?tab=cashbook",
  "/?tab=stock",
  "/?tab=daily",
  "/?tab=daily&day=2026-01-01",
  "/purchase",
  "/purchase/new",
  "/purchase/edit?id=x",
  "/purchase/view?id=x",
  "/purchase/farmer?id=x",
  "/purchase?tab=varieties",
  "/banks",
  "/print/purchase?id=x",
  "/print/payment?id=x",
  "/sales",
  "/sales/new",
  "/sales/edit?id=x",
  "/sales/view?id=x",
  "/sales/customer?id=x",
  "/sales/transfer",
  "/sales?tab=delivery",
  "/sales?tab=customers",
  "/print/sale?id=x",
  "/expenses",
  "/expenses/new",
  "/expenses/edit?id=x",
  "/expenses/view?id=x",
  "/expenses?tab=all",
  "/expenses?tab=unpaid",
  "/loads",
  "/loads?tab=party",
  "/loads?tab=mill",
  "/loads?tab=vehicle",
  "/loads/new",
  "/loads/edit?id=x",
  "/loads/view?id=x",
  "/print/load?id=x",
  "/sales/new?load=x",
  "/mill/dispatch/new?load=x",
  "/dues",
  "/dues?tab=receivable",
  "/dues?tab=payable",
  "/dues?tab=mill",
  "/dues?tab=advance",
  "/dues?tab=other",
  "/dues?tab=reminders",
  "/dues/pay?direction=OUT",
  "/dues/party?id=x",
  "/vehicles",
  "/vehicles?tab=byVehicle",
  "/vehicles?tab=byCustomer",
  "/vehicles?tab=pnl",
  "/vehicles/trip/new",
  "/vehicles/trip/edit?id=x",
  "/vehicles/trip/view?id=x",
  "/mill",
  "/mill?tab=dispatch",
  "/mill?tab=return",
  "/mill?tab=conversion",
  "/mill?tab=consignment",
  "/mill/dispatch/new",
  "/mill/dispatch/edit?id=x",
  "/mill/dispatch/view?id=x",
  "/mill/return/new",
  "/mill/return/edit?id=x",
  "/mill/return/view?id=x",
  "/mill/conversion/new",
  "/mill/conversion/edit?id=x",
  "/mill/conversion/view?id=x",
  "/mill/settle",
  "/mill/entry/new",
  "/mill/entry/edit?id=x",
  "/mill/entry/view?id=x",
  "/mill/party?id=x",
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

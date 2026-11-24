/**
 * Cold-offline acceptance (spec §13): log in online → close the browser → network off → open the
 * start URL → unlock with PIN → visit every route via the UI and by direct URL → reload → works.
 */
import { expect, test } from "@playwright/test";
import {
  createGodownViaWizard,
  createParty,
  expectNoHorizontalScroll,
  loginFresh,
  openBrowser,
  pick,
  unlockIfAsked,
  vis,
} from "./helpers";

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
  // Phase 5
  "/reminders",
  "/reports",
  "/reports/view?r=dayBook",
  "/print/report?r=dayBook&from=2026-11-01&to=2026-11-24",
  "/settings/users",
  "/settings/app",
  "/settings/integrity",
  "/settings/backup",
  "/opening",
];

test("cold offline start: every route works from the device", async () => {
  // 1. Online: log in, set PIN, first download, service worker installed.
  const first = await openBrowser();
  const dir = first.dir;
  let { ctx, page } = first;
  await loginFresh(page);
  await expect(page.getByTestId("godown-switcher")).toBeVisible();
  // A godown of its own for the offline entries (godown creation needs the internet).
  await createGodownViaWizard(page, { name: "Offline Test", code: "OFL" });
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

  // 6. §13: create a purchase, payment, load and expense OFFLINE → reload → data still there.
  await expect(vis(page, "godown-switcher")).toContainText("Offline Test");
  await createParty(page, "Offline Farmer");
  await createParty(page, "Offline Seller");
  await createParty(page, "Offline Mill", "mill");
  await vis(page, "tab-home").click();
  await vis(page, "qa-purchase").click();
  await pick(page, "purchase-party", "Offline Farmer");
  await pick(page, "line-0-variety", /^স্বর্ণ$/);
  await vis(page, "line-0-gross").fill("800");
  await vis(page, "line-0-rate").fill("2050");
  await vis(page, "form-save").click();
  await page.waitForURL(/\/purchase\/view\?id=/);
  await vis(page, "tab-home").click();
  await vis(page, "qa-payment").click();
  await pick(page, "money-party", "Offline Farmer");
  await vis(page, "money-amount").fill("7000");
  await vis(page, "form-save").click();
  await page.waitForURL(/\/payment\/view\?id=/);
  await vis(page, "tab-home").click();
  await vis(page, "qa-load").click();
  await pick(page, "load-seller", "Offline Seller");
  await pick(page, "load-mill", "Offline Mill");
  await vis(page, "load-vehicle").fill("WB11CD2222");
  await pick(page, "load-variety", /^স্বর্ণ$/);
  await vis(page, "load-gross").fill("1500");
  await vis(page, "load-sell-rate").fill("2000");
  await vis(page, "load-mill-rate").fill("2250");
  await vis(page, "form-save").click();
  await page.waitForURL(/\/load\/view\?id=/);
  await vis(page, "tab-home").click();
  await vis(page, "qa-expense").click();
  await pick(page, "expense-category", "লেবার");
  await vis(page, "expense-amount").fill("650");
  await vis(page, "expense-description").fill("offline labour");
  await vis(page, "form-save").click();
  await page.waitForURL(/\/voucher\/view\?id=/);
  await page.goto("/");
  await page.reload();
  await unlockIfAsked(page);
  // purchase, payment, load + its purchase and sale, expense
  await expect(page.locator('[data-testid="voucher-row"]:visible')).toHaveCount(6);

  // 7. Network back → the outbox drains → server ledger totals identical to the device.
  await ctx.setOffline(false);
  await page.goto("/sync");
  await unlockIfAsked(page);
  await expect(async () => {
    await vis(page, "sync-now").click();
    await expect(vis(page, "sync-now")).toHaveAttribute("data-pending", "0", { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.goto("/settings/integrity");
  await unlockIfAsked(page);
  await vis(page, "integrity-server").click();
  await expect(vis(page, "integrity-server-ok")).toBeVisible({ timeout: 30_000 });
  await expect(vis(page, "integrity-trial")).toHaveAttribute("data-ok", "true");
  await expect(vis(page, "integrity-repost")).toHaveAttribute("data-ok", "true");
  await ctx.close();
});

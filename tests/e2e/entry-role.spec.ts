/**
 * `entry` role view restriction (spec §2, [CONFIRM] #8): field staff see only their own entries
 * and today's dashboard. The owner records a purchase in Rampur and syncs; the seeded entry
 * user (entry in Rampur only) logs in on another phone and must not see it, while their own
 * purchase shows up in their lists. Blocked screens show the "entry role" notice.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  ENTRY,
  createParty,
  loginFresh,
  openBrowser,
  pick,
  switchGodown,
  unlockIfAsked,
  vis,
} from "./helpers";

const FARMER = "ER Farmer";

async function newPurchase(page: Page, grossKg: string, rate: string): Promise<string> {
  await vis(page, "tab-home").click();
  await vis(page, "qa-purchase").click();
  await pick(page, "purchase-party", FARMER);
  await pick(page, "line-0-variety", /^স্বর্ণ$/);
  await vis(page, "line-0-gross").fill(grossKg);
  await vis(page, "line-0-rate").fill(rate);
  await vis(page, "form-save").click();
  await page.waitForURL(/\/purchase\/view\?id=/);
  return new URL(page.url()).searchParams.get("id")!;
}

async function drain(page: Page) {
  await page.goto("/sync");
  await unlockIfAsked(page);
  await expect(async () => {
    await vis(page, "sync-now").click();
    await expect(vis(page, "sync-now")).toHaveAttribute("data-pending", "0", { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

async function expectBlocked(page: Page, url: string) {
  await page.goto(url);
  // Print pages have no app chrome (no sync badge); the tab is already unlocked.
  if (!url.startsWith("/print/")) await unlockIfAsked(page);
  await expect(vis(page, "notice-entryRole")).toBeVisible();
}

test("entry role sees only its own entries and today's dashboard", async () => {
  // Owner: a purchase in Rampur, synced to the server.
  const owner = await openBrowser();
  await loginFresh(owner.page);
  await switchGodown(owner.page, "RP");
  await createParty(owner.page, FARMER);
  const ownersPurchase = await newPurchase(owner.page, "1000", "2000");
  await drain(owner.page);
  await owner.ctx.close();

  // Entry user on another phone: Rampur only, entry role.
  const { ctx, page } = await openBrowser();
  await loginFresh(page, ENTRY);
  await expect(vis(page, "godown-switcher")).toContainText("Rampur");
  await expect(vis(page, "dashboard")).toBeVisible();

  // Reduced navigation: no khata tab, sale/load tab opens loads, no search / reminders.
  await expect(vis(page, "tab-party")).toHaveCount(0);
  await expect(vis(page, "tab-load")).toBeVisible();
  await expect(vis(page, "header-search")).toHaveCount(0);
  await expect(vis(page, "header-reminders")).toHaveCount(0);
  // Only the entries this role may create.
  await expect(vis(page, "qa-purchase")).toBeVisible();
  await expect(vis(page, "qa-load")).toBeVisible();
  await expect(vis(page, "qa-expense")).toBeVisible();
  await expect(vis(page, "qa-sale")).toHaveCount(0);
  await expect(vis(page, "qa-payment")).toHaveCount(0);
  await expect(vis(page, "qa-trip")).toHaveCount(0);
  // Today's dashboard only: no ◀ ▶, no reminders; the owner's purchase is not listed.
  await expect(vis(page, "dash-date-prev")).toHaveCount(0);
  await expect(vis(page, "dash-reminders")).toHaveCount(0);
  await expect(page.locator('[data-testid="voucher-row"]:visible')).toHaveCount(0);

  // Someone else's voucher and the godown-wide screens are blocked, even by direct URL.
  await expectBlocked(page, `/purchase/view?id=${ownersPurchase}`);
  await expectBlocked(page, `/purchase/edit?id=${ownersPurchase}`);
  await expectBlocked(page, `/print/voucher?id=${ownersPurchase}`);
  for (const url of ["/party", "/sale", "/due", "/cashbank", "/stock", "/reports", "/search"]) {
    await expectBlocked(page, url);
  }

  // Own purchase: visible in the list, on today's dashboard and in its view.
  await page.goto("/");
  await unlockIfAsked(page);
  const mine = await newPurchase(page, "500", "2100");
  await expect(vis(page, "voucher-view")).toBeVisible();
  await vis(page, "tab-purchase").click();
  await expect(page.locator('[data-testid="voucher-row"]:visible')).toHaveCount(1);
  await vis(page, "tab-home").click();
  await expect(vis(page, "today-list").locator('[data-testid="voucher-row"]')).toHaveCount(1);
  await page.goto(`/purchase/view?id=${mine}`);
  await unlockIfAsked(page);
  await expect(vis(page, "voucher-view")).toBeVisible();

  // "আরও" lists only what the role can open.
  await vis(page, "tab-more").click();
  await expect(vis(page, "more-expense")).toBeVisible();
  await expect(vis(page, "more-sync")).toBeVisible();
  for (const id of ["more-reports", "more-due", "more-cashbank", "more-stock", "more-search"]) {
    await expect(vis(page, id)).toHaveCount(0);
  }
  await ctx.close();
});

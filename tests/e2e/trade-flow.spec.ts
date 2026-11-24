/**
 * Trade flow e2e (Phase 3 §K), run in BOTH languages (each in its own godown so books don't mix):
 * purchase (paid-now) → payment → load (OWN_TRADE) → store sale → mill receipt in cash via the
 * driver → mill settlement. Asserts party balances, cash and shortage against hand-computed
 * values; both runs must show the SAME numbers (data-paise / data-grams).
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

const RUNS = [
  { lang: "bn", godown: "Rampur", code: "RP", variety: /^স্বর্ণ$/ },
  { lang: "en", godown: "Sonapur", code: "SP", variety: /^Swarna$/ },
] as const;

async function goHome(page: Page) {
  await vis(page, "tab-home").click();
  await expect(vis(page, "quick-actions")).toBeVisible();
  await expectNoHorizontalScroll(page);
}

async function newParty(page: Page, name: string, mill = false): Promise<string> {
  await vis(page, "tab-party").click();
  await vis(page, "party-new").click();
  await vis(page, "party-name").fill(name);
  if (mill) {
    await vis(page, "role-farmer").click();
    await vis(page, "role-mill").click();
  }
  await vis(page, "form-save").click();
  await page.waitForURL(/\/party\/view\?id=/);
  return new URL(page.url()).searchParams.get("id")!;
}

/** Open a party's profile and wait until its balance equals `paise` (auto-retrying). */
async function expectBalance(page: Page, partyId: string, name: string, paise: string) {
  await vis(page, "tab-party").click();
  await page.locator(`a[href="/party/view?id=${partyId}"]:visible`).first().click();
  await expect(vis(page, "party-title")).toHaveText(name);
  await expect(vis(page, "party-balance")).toHaveAttribute("data-paise", paise);
}

for (const run of RUNS) {
  test(`trade flow in ${run.lang}`, async () => {
    const { ctx, page } = await openBrowser();
    await loginFresh(page);

    if (run.lang === "en") await switchToEnglish(page);
    // Work in this run's own godown.
    await switchGodown(page, run.code);
    await expect(vis(page, "godown-switcher")).toContainText(run.godown);

    const F = `${run.lang} Farmer One`;
    const F2 = `${run.lang} Farmer Two`;
    const M = `${run.lang} Durga Mill`;
    const fId = await newParty(page, F);
    const f2Id = await newParty(page, F2);
    const mId = await newParty(page, M, true);

    // 1. Purchase 1,000 kg @ ₹2,000/qtl = ₹20,000, ₹5,000 paid now in cash.
    await goHome(page);
    await vis(page, "qa-purchase").click();
    await pick(page, "purchase-party", F);
    await pick(page, "line-0-variety", run.variety);
    await vis(page, "line-0-gross").fill("1000");
    await vis(page, "line-0-rate").fill("2000");
    await expect(vis(page, "purchase-total")).toContainText(
      run.lang === "bn" ? "২০,০০০" : "20,000",
    );
    await expectNoHorizontalScroll(page);
    await vis(page, "purchase-paid").fill("5000");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/purchase\/view\?id=/);

    // 2. Payment ₹3,000 cash.
    await goHome(page);
    await vis(page, "qa-payment").click();
    await pick(page, "money-party", F);
    await vis(page, "money-amount").fill("3000");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/payment\/view\?id=/);

    // 3. Load (OWN_TRADE): F2 → mill, 2,000 kg, party sell ₹2,100, mill ₹2,300.
    await goHome(page);
    await vis(page, "qa-load").click();
    await pick(page, "load-seller", F2);
    await pick(page, "load-mill", M);
    await vis(page, "load-vehicle").fill("WB12AB3456");
    await pick(page, "load-variety", run.variety);
    await vis(page, "load-gross").fill("2000");
    await vis(page, "load-sell-rate").fill("2100");
    await vis(page, "load-mill-rate").fill("2300");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/load\/view\?id=/);
    const loadUrl = page.url();

    // 4. Store sale 500 kg @ ₹2,400 = ₹12,000.
    await goHome(page);
    await vis(page, "qa-sale").click();
    await pick(page, "sale-party", M);
    await pick(page, "line-0-variety", run.variety);
    await vis(page, "line-0-gross").fill("500");
    await vis(page, "line-0-rate").fill("2400");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/sale\/view\?id=/);

    // 5. Mill sends ₹40,000 cash with the truck driver.
    await goHome(page);
    await vis(page, "qa-receipt").click();
    await pick(page, "money-party", M);
    await vis(page, "money-amount").fill("40000");
    await vis(page, "money-via").fill("WB12AB3456");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/payment\/view\?id=/);

    // 6. Mill settlement on the load's sale: mill received 1,990 kg at ₹2,300 → −₹230, 10 kg short.
    await page.goto(loadUrl.replace(/^https?:\/\/[^/]+/, ""));
    await unlockIfAsked(page);
    await page.getByRole("link", { name: /SAL-/ }).click();
    await page.waitForURL(/\/sale\/view\?id=/);
    await vis(page, "sale-settle").click();
    await vis(page, "settle-gross").fill("1990");
    await vis(page, "form-save").click();
    await page.waitForURL(/\/sale\/view\?id=/);
    await expect(vis(page, "view-shortage")).toHaveAttribute("data-grams", "10000");
    await expect(vis(page, "view-settlement-status")).toBeVisible();

    // Hand-computed: F −₹12,000; F2 −₹42,000; M +₹46,000 + ₹12,000 − ₹40,000 − ₹230 = ₹17,770;
    // cash −₹5,000 − ₹3,000 + ₹40,000 = ₹32,000.
    await expectBalance(page, fId, F, "-1200000");
    await expectBalance(page, f2Id, F2, "-4200000");
    await expectBalance(page, mId, M, "1777000");
    await goHome(page);
    await expect(vis(page, "home-cash")).toHaveAttribute("data-paise", "3200000");
    await ctx.close();
  });
}

/**
 * Two-godown e2e (G10, Phase 4 §J): enter data in godown A, switch to B and verify B is
 * unchanged, then check the owner's read-only All-godowns table: per-godown columns, a total
 * column equal to the sum of the columns, no quick actions, and tapping a column switches godown.
 */
import { expect, test } from "@playwright/test";
import {
  createGodownViaWizard,
  expectNoHorizontalScroll,
  loginFresh,
  openBrowser,
  pick,
  switchGodown,
  vis,
} from "./helpers";

test("G10: godown A never changes B; All-godowns totals = Σ godowns", async () => {
  const { ctx, page } = await openBrowser();
  await loginFresh(page);
  await createGodownViaWizard(page, { name: "Alpha", code: "TA" });
  await createGodownViaWizard(page, { name: "Beta", code: "TB" });

  // B's dashboard before anything happens in A.
  await expect(vis(page, "home-cash")).toHaveAttribute("data-paise", "0");

  // Data in A: owner's capital ₹10,000 in cash, labour ₹500.
  await switchGodown(page, "TA");
  await expect(vis(page, "godown-switcher")).toContainText("Alpha");
  await vis(page, "tab-more").click();
  await vis(page, "more-cashbank").click();
  await vis(page, "contra-CAPITAL_IN").click();
  await vis(page, "contra-amount").fill("10000");
  await vis(page, "form-save").click();
  await page.waitForURL(/\/voucher\/view\?id=/);
  await vis(page, "tab-home").click();
  await vis(page, "qa-expense").click();
  await pick(page, "expense-category", "লেবার");
  await vis(page, "expense-amount").fill("500");
  await vis(page, "expense-description").fill("unloading");
  await vis(page, "form-save").click();
  await page.waitForURL(/\/voucher\/view\?id=/);
  await vis(page, "tab-home").click();
  await expect(vis(page, "home-cash")).toHaveAttribute("data-paise", "950000");

  // B is unchanged.
  await switchGodown(page, "TB");
  await expect(vis(page, "godown-switcher")).toContainText("Beta");
  await expect(vis(page, "home-cash")).toHaveAttribute("data-paise", "0");
  await expect(vis(page, "dash-expense-value")).toHaveAttribute("data-paise", "0");
  await expect(page.locator('[data-testid="voucher-row"]:visible')).toHaveCount(0);

  // Owner's All-godowns view: read-only table, totals are the sum of the columns.
  await switchGodown(page, "ALL");
  await expect(vis(page, "consolidated")).toBeVisible();
  await expect(vis(page, "quick-actions")).toHaveCount(0);
  await expect(vis(page, "fab")).toHaveCount(0);
  await expect(vis(page, "cell-cashPaise-TA")).toHaveAttribute("data-value", "950000");
  await expect(vis(page, "cell-cashPaise-TB")).toHaveAttribute("data-value", "0");
  await expect(vis(page, "cell-expensePaise-TA")).toHaveAttribute("data-value", "50000");
  for (const key of ["cashPaise", "expensePaise", "receivablePaise", "payablePaise"]) {
    const values = await page
      .locator(`[data-testid^="cell-${key}-"]:visible`)
      .evaluateAll((els) =>
        els.map((e) => ({ id: e.getAttribute("data-testid")!, v: e.getAttribute("data-value")! })),
      );
    const total = values.find((x) => x.id.endsWith("-TOTAL"))!;
    const sum = values
      .filter((x) => !x.id.endsWith("-TOTAL"))
      .reduce((s, x) => s + BigInt(x.v), 0n);
    expect(BigInt(total.v), key).toBe(sum);
  }
  await expectNoHorizontalScroll(page);

  // Tapping a godown column opens that godown.
  await vis(page, "consolidated-col-TA").click();
  await expect(vis(page, "dashboard")).toBeVisible();
  await expect(vis(page, "godown-switcher")).toContainText("Alpha");
  await expect(vis(page, "home-cash")).toHaveAttribute("data-paise", "950000");
  await ctx.close();
});

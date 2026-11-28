/**
 * Purchase vehicle fare & owner ledger (DECISIONS D56) on a 360 px phone, in English:
 *  - ₹12,800 purchase + ₹300 toto fare (owner created inline) → farmer payable ₹12,500;
 *  - the same owner picked with one tap on two more farmers' purchases (₹250, ₹350);
 *  - Purchase → Vehicle fare tab → owner ledger: earned ₹900; pay ₹500 later → outstanding ₹400;
 *  - no sideways scroll on the form, the tab or the ledger.
 * Screenshots for the visual review go to test-results/v2-fare/.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  istDate,
  loginFresh,
  openBrowser,
  pick,
  switchToEnglish,
  vis,
} from "./helpers";

const SHOTS = "test-results/v2-fare";
const D1 = istDate(-3);

type Lang = "bn" | "en";
const L = {
  bn: {
    owner: "বাপি টোটো",
    phone: "9830012345",
    farmers: ["কৃষক রহিম", "কৃষক করিম", "কৃষক সুবল"],
    variety: "স্বর্ণ (MTU-7029)",
    net: "১২,৫০০",
    due900: "৯০০",
    jobs: "৩",
    note: "কিছুটা দিলাম",
  },
  en: {
    owner: "Bapi Toto",
    phone: "9830054321",
    farmers: ["Farmer A", "Farmer B", "Farmer C"],
    variety: "Swarna (MTU-7029)",
    net: "12,500",
    due900: "900",
    jobs: "3",
    note: "part payment",
  },
} as const;

async function purchase(page: Page, lang: Lang, farmer: string, fare: string, newOwner: boolean) {
  const OWNER = L[lang].owner;
  await page.goto("/purchase/new");
  await expect(vis(page, "purchase-form")).toBeVisible();
  await vis(page, "purchase-party").click();
  await vis(page, "purchase-party-search").fill(farmer);
  await vis(page, "purchase-party-create").click();
  await vis(page, "new-party-save").click();
  await expect(vis(page, "purchase-party")).toContainText(farmer);
  await vis(page, "purchase-date").fill(D1);
  await pick(page, "purchase-variety", L[lang].variety);
  await vis(page, "purchase-weight-mode-MANUAL").click();
  await vis(page, "purchase-weight-manual").fill("5.12");
  await vis(page, "purchase-rate").fill("2500");
  await expect(vis(page, "purchase-total")).toHaveAttribute("data-paise", "1280000");

  await vis(page, "fare-toggle-ON").click();
  if (newOwner) {
    await vis(page, "fare-owner").click();
    await vis(page, "fare-owner-search").fill(OWNER);
    await vis(page, "fare-owner-create").click();
    await expect(vis(page, "owner-name")).toHaveValue(OWNER);
    await vis(page, "owner-phone").fill(L[lang].phone);
    await vis(page, "owner-save").click();
  } else {
    // Saved owner: one tap, no typing the name again.
    await pick(page, "fare-owner", OWNER);
  }
  await expect(vis(page, "fare-owner")).toContainText(OWNER);
  await vis(page, "fare-kind-TOTO").click();
  await vis(page, "fare-amount").fill(fare);
}

async function runFare(page: Page, lang: Lang) {
  const t = L[lang];
  // 1–3: ₹12,800 − ₹300 = ₹12,500 for the farmer; ₹300 for the toto owner.
  await purchase(page, lang, t.farmers[0], "300", true);
  await expect(vis(page, "fare-farmer-net")).toHaveAttribute("data-paise", "1250000");
  await expect(vis(page, "purchase-due")).toContainText(t.net);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-purchase-fare.png`, fullPage: true });
  await vis(page, "form-save").click();
  await expect(vis(page, "purchase-saved")).toBeVisible();
  await vis(page, "purchase-open-detail").click();
  await expect(vis(page, "detail-due")).toHaveAttribute("data-paise", "1250000");
  await expect(vis(page, "detail-farmer-net")).toHaveAttribute("data-paise", "1250000");
  await expect(vis(page, "detail-fare-due")).toHaveAttribute("data-paise", "30000");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-purchase-detail.png`, fullPage: true });

  // 4–5: the same owner on two more farmers' purchases.
  await purchase(page, lang, t.farmers[1], "250", false);
  await vis(page, "form-save").click();
  await expect(vis(page, "purchase-saved")).toBeVisible();
  await purchase(page, lang, t.farmers[2], "350", false);
  await vis(page, "form-save").click();
  await expect(vis(page, "purchase-saved")).toBeVisible();

  // The Vehicle fare tab inside Purchase, then the owner's ledger.
  await page.goto("/purchase?tab=fares");
  await expect(vis(page, "fare-owners")).toBeVisible();
  // By mobile: the search is cross-script ("Bapi" also finds "বাপি").
  await vis(page, "fare-owner-search").fill(t.phone);
  await expect(vis(page, "fare-owner-row")).toHaveCount(1);
  await expect(vis(page, "fare-totals-due")).toContainText(t.due900);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-fare-tab.png`, fullPage: true });
  await vis(page, "fare-owner-row").filter({ hasText: t.owner }).click();
  await expect(vis(page, "owner-ledger")).toBeVisible();
  await expect(vis(page, "owner-jobs")).toContainText(t.jobs);
  await expect(vis(page, "owner-earned")).toHaveAttribute("data-paise", "90000");
  await expect(vis(page, "owner-outstanding")).toHaveAttribute("data-paise", "90000");
  await expect(vis(page, "owner-delivery")).toHaveCount(3);

  // 6: pay ₹500 later (backdated) → outstanding ₹400.
  await vis(page, "owner-pay").click();
  await expect(vis(page, "pay-owner")).toBeVisible();
  await vis(page, "owner-pay-amount").fill("500");
  await vis(page, "owner-pay-date").fill(istDate(-1));
  await vis(page, "owner-pay-note").fill(t.note);
  await vis(page, "owner-pay-save").click();
  await expect(page.getByTestId("pay-owner")).toHaveCount(0);
  await expect(vis(page, "owner-paid")).toHaveAttribute("data-paise", "50000");
  await expect(vis(page, "owner-outstanding")).toHaveAttribute("data-paise", "40000");
  await expect(vis(page, "owner-payment")).toHaveCount(1);
  await expect(vis(page, "owner-payment")).toContainText(t.note);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${lang}-360-owner-ledger.png`, fullPage: true });

  // Survives a refresh.
  await page.reload();
  await expect(vis(page, "owner-outstanding")).toHaveAttribute("data-paise", "40000");
}

test("vehicle fare: farmer net, owner ledger, pay later (বাংলা, 360 px)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await runFare(page, "bn");
  await ctx.close();
});

test("vehicle fare: farmer net, owner ledger, pay later (English, 360 px)", async () => {
  const { ctx, page } = await openBrowser();
  await page.setViewportSize({ width: 360, height: 740 });
  await loginFresh(page);
  await switchToEnglish(page);
  await runFare(page, "en");
  await ctx.close();
});

/**
 * Lighthouse mobile audit of Home (spec §13, §15): Performance ≥ 85 and the app installable.
 * Run after `pnpm build`:   pnpm lighthouse
 *
 * Boots the e2e server (in-memory MongoDB + `next start` on :3100), logs in with Playwright's
 * Chromium, then audits "/" in that SAME tab (the PIN unlock is per tab, so a fresh tab would
 * show the unlock screen) using Lighthouse's default mobile emulation (slow 4G, 4× CPU).
 * Installability is read from Chrome itself (Lighthouse ≥ 12 no longer has a PWA category).
 * Exit code 1 when a budget fails. The HTML report is written to the OS temp folder.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices } from "@playwright/test";
import { startFlow } from "lighthouse";
import puppeteer from "puppeteer-core";
import { BASE, loginFresh } from "../tests/e2e/helpers";

const PERF_BUDGET = 85;
const CDP_PORT = 9333;

function stopTree(child: ChildProcess) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {
      // already gone
    }
  } else child.kill("SIGTERM");
}

async function waitForHealth(timeoutMs = 240_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("e2e server did not start");
}

async function main() {
  const require = createRequire(import.meta.url);
  const server = spawn(process.execPath, [require.resolve("tsx/cli"), "tests/e2e/server.ts"], {
    stdio: "ignore",
  });
  let failed = false;
  try {
    await waitForHealth();
    const { defaultBrowserType: _b, ...device } = devices["Pixel 7"];
    const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "dk-lh-")), {
      ...device,
      baseURL: BASE,
      args: [`--remote-debugging-port=${CDP_PORT}`],
    });
    try {
      const pwPage = ctx.pages()[0] ?? (await ctx.newPage());
      await loginFresh(pwPage);

      const browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${CDP_PORT}`,
        defaultViewport: null,
      });
      const pages = await browser.pages();
      const page = pages.find((p) => p.url().startsWith(BASE));
      if (!page) throw new Error("logged-in tab not found");

      // Installability as Chrome sees it (manifest, icons, service worker).
      const cdp = await page.createCDPSession();
      const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
        installabilityErrors: { errorId: string }[];
      };

      const flow = await startFlow(page, {
        flags: {
          disableStorageReset: true, // keep the device database + unlocked session
          onlyCategories: ["performance", "accessibility", "best-practices"],
        },
      });
      await flow.navigate(`${BASE}/`);
      const result = await flow.createFlowResult();
      const lhr = result.steps[0]!.lhr;
      const score = (k: string) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
      const perf = score("performance");
      const report = path.join(mkdtempSync(path.join(tmpdir(), "dk-lh-report-")), "home.html");
      writeFileSync(report, await flow.generateReport());

      console.log(
        `Home (mobile): Performance ${perf} · Accessibility ${score("accessibility")} · Best practices ${score("best-practices")}`,
      );
      for (const id of [
        "first-contentful-paint",
        "largest-contentful-paint",
        "total-blocking-time",
        "cumulative-layout-shift",
        "speed-index",
      ]) {
        console.log(`  ${lhr.audits[id]?.title}: ${lhr.audits[id]?.displayValue}`);
      }
      console.log(
        `Installable: ${installabilityErrors.length === 0 ? "yes" : `NO (${installabilityErrors.map((e) => e.errorId).join(", ")})`}`,
      );
      console.log(`Report: ${report}`);
      if (perf < PERF_BUDGET) {
        console.error(`Performance ${perf} < ${PERF_BUDGET}`);
        failed = true;
      }
      if (installabilityErrors.length > 0) failed = true;
      await browser.disconnect();
    } finally {
      await ctx.close();
    }
  } finally {
    stopTree(server);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

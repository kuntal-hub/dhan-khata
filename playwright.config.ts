import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * E2E (spec §19.1): mobile viewport, against the PRODUCTION build (`pnpm build` first) so the
 * service worker is real. The web server boots an in-memory MongoDB and seeds an owner.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Visual snapshots: a missing baseline (new platform / first run) is written, never a failure.
  updateSnapshots: "missing",
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm exec tsx tests/e2e/server.ts",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});

import { defineConfig } from "@playwright/test";

/**
 * E2E for the AI Visibility Tracker. Expects a running SEOOS (`next start`)
 * at E2E_BASE_URL backed by a NON-PRODUCTION store (Firestore emulator), e.g.:
 *   firebase emulators:start --only firestore
 *   next build && next start -p 3100
 *   E2E_BASE_URL=http://localhost:3100 E2E_PROVIDER=anthropic npm run test:aiv:e2e -w apps/seoos
 * Never point this at production: it creates users, clients and scans.
 */
export default defineConfig({
  testDir: ".",
  timeout: 25 * 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "../.e2e-results/aiv-e2e.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3100",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  outputDir: "../.e2e-results/artifacts",
});

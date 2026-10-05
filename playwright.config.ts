import { defineConfig } from "@playwright/test";

const gateOwnsWorker = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1";
const reuseLocalWorker = process.env.PLAYWRIGHT_REUSE_SERVER === "1";
if (process.env.CI && reuseLocalWorker) throw new Error("CI must use a newly owned production Worker, not an existing server.");

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "outputs/playwright-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: process.env.CI ? 2 : 2,
  timeout: 60000,
  expect: { timeout: 12000 },
  reporter: [["list"], ["json", { outputFile: "outputs/browser-release.json" }]],
  metadata: {
    target: "Exact built production Worker on local port 4185",
    reflow: "200%/400% viewport-equivalent reflow, not actual browser or OS zoom",
    textEnlargement: "Separate 200% computed text enlargement at 1280 CSS pixels",
    forcedColours: "Chromium forced-colours media emulation, not physical Windows high-contrast or screen-reader certification",
    workerOwnership: gateOwnsWorker ? "Release-gate owned production Worker" : "Playwright webServer owned production Worker",
  },
  use: {
    baseURL: "http://127.0.0.1:4185",
    browserName: "chromium",
    headless: true,
    hasTouch: true,
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 12000,
  },
  projects: [
    { name: "phone-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 900 } } },
    { name: "viewport-reflow-200-equivalent", use: { viewport: { width: 640, height: 900 } } },
    { name: "viewport-reflow-400-equivalent", use: { viewport: { width: 320, height: 900 } } },
    { name: "text-200-at-1280", use: { viewport: { width: 1280, height: 900 } } },
    { name: "forced-colours-390", use: { viewport: { width: 390, height: 844 }, forcedColors: "active" } },
  ],
  webServer: gateOwnsWorker ? undefined : {
    command: "pnpm exec wrangler dev --config dist/server/wrangler.json --port 4185 --local --var DASHBOARD_DATA_URL:http://127.0.0.1:9/dashboard.json",
    url: "http://127.0.0.1:4185",
    reuseExistingServer: reuseLocalWorker,
    timeout: 120000,
    env: { WRANGLER_WRITE_LOGS: "false", WRANGLER_LOG_PATH: ".wrangler/logs", DASHBOARD_DATA_URL: "http://127.0.0.1:9/dashboard.json" },
  },
});

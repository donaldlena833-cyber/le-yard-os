import { defineConfig } from "@playwright/test";
import {
  connectedTestMode,
  validateConnectedConfigTarget,
} from "./tests/connected/attestation-preflight";

const target = validateConnectedConfigTarget();
const mode = connectedTestMode();

export default defineConfig({
  globalSetup: "./tests/connected/global-setup.ts",
  testDir: "./tests/connected",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/le-yard-os-connected-playwright-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["line"]] : [["list"]],
  use: {
    baseURL: target.origin,
    colorScheme: "light",
    locale: "en-US",
    serviceWorkers: "block",
    timezoneId: process.env.E2E_CONNECTED_TIMEZONE ?? "America/New_York",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: mode === "release-acceptance"
        ? "connected-acceptance-desktop"
        : "connected-developer-smoke-desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1_000 } },
    },
    {
      name: mode === "release-acceptance"
        ? "connected-acceptance-mobile-390"
        : "connected-developer-smoke-mobile-390",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
  ],
});

import { defineConfig } from "@playwright/test";

const configuredUrl = process.env.E2E_CONNECTED_APP_URL?.trim();
if (!configuredUrl) {
  throw new Error("E2E_CONNECTED_APP_URL is required for connected acceptance.");
}
const parsedUrl = new URL(configuredUrl);
const localHostname = parsedUrl.hostname === "localhost"
  || parsedUrl.hostname.endsWith(".localhost")
  || parsedUrl.hostname.startsWith("127.");
if (parsedUrl.protocol !== "https:" && !(localHostname && process.env.E2E_CONNECTED_ALLOW_LOCAL === "true")) {
  throw new Error("Connected acceptance requires HTTPS; local HTTP needs E2E_CONNECTED_ALLOW_LOCAL=true.");
}
if (parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash || parsedUrl.username || parsedUrl.password) {
  throw new Error("E2E_CONNECTED_APP_URL must be a canonical origin.");
}

export default defineConfig({
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
    baseURL: parsedUrl.origin,
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
      name: "connected-desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1_000 } },
    },
    {
      name: "connected-mobile-390",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
  ],
});

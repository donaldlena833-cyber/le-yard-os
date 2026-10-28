import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// The historical fixed-clock fixture needs its own server. Running its unchanged
// assertions against the ordinary demo does not exercise that fixture.
const baseURL = "http://127.0.0.1:3101";
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "**/full-service-day.spec.ts",
  outputDir: "/tmp/le-yard-os-historical-playwright-results",
  use: { ...base.use, baseURL },
  webServer: {
    command: "npx next dev --webpack --hostname 127.0.0.1 --port 3101",
    url: `${baseURL}/sign-in`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_APP_URL: baseURL,
      NEXT_PUBLIC_DEMO_MODE: "true",
      NEXT_PUBLIC_SERVICE_SIMULATION: "full-service-day-v1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});

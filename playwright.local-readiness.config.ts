import { defineConfig } from "@playwright/test";
if (process.env.LOCAL_READINESS_ORIGIN !== "http://localhost:3110") {
  throw new Error("Local readiness is restricted to the isolated loopback sandbox on port 3110.");
}
export default defineConfig({
  testDir: "./tests/local-readiness",
  outputDir: "./output/local-readiness",
  workers: 1, fullyParallel: false, retries: 0, timeout: 120_000,
  expect: { timeout: 15_000 }, reporter: [["json"]],
  use: { baseURL: process.env.LOCAL_READINESS_ORIGIN, browserName: "chromium",
    viewport: {width:1440,height:1000}, serviceWorkers: "block", timezoneId: "America/New_York",
    trace:"retain-on-failure", screenshot:"only-on-failure", video:"off" },
});

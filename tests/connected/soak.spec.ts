import { expect, test } from "@playwright/test";

import {
  CONNECTED_SOAK_REFRESH_P95_BUDGET_MS,
  CONNECTED_SOAK_SESSION_COUNT,
  connectedSoakPlan,
  percentile95,
} from "./soak-contract";
import { connectedTestMode } from "./attestation-preflight";
import {
  connectedFixture,
  expectConnectedShell,
  installReadOnlyRequestFirewall,
  signIn,
} from "./support";

const storageSentinel = "le-yard-connected-soak-session";

test("fourteen isolated connected sessions preserve role, storage, and refresh boundaries", async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "The fourteen-context soak runs once on desktop; mobile connected acceptance remains a separate project.",
  );
  test.skip(
    connectedTestMode() !== "release-acceptance",
    "The fourteen-session soak requires the signed hosted release-acceptance fixture; loopback smoke is not evidence.",
  );
  test.setTimeout(420_000);

  const fixture = connectedFixture();
  const results: Array<{
    session: number;
    role: string;
    status: "passed" | "failed";
    refreshMs: number;
    storageIsolated: boolean;
    unexpectedWriteCount: number;
    signedOut: boolean;
  }> = [];
  const failures: string[] = [];

  for (const planned of connectedSoakPlan) {
    const context = await browser.newContext({
      baseURL: process.env.E2E_CONNECTED_APP_URL,
      colorScheme: "light",
      locale: "en-US",
      serviceWorkers: "block",
      timezoneId: process.env.E2E_CONNECTED_TIMEZONE ?? "America/New_York",
    });
    const page = await context.newPage();
    let refreshMs = 0;
    let storageIsolated = false;
    let unexpectedWriteCount = 0;
    let signedOut = false;

    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signIn(page, planned.role);
      await expectConnectedShell(page, fixture);

      storageIsolated = await page.evaluate(
        (key) => window.localStorage.getItem(key) === null,
        storageSentinel,
      );
      expect(
        storageIsolated,
        `Session ${planned.session} inherited client storage from another context.`,
      ).toBe(true);
      await page.evaluate(
        ({ key, value }) => window.localStorage.setItem(key, value),
        { key: storageSentinel, value: `session-${planned.session}` },
      );

      const firewall = await installReadOnlyRequestFirewall(page);
      try {
        const refreshStartedAt = Date.now();
        const refresh = await page.reload({ waitUntil: "domcontentloaded" });
        expect(refresh?.status()).toBeLessThan(400);
        await expectConnectedShell(page, fixture);
        refreshMs = Date.now() - refreshStartedAt;

        const reservationResponse = await page.goto("/reservations", {
          waitUntil: "domcontentloaded",
        });
        expect(reservationResponse?.status()).toBeLessThan(400);
        if (planned.reservationsExpected) {
          await expect(page).toHaveURL(/\/reservations(?:\?|$)/);
          await expect(
            page.getByRole("heading", { name: "Reservations", level: 1 }),
          ).toBeVisible();
          await expectConnectedShell(page, fixture);
        } else {
          await expect(page).toHaveURL(/\/today(?:\?|$)/);
          await expect(
            page.getByRole("heading", { name: "Reservations", level: 1 }),
          ).toHaveCount(0);
        }

        unexpectedWriteCount = firewall.blockedRequests.length;
        expect(
          firewall.blockedRequests,
          `Session ${planned.session} attempted an unexpected connected write.`,
        ).toEqual([]);
      } finally {
        await firewall.dispose();
      }

      await page.getByRole("button", { name: "Log out", exact: true }).click();
      await expect(page).toHaveURL(
        (url) => url.pathname === "/sign-in" && url.search === "",
      );
      const authCookies = (await context.cookies()).filter(
        ({ name }) => name.startsWith("sb-") && name.includes("-auth-token"),
      );
      expect(authCookies).toEqual([]);
      signedOut = true;

      results.push({
        session: planned.session,
        role: planned.role,
        status: "passed",
        refreshMs,
        storageIsolated,
        unexpectedWriteCount,
        signedOut,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown failure";
      failures.push(`Session ${planned.session} (${planned.role}): ${message}`);
      results.push({
        session: planned.session,
        role: planned.role,
        status: "failed",
        refreshMs,
        storageIsolated,
        unexpectedWriteCount,
        signedOut,
      });
    } finally {
      await context.close();
    }
  }

  const refreshP95Ms = percentile95(results.map((result) => result.refreshMs));
  await testInfo.attach("connected-soak-summary", {
    body: Buffer.from(
      `${JSON.stringify(
        {
          schema: "le-yard-connected-soak-v1",
          expectedSessions: CONNECTED_SOAK_SESSION_COUNT,
          completedSessions: results.length,
          passedSessions: results.filter((result) => result.status === "passed").length,
          failedSessions: results.filter((result) => result.status === "failed").length,
          refreshP95Ms,
          refreshP95BudgetMs: CONNECTED_SOAK_REFRESH_P95_BUDGET_MS,
          results,
        },
        null,
        2,
      )}\n`,
    ),
    contentType: "application/json",
  });

  expect(results).toHaveLength(CONNECTED_SOAK_SESSION_COUNT);
  expect(failures, failures.join("\n\n")).toEqual([]);
  expect(refreshP95Ms).toBeLessThanOrEqual(
    CONNECTED_SOAK_REFRESH_P95_BUDGET_MS,
  );
});

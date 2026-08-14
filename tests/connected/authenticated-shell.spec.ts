import { expect, test } from "@playwright/test";
import {
  connectedAcceptanceRoles,
  connectedTestMode,
} from "./attestation-preflight";
import {
  connectedFixture,
  credentialVariableNames,
  expectConnectedShell,
  missingEnvironment,
  signIn,
  type AcceptanceRole,
} from "./support";

function skipUnavailableDeveloperSmoke(role: AcceptanceRole) {
  test.skip(
    connectedTestMode() === "developer-smoke" &&
      missingEnvironment(credentialVariableNames(role)).length > 0,
    `${role} is optional only in explicitly named developer-smoke mode.`,
  );
}

test("connected deployment reports ready without exposing dependency details", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toMatch(/no-store/);
  expect(await response.json()).toMatchObject({ status: "ready", liveness: "ok", readiness: "ok" });
});

for (const role of connectedAcceptanceRoles) {
  test(`${role} credentials resolve through connected Supabase Auth and tenant membership`, async ({ page }) => {
    skipUnavailableDeveloperSmoke(role);
    await signIn(page, role);
    await expect(page).toHaveURL(/\/today(?:\?|$)/);
    await expectConnectedShell(page, connectedFixture());
    await expect(page.getByRole("navigation", { name: /Primary/ })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Synthetic Saturday service preview");
  });
}

test.describe("exact reservation capability and location matrix", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "The complete authorization matrix runs once on desktop; the same attested fixture is reused by mobile shell acceptance.",
    );
  });

  for (const role of ["Owner", "Manager", "Host"] as const) {
    test(`${role} reaches the target location reservation book`, async ({ page }) => {
      skipUnavailableDeveloperSmoke(role);
      await signIn(page, role);
      const response = await page.goto("/reservations", {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status()).toBeLessThan(400);
      await expect(page).toHaveURL(/\/reservations(?:\?|$)/);
      await expect(page.getByRole("heading", { name: "Reservations", level: 1 })).toBeVisible();
      await expectConnectedShell(page, connectedFixture());
    });
  }

  test("view-only can read reservations without mutation controls", async ({ page }) => {
    skipUnavailableDeveloperSmoke("ViewOnly");
    await signIn(page, "ViewOnly");
    await page.goto("/reservations", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/reservations(?:\?|$)/);
    await expect(page.getByText("Read-only reservation access", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Book", exact: true })).toBeDisabled();
  });

  test("operate-only can operate without configuration authority", async ({ page }) => {
    skipUnavailableDeveloperSmoke("OperateOnly");
    await signIn(page, "OperateOnly");
    await page.goto("/reservations", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/reservations(?:\?|$)/);
    await expect(page.getByRole("button", { name: "Book", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Configuration", exact: true })).toBeDisabled();
  });

  for (const role of ["Denied", "Expired", "CrossLocation"] as const) {
    test(`${role} cannot read the target location reservation book`, async ({ page }) => {
      skipUnavailableDeveloperSmoke(role);
      await signIn(page, role);
      await page.goto("/reservations", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/today(?:\?|$)/);
      await expect(
        page.getByRole("heading", { name: "Reservations", level: 1 }),
      ).toHaveCount(0);
    });
  }
});

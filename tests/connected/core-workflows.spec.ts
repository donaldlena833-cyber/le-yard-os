import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  connectedFixture,
  credentialVariableNames,
  expectConnectedShell,
  installReadOnlyRequestFirewall,
  missingEnvironment,
  mutationFixture,
  signIn,
} from "./support";

type ReadinessCheck = {
  path: string;
  title: string;
  ready: (page: Page) => Locator;
};

const fixtureVariables = [
  ...credentialVariableNames("Admin"),
  "E2E_CONNECTED_EXPECTED_ORGANIZATION_NAME",
  "E2E_CONNECTED_EXPECTED_LOCATION_NAME",
] as const;

const coreReadinessChecks: ReadinessCheck[] = [
  {
    path: "/today",
    title: "Today",
    ready: (page) => page.getByRole("region", { name: "Today’s live metrics" }),
  },
  {
    path: "/schedule",
    title: "Schedule",
    ready: (page) => page.getByRole("region", { name: "Schedule metrics" }),
  },
  {
    path: "/team",
    title: "Team",
    ready: (page) => page.getByRole("region", { name: "Live team metrics" }),
  },
  {
    path: "/time-clock",
    title: "Time clock",
    ready: (page) => page.getByRole("region", { name: "Your live time clock" }),
  },
  {
    path: "/closeout",
    title: "Closeout & tips",
    ready: (page) => page.getByRole("heading", { name: "Closeout & tips", exact: true, level: 2 }),
  },
  {
    path: "/receipts",
    title: "Receipts",
    ready: (page) => page.getByRole("heading", { name: "Receipts and invoices", exact: true, level: 2 }),
  },
  {
    path: "/inventory",
    title: "Inventory",
    ready: (page) => page.getByRole("tablist", { name: "Inventory sections" }),
  },
  {
    path: "/guests",
    title: "Guests",
    ready: (page) => page.getByRole("region", { name: "Guest profiles" }).first(),
  },
  {
    path: "/tasks",
    title: "Tasks & SOPs",
    ready: (page) => page.getByRole("tablist", { name: "Operations sections" }),
  },
  {
    path: "/reports",
    title: "Reports",
    ready: (page) => page.getByRole("heading", { name: "Reports", exact: true, level: 2 }),
  },
  {
    path: "/assistant",
    title: "Ask Le Yard",
    ready: (page) => page.getByRole("textbox", { name: "Ask a question about restaurant operations" }),
  },
  {
    path: "/integrations",
    title: "Integrations",
    ready: (page) => page.getByRole("heading", { name: "Integrations", exact: true, level: 2 }),
  },
  {
    path: "/settings",
    title: "Settings",
    ready: (page) => page.getByRole("navigation", { name: "Settings sections" }),
  },
];

test.describe("connected core workflow readiness", () => {
  test.setTimeout(180_000);

  test("Admin can read every tenant-backed core surface without issuing a write", async ({ page }, testInfo) => {
    const missing = missingEnvironment(fixtureVariables);
    test.skip(
      missing.length > 0,
      `Connected core readiness needs these nonproduction fixtures: ${missing.join(", ")}`,
    );

    const fixture = connectedFixture();
    await signIn(page, "Admin");
    await expectConnectedShell(page, fixture);
    const firewall = await installReadOnlyRequestFirewall(page);

    try {
      for (const check of coreReadinessChecks) {
        await test.step(`${check.path} exposes its live readiness landmark`, async () => {
          const response = await page.goto(check.path, { waitUntil: "domcontentloaded" });
          expect(response?.status(), `${check.path} should return a successful document`).toBeLessThan(400);
          await expect(page.getByRole("heading", { name: check.title, exact: true, level: 1 })).toBeVisible();
          await expectConnectedShell(page, fixture);
          await expect(check.ready(page)).toBeVisible();
        });
      }

      if (testInfo.project.name.includes("mobile")) {
        await page.getByRole("button", { name: "Open navigation" }).click();
        await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
        await page.getByRole("button", { name: "Close navigation" }).click();
      } else {
        await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
      }

      expect(
        firewall.blockedRequests,
        `Read-only connected acceptance blocked unexpected writes:\n${firewall.blockedRequests.join("\n")}`,
      ).toEqual([]);
    } finally {
      await firewall.dispose();
    }
  });

  test("employee chat write path runs only with an explicit nonproduction mutation contract", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "connected-desktop",
      "The write probe runs once on desktop; mobile workflow readiness is covered by the read-only route matrix.",
    );
    test.skip(
      process.env.E2E_CONNECTED_ENABLE_MUTATIONS !== "true",
      "Mutation probe is disabled. Set E2E_CONNECTED_ENABLE_MUTATIONS=true only for an isolated nonproduction fixture.",
    );

    const mutation = mutationFixture();
    const missingCredentials = missingEnvironment(credentialVariableNames("Employee"));
    expect(
      missingCredentials,
      `Mutation mode was enabled but employee credentials are missing: ${missingCredentials.join(", ")}`,
    ).toEqual([]);

    await signIn(page, "Employee");
    await expectConnectedShell(page, mutation);
    const response = await page.goto("/messages", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "/messages should return a successful document").toBeLessThan(400);
    await expect(page.getByRole("heading", { name: "Stay close to service", exact: true, level: 2 })).toBeVisible();

    const channelNavigation = page.getByRole("navigation", { name: "Message channels" });
    await channelNavigation.getByRole("searchbox", { name: "Search channels" }).fill(mutation.channelName);
    const matchingChannels = channelNavigation.getByRole("button").filter({ hasText: mutation.channelName });
    await expect(
      matchingChannels,
      "The configured mutation channel must resolve to one dedicated employee-visible fixture.",
    ).toHaveCount(1);
    await matchingChannels.click();

    const conversation = page.getByRole("main", {
      name: `${mutation.channelName} conversation`,
      exact: true,
    });
    await expect(conversation).toBeVisible();
    const marker = `[connected-acceptance:${mutation.runId}] employee chat write probe`;
    await conversation.getByRole("textbox", { name: `Message ${mutation.channelName}`, exact: true }).fill(marker);
    await conversation.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(conversation.getByText(marker, { exact: true })).toBeVisible();
  });
});

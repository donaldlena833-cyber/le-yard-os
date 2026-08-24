import { expect, test } from "@playwright/test";
import { openWorkspace } from "./helpers/workspace";

test("pauses network commands offline and restores them only after a successful reachability probe", async ({
  context,
  page,
}) => {
  let markProbeRequested!: () => void;
  let releaseProbe!: () => void;
  const probeRequested = new Promise<void>((resolve) => {
    markProbeRequested = resolve;
  });
  const probeReleased = new Promise<void>((resolve) => {
    releaseProbe = resolve;
  });
  await page.route("**/api/health", async (route) => {
    markProbeRequested();
    await probeReleased;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"status":"ok"}',
    });
  });
  await openWorkspace(page, "/tasks", "Tasks & SOPs");
  await page.getByRole("button", {
    name: "Show details for Review produce invoice extraction",
  }).click();
  const complete = page
    .getByRole("group", { name: "Actions for Review produce invoice extraction" })
    .getByRole("button", { name: "Complete", exact: true });
  await expect(complete).toBeEnabled();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("Working offline", { exact: true })).toBeVisible();
  await expect(complete).toBeDisabled();
  await expect(page.getByText(/nothing will be posted until reconnection is verified/i)).toBeVisible();

  await context.setOffline(false);
  await probeRequested;
  await expect(page.getByText("Verifying connection", { exact: true })).toBeVisible();
  releaseProbe();
  await expect(page.getByTestId("connectivity-status")).toBeHidden();
  await expect(complete).toBeEnabled();
});

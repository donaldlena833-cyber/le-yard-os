import { expect, test } from "@playwright/test";
import {
  expectNoViewportOverflow,
  isMobileProject,
  openWorkspace,
} from "./helpers/workspace";

test("keeps the synthetic demo workspace available without a live MFA challenge", async ({
  page,
}, testInfo) => {
  await openWorkspace(page, "/today", "Good afternoon, Donald.");

  await expect(page.getByText("Owner verification", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("navigation", {
      name: isMobileProject(testInfo)
        ? "Primary mobile navigation"
        : "Primary navigation",
    }),
  ).toBeVisible();
  await expectNoViewportOverflow(page);
});

test("completes the demo-safe authenticator enrollment control", async ({ page }) => {
  await openWorkspace(page, "/settings", "Settings");

  await page.getByRole("button", { name: "Security", exact: true }).click();
  await expect(page.getByText("Authenticator app", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enroll", exact: true }).click();

  await expect(page.getByText("No scannable secret", { exact: false })).toBeVisible();
  await page.getByLabel("Six-digit verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and enable", exact: true }).click();

  await expect(page.getByText("Authenticator already enrolled", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo MFA enrollment verified locally.", { exact: true })).toBeVisible();
  await expectNoViewportOverflow(page);
});

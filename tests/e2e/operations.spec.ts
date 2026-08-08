import { expect, test } from "@playwright/test";

import {
  expectNoViewportOverflow,
  openWorkspace,
} from "./helpers/workspace";

test("reviews vendor price movement and open purchasing records", async ({ page }) => {
  await openWorkspace(page, "/vendors", "Vendors & prices");

  await expect(page.getByText("Harbor Produce", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Roma tomatoes", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$1.89", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Northstar Foods/ }).click();
  await expect(page.getByText("No verified price records for this vendor yet.", { exact: true })).toBeVisible();
  await expectNoViewportOverflow(page);
});

test("reconciles, submits, and owner-approves a closeout", async ({ page }) => {
  await openWorkspace(page, "/closeout", "Closeout & tips");
  const businessDate = await page.getByLabel("Business date").inputValue();

  await page.getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(page.getByText("Tip pool calculated and reconciled exactly. Review every explanation before submission.")).toBeVisible();
  await expect(page.getByText("Exact reconciliation", { exact: true })).toBeVisible();
  await expect(page.getByText("Balanced", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Submit closeout", exact: true }).click();
  await expect(page.getByText("Submitted for owner approval. Inputs are temporarily locked.")).toBeVisible();
  await page.getByRole("button", { name: "Owner approve", exact: true }).click();
  await expect(page.getByText("Owner approval recorded. The closeout and tip calculation are now locked.")).toBeVisible();
  await expect(page.getByLabel("Business date")).toBeDisabled();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Payroll CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^le-yard-tips-.*-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(download.suggestedFilename()).toContain(businessDate);
  expect(await download.failure()).toBeNull();
  await expectNoViewportOverflow(page);
});

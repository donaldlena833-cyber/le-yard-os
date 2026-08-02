import { expect, test } from "@playwright/test";

import {
  expectNoViewportOverflow,
  openWorkspace,
} from "./helpers/workspace";

test("clocks a shift, records a break, and approves a correction", async ({ page }) => {
  await openWorkspace(page, "/time-clock", "Time, without the guesswork");

  await page.getByRole("button", { name: "Clock in", exact: true }).click();
  await expect(page.getByText("Clock-in recorded at this device and added to the audit trail.")).toBeVisible();
  await page.getByLabel("Break type").selectOption("paid");
  await page.getByRole("button", { name: "Start break", exact: true }).click();
  await expect(page.getByText("Paid break started.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "End break", exact: true }).click();
  await expect(page.getByText(/Break ended after/)).toBeVisible();
  await page.getByRole("button", { name: "Clock out", exact: true }).click();
  await expect(page.getByText(/Clock-out recorded\. Session total:/)).toBeVisible();

  await page.getByRole("button", { name: "Request correction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Request a punch correction" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Business date").fill("2026-08-01");
  await dialog.getByLabel("Punch to correct").selectOption("clock_out");
  await dialog.getByLabel("Correct time").fill("23:20");
  const reason = "Forgot to clock out after completing the demo closing shift.";
  await dialog.getByLabel("What happened?").fill(reason);
  await dialog.getByRole("button", { name: "Submit for approval" }).click();

  await expect(page.getByText("Correction submitted for manager approval. The original punch is unchanged.")).toBeVisible();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Donald was approved.", { exact: true })).toBeVisible();
  await expect(page.getByText("Correction approved", { exact: true }).first()).toBeVisible();
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

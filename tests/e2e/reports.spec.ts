import { expect, test } from "@playwright/test";

import {
  expectNoViewportOverflow,
  isMobileProject,
  openWorkspace,
} from "./helpers/workspace";

test("filters, changes, validates, and exports a source-backed report", async ({
  page,
}, testInfo) => {
  await openWorkspace(page, "/reports", "Reports");

  if (isMobileProject(testInfo)) {
    await page
      .getByRole("combobox", { name: "Report view", exact: true })
      .selectOption("inventory_variance");
  } else {
    const laborTab = page.getByRole("tab", { name: "Labor", exact: true });
    await laborTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "Attendance", exact: true }),
    ).toHaveAttribute("aria-selected", "true");

    const inventoryVarianceTab = page.getByRole("tab", {
      name: "Inventory variance",
      exact: true,
    });
    await inventoryVarianceTab.click();
    await expect(inventoryVarianceTab).toHaveAttribute(
      "aria-controls",
      "demo-report-views-panel-inventory_variance",
    );
    await expect(
      page.getByRole("tabpanel", { name: "Inventory variance" }),
    ).toBeVisible();
  }

  await expect(
    page.getByRole("heading", { name: "Inventory variance", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Absolute variance by item/i }),
  ).toBeVisible();

  const rangeError = page.getByText(
    "The start date must be on or before the end date.",
    { exact: true },
  );
  await page.getByLabel("Start date").fill("2026-08-02");
  await expect(rangeError).toBeVisible();
  await page.getByLabel("Start date").fill("2026-07-01");
  await expect(rangeError).toHaveCount(0);

  const csv = page.getByRole("link", { name: "CSV", exact: true });
  await expect(csv).toHaveAttribute("href", /kind=inventory_variance/);
  await expect(page.getByRole("link", { name: "PDF", exact: true })).toHaveAttribute(
    "href",
    /kind=inventory_variance/,
  );

  const downloadPromise = page.waitForEvent("download");
  await csv.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "le-yard-inventory_variance-2026-07-01-2026-08-01.csv",
  );
  expect(await download.failure()).toBeNull();
  await expectNoViewportOverflow(page);
});

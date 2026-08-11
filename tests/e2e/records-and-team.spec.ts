import { expect, test } from "@playwright/test";

import { expectNoViewportOverflow, openWorkspace } from "./helpers/workspace";

test("searches OCR text and verifies a receipt", async ({ page }) => {
  await openWorkspace(page, "/receipts", "Receipts & invoices");

  await page
    .getByPlaceholder("Search vendor, amount, category, or OCR text")
    .fill("Harbor");
  const receiptRow = page.getByRole("button", {
    name: /Harbor Produce — Demo/,
  });
  await receiptRow.click();

  const receiptPanel = page.getByRole("dialog", {
    name: "Harbor Produce — Demo",
  });
  await expect(receiptPanel).toBeVisible();
  await receiptPanel
    .getByRole("button", { name: "Verify fields", exact: true })
    .click();
  await expect(
    receiptPanel.getByRole("button", { name: "Verified", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(receiptPanel).toBeHidden();
  await expect(receiptRow).toBeFocused();
  await expectNoViewportOverflow(page);
});

test("updates and submits a live inventory count", async ({ page }) => {
  await openWorkspace(page, "/inventory", "Inventory");

  await page.getByRole("button", { name: "Start count", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Live count", exact: true }),
  ).toBeVisible();
  const tomatoes = page.getByLabel("Counted Roma tomatoes");
  await tomatoes.fill("22.5");
  await page.getByRole("button", { name: "Submit count", exact: true }).click();

  await expect(tomatoes).toHaveValue("22.5");
  await expect(tomatoes).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Submitted", exact: true }),
  ).toBeDisabled();
  await expectNoViewportOverflow(page);
});

test("searches CRM allergy data and opens the matching guest", async ({
  page,
}) => {
  await openWorkspace(page, "/guests", "Guestbook");

  await page
    .getByPlaceholder("Search name, contact, allergy, preference, or tag")
    .fill("tree nuts");
  const guestRow = page.getByRole("button", { name: /Nora Example/ });
  await guestRow.click();

  const guestPanel = page.getByRole("dialog", { name: "Nora Example" });
  await expect(guestPanel).toBeVisible();
  await expect(
    guestPanel.getByRole("group", { name: "Actions for Nora Example" }),
  ).toBeVisible();
  await expect(
    guestPanel.getByRole("button", { name: "Remove VIP", exact: true }),
  ).toBeVisible();
  await expect(
    guestPanel.getByRole("heading", { name: "Contact & consent" }),
  ).toBeVisible();
  await expect(
    guestPanel.getByText("nora@example.invalid", { exact: true }),
  ).toBeVisible();
  await expect(
    guestPanel.getByText("tree nuts", { exact: true }),
  ).toBeVisible();
  await expect(
    guestPanel.getByRole("heading", { name: "Visit history" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guestPanel).toBeHidden();
  await expect(guestRow).toBeFocused();
  await expectNoViewportOverflow(page);
});

test("prepares a tenant-scoped teammate invitation", async ({ page }) => {
  await openWorkspace(page, "/team", "Your whole team, in one place");

  await page
    .getByRole("button", { name: "Invite teammate", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Invite a teammate" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Full name").fill("Riley Test");
  await dialog.getByLabel("Work email").fill("riley.test@example.invalid");
  await dialog.getByLabel("Access role").selectOption({ label: "Manager" });
  await dialog
    .getByLabel("Primary location")
    .selectOption({ label: "Le Yard" });
  await dialog
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();

  await expect(dialog.getByRole("status")).toContainText(
    "Demo invitation prepared for riley.test@example.invalid.",
    { timeout: 20_000 },
  );
  await expectNoViewportOverflow(page);
});

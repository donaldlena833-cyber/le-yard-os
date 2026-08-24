import { expect, test } from "@playwright/test";

import { expectNoViewportOverflow, openWorkspace } from "./helpers/workspace";

test("reviews vendor price movement and open purchasing records", async ({
  page,
}) => {
  await openWorkspace(page, "/vendors", "Vendors & prices");

  await expect(
    page.getByText("Harbor Produce", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Roma tomatoes", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("$1.89", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Northstar Foods/ }).click();
  await expect(
    page.getByText("No verified price records for this vendor yet.", {
      exact: true,
    }),
  ).toBeVisible();
  await expectNoViewportOverflow(page);
});

test("reveals task evidence and confirms a named terminal action", async ({
  page,
}) => {
  await openWorkspace(page, "/tasks", "Tasks & SOPs");

  const disclosure = page.getByRole("button", {
    name: "Show details for Review produce invoice extraction",
  });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.click();
  await expect(
    page.getByRole("button", {
      name: "Hide details for Review produce invoice extraction",
    }),
  ).toHaveAttribute("aria-expanded", "true");

  const actions = page.getByRole("group", {
    name: "Actions for Review produce invoice extraction",
  });
  await expect(actions).toBeVisible();
  await expect(
    page.getByText(
      "Check the OCR total and link each line to the received purchase order.",
      { exact: true },
    ),
  ).toBeVisible();

  await actions.getByRole("button", { name: "Complete", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Complete this task?",
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Complete task", exact: true })
    .click();

  await expect(actions).toBeHidden();
  await expect(
    page.getByText("Terminal task evidence is locked."),
  ).toBeVisible();
  await expectNoViewportOverflow(page);
});

test("reconciles and submits a closeout while blocking same-owner approval", async ({ page }) => {
  await openWorkspace(page, "/closeout", "Closeout & tips");
  const mobile = (page.viewportSize()?.width ?? 1_440) < 768;

  await expect(
    mobile
      ? page.getByRole("list", {
          name: "Tip allocation participants, mobile view",
        })
      : page.getByRole("region", { name: "Tip allocation participants" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Closeout workflow actions" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(
    page.getByText(
      "Tip pool calculated and reconciled exactly. Review every explanation before submission.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Exact reconciliation", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Balanced", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Aisha R\..*Bartender/ }).click();
  await expect(
    page.locator(
      mobile ? '[id^="explanation-mobile-"]' : '[id^="explanation-desktop-"]',
    ),
  ).toContainText("Exact share");

  await page
    .getByRole("button", { name: "Submit closeout", exact: true })
    .click();
  await expect(
    page.getByText(
      "Submitted for owner approval. A different owner must review and approve this closeout.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Owner approve", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Submitted by Donald.*a different owner must approve/i),
  ).toBeVisible();
  await expect(page.getByLabel("Business date")).toBeDisabled();
  await expectNoViewportOverflow(page);
});

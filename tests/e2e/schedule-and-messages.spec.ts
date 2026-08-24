import { expect, test } from "@playwright/test";

import {
  expectNoViewportOverflow,
  openWorkspace,
} from "./helpers/workspace";

test("publishes a schedule and blocks manager attestation for an employee", async ({ page }) => {
  await openWorkspace(page, "/schedule", "Dinner schedule");
  const mobile = (page.viewportSize()?.width ?? 1_440) < 768;

  await expect(
    page.getByLabel(
      mobile ? "Weekly schedule agenda" : "Weekly schedule board",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Publish schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Published", exact: true })).toBeDisabled();

  await page
    .getByRole("button", {
      name: /Mateo.*Kitchen.*Awaiting acknowledgement/,
    })
    .first()
    .click();

  const shiftPanel = page.getByRole("dialog", { name: "Mateo", exact: true });
  await expect(shiftPanel).toBeVisible();
  await expect(shiftPanel.getByText("Awaiting response", { exact: true })).toBeVisible();
  await expect(
    shiftPanel.getByText(/Only Mateo can acknowledge this shift/i),
  ).toBeVisible();
  await expect(shiftPanel.getByRole("button", { name: "Acknowledge shift" })).toHaveCount(0);
  await expectNoViewportOverflow(page);
});

test("posts to all staff and toggles a reaction", async ({ page }) => {
  await openWorkspace(page, "/messages", "Stay close to service");

  await page.getByRole("button", { name: /^All staff/ }).click();
  const conversation = page.getByRole("main", { name: "All staff conversation" });
  await expect(conversation).toBeVisible();
  await expect(
    conversation.getByRole("region", { name: "Pinned announcement" }),
  ).toBeVisible();

  await conversation
    .getByRole("button", { name: "👍 reaction from 3 people" })
    .click();
  await expect(
    conversation.getByRole("button", { name: "👍 reaction from 4 people" }),
  ).toBeVisible();

  const message = "Demo lineup is confirmed for tonight's service.";
  await conversation.getByRole("textbox", { name: "Message All staff" }).fill(message);
  await conversation.getByRole("button", { name: "Send message" }).click();

  const sent = conversation.getByRole("article").filter({ hasText: message });
  await expect(sent).toBeVisible();
  await expect(sent.getByText("Sent", { exact: true })).toBeVisible();
  await expectNoViewportOverflow(page);
});

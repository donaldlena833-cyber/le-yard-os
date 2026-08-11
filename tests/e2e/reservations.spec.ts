import { expect, test, type Page } from "@playwright/test";

import { expectNoBlockingAxeViolations } from "../a11y/axe";
import { expectNoViewportOverflow, openWorkspace } from "./helpers/workspace";

const serviceDate =
  /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), /;

function usesReservationViewSwitcher(page: Page) {
  return (page.viewportSize()?.width ?? 1_440) < 1_280;
}

async function showReservationView(
  page: Page,
  view: "Book" | "Floor" | "Service",
) {
  if (!usesReservationViewSwitcher(page)) return;
  const switcher = page.getByRole("group", {
    name: "Reservation workspace view",
  });
  await switcher.getByRole("button", { name: new RegExp(`^${view}`) }).click();
}

test("opens the booking and waitlist workflows from the host stand", async ({
  page,
}) => {
  await openWorkspace(page, "/reservations", serviceDate);

  const bookButton = page.getByRole("button", { name: "Book", exact: true });
  const waitlistButton = page.getByRole("button", {
    name: "Waitlist",
    exact: true,
  });
  for (const control of [bookButton, waitlistButton]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await bookButton.focus();
  await page.keyboard.press("Enter");
  const booking = page.getByRole("dialog", { name: "New reservation" });
  await expect(booking).toBeVisible();
  await expect(booking.getByLabel("Guest name")).toBeVisible();
  await expectNoBlockingAxeViolations(page);
  await page.keyboard.press("Escape");
  await expect(booking).toBeHidden();
  await expect(bookButton).toBeFocused();

  await waitlistButton.click();
  const waitlist = page.getByRole("dialog", { name: "Add to waitlist" });
  await expect(waitlist).toBeVisible();
  await expect(waitlist.getByLabel("Guest name")).toBeVisible();
  await waitlist.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: /Maya Rivera/ }).click();
  await expect(
    page.getByRole("heading", { name: "Maya Rivera" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Arrive", exact: true }),
  ).toBeVisible();
  if (usesReservationViewSwitcher(page)) {
    await expect(
      page
        .getByRole("group", { name: "Reservation workspace view" })
        .getByRole("button", { name: /^Service/ }),
    ).toHaveAttribute("aria-pressed", "true");
  }

  const noShowButton = page.getByRole("button", {
    name: "No-show",
    exact: true,
  });
  await noShowButton.click();
  const noShowDialog = page.getByRole("alertdialog", {
    name: "Mark this reservation as a no-show?",
  });
  await expect(noShowDialog).toBeVisible();
  await expect(
    noShowDialog.getByRole("button", { name: "Cancel" }),
  ).toBeFocused();
  await expectNoBlockingAxeViolations(page);
  await page.keyboard.press("Escape");
  await expect(noShowDialog).toBeHidden();
  await expect(noShowButton).toBeFocused();

  await page.getByRole("button", { name: "Close guest context" }).click();

  await showReservationView(page, "Floor");
  await expect(page.getByRole("heading", { name: "Floor now" })).toBeVisible();
  await expect(
    page.getByTitle(/^Table 10 · 4 seats · available now/),
  ).toBeVisible();
  await expect(
    page.getByTitle(/^Table 9 · 6 seats · occupied now/),
  ).toBeVisible();
  await expect(
    page.getByText(/evaluated by exact overlap.*do not recolor the floor/i),
  ).toBeVisible();

  await page.getByTitle(/^Table 1 ·/).click();
  await expect(
    page.getByRole("button", { name: "Needs reset", exact: true }),
  ).toBeVisible();
  await expectNoViewportOverflow(page);
});

test("the reservation host stand reflows at a 320 CSS-pixel viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openWorkspace(page, "/reservations", serviceDate);
  await expect(
    page.getByRole("button", { name: "Book", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waitlist", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Reservation workspace view" }),
  ).toBeVisible();
  await expectNoViewportOverflow(page);

  const actionTrigger = page.getByRole("button", { name: "Open actions" });
  await expect(actionTrigger).toBeVisible();
  await actionTrigger.focus();
  await page.keyboard.press("Enter");
  const actionDialog = page.getByRole("dialog", { name: "Actions" });
  await expect(actionDialog).toBeVisible();
  await expect(actionDialog.getByRole("combobox")).toBeFocused();
  await expectNoBlockingAxeViolations(page);
  await page.keyboard.press("Escape");
  await expect(actionDialog).toBeHidden();
  await expect(actionTrigger).toBeFocused();
});

test("a future book never borrows the current physical floor for seating", async ({
  page,
}) => {
  await openWorkspace(page, "/reservations?date=2099-08-10", serviceDate);
  await showReservationView(page, "Floor");
  await expect(page.getByRole("heading", { name: "Floor now" })).toBeVisible();
  await expect(
    page.getByText(/current physical floor while you review/i),
  ).toBeVisible();
  await showReservationView(page, "Service");
  await expect(
    page.getByText("Open today’s book to seat from the current floor"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Seat now" }).first(),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Waitlist", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Notify", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Accept", exact: true }),
  ).toBeDisabled();
  for (const remove of await page
    .getByRole("button", { name: "Remove", exact: true })
    .all()) {
    await expect(remove).toBeDisabled();
  }
  await expect(
    page.getByText(/current-service actions are paused/i),
  ).toBeVisible();
  await showReservationView(page, "Book");
  await page.getByRole("button", { name: /Nora Example/ }).click();
  await expect(
    page.getByRole("button", { name: "Arrive", exact: true }),
  ).toBeDisabled();
});

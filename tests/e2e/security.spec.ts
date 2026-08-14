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
  const notificationTrigger = page.getByRole("button", {
    name: "Open notifications",
    exact: true,
  });
  await notificationTrigger.click();
  const notifications = page.getByRole("dialog", { name: "Notifications" });
  await expect(notifications).toBeVisible();
  await expect(notificationTrigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(notifications).toBeHidden();
  await expect(notificationTrigger).toBeFocused();

  if (isMobileProject(testInfo)) {
    const openNavigation = page.getByRole("button", { name: "Open navigation" });
    await openNavigation.click();
    const drawer = page.getByRole("dialog", { name: "Le Yard OS" });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: "Close navigation" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(openNavigation).toBeFocused();
  }
  await expectNoViewportOverflow(page);
});

test("exposes an accessible log out control and leaves no signed-in shell state", async ({
  context,
  page,
}, testInfo) => {
  await openWorkspace(page, "/today", "Good afternoon, Donald.");

  if (isMobileProject(testInfo)) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("navigation", { name: "Mobile navigation", exact: true }),
    ).toBeVisible();
  }

  const logOut = page.getByRole("button", { name: "Log out", exact: true });
  await expect(logOut).toBeVisible();
  await logOut.click();

  await expect(page).toHaveURL((url) => url.pathname === "/sign-in" && url.search === "");
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary mobile navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log out", exact: true })).toHaveCount(0);
  await expect(page.getByText("Donald", { exact: true })).toHaveCount(0);

  const authCookies = (await context.cookies()).filter(
    ({ name }) =>
      name === "__Host-le-yard-playground-session" ||
      (name.startsWith("sb-") && name.includes("-auth-token")),
  );
  expect(authCookies).toEqual([]);
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

test("restores Time Clock instead of redirecting to Vendors", async ({ page }) => {
  await openWorkspace(page, "/time-clock", "Time clock");
  await expect(page).toHaveURL(/\/time-clock$/);
  await expect(page.getByRole("heading", { name: "Time Clock", exact: true })).toBeVisible();
});

test("opens the realtime service-control surface", async ({ page }) => {
  await openWorkspace(page, "/service", "Service control");
  await expect(page.getByText("Steak frites", { exact: true })).toBeVisible();
  await expect(page.getByText("Internal status only; Toast is not changed.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "No unresolved handoffs." }),
  ).toBeVisible();
});

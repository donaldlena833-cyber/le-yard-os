import { expect, test, type Page } from "@playwright/test";

type AcceptanceRole = "Owner" | "Admin" | "Manager" | "Employee";

function credentials(role: AcceptanceRole) {
  const prefix = `E2E_CONNECTED_${role.toUpperCase()}`;
  const email = process.env[`${prefix}_EMAIL`]?.trim();
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) {
    throw new Error(`${prefix}_EMAIL and ${prefix}_PASSWORD are required.`);
  }
  return { email, password };
}

async function signIn(page: Page, role: AcceptanceRole) {
  const identity = credentials(role);
  await page.goto("/sign-in?next=/today");
  await expect(page.getByText("Private, tenant-scoped operator access", { exact: true })).toBeVisible();
  await page.getByLabel("Work email").fill(identity.email);
  await page.getByLabel("Password", { exact: false }).fill(identity.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(today|sign-in)(?:\?|$)/);
}

test("connected deployment reports ready without exposing dependency details", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toMatch(/no-store/);
  expect(await response.json()).toMatchObject({ status: "ready", liveness: "ok", readiness: "ok" });
});

for (const role of ["Owner", "Admin", "Manager", "Employee"] as const) {
  test(`${role} credentials resolve through connected Supabase Auth and tenant membership`, async ({ page }) => {
    await signIn(page, role);
    await expect(page).toHaveURL(/\/today(?:\?|$)/);
    await expect(page.getByText(new RegExp(`^${role} · Password secured$`)).first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: /Primary/ })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Synthetic Saturday service preview");
  });
}

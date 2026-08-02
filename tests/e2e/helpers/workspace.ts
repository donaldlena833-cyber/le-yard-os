import { expect, type Page, type TestInfo } from "@playwright/test";

export function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name === "mobile-390";
}

export async function openWorkspace(
  page: Page,
  path: string,
  heading: string | RegExp,
): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });

  expect(response, `Navigation to ${path} should return a document response`).not.toBeNull();
  expect(response?.ok(), `Navigation to ${path} returned ${response?.status()}`).toBe(true);
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  // In Next development mode the server-rendered document can arrive before the
  // route's client bundle has hydrated. Network idle is the deterministic point
  // at which interaction tests can safely exercise client state.
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

export async function expectNoViewportOverflow(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      {
        message: "The document should not overflow the viewport after motion settles",
        timeout: 3_000,
      },
    )
    .toBeLessThanOrEqual(1);
}

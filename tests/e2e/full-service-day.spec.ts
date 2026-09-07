import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expectNoBlockingAxeViolations } from "../a11y/axe";
import {
  expectNoViewportOverflow,
  openWorkspace,
} from "./helpers/workspace";

const phaseSurfaces = [
  { number: "01", slug: "receiving-inventory", path: "/inventory", heading: "Inventory" },
  { number: "02", slug: "opening-tasks", path: "/tasks", heading: "Tasks & SOPs" },
  { number: "03", slug: "lunch-host", path: "/reservations", heading: /^Saturday, April 18/ },
  { number: "04", slug: "lunch-handoff-income", path: "/income", heading: "Income" },
  { number: "05", slug: "dinner-preshift-service", path: "/service", heading: "Service control" },
  { number: "06", slug: "dinner-peak-today", path: "/today", heading: "Full room, Donald." },
  { number: "07", slug: "closing-closeout", path: "/closeout", heading: "Closeout & tips" },
  { number: "08", slug: "final-scorecard-reports", path: "/reports", heading: "Reports" },
] as const;
const evidenceDirectory = resolve(
  process.cwd(),
  "output",
  "service-simulation",
  "evidence",
);

test("canonical full-day projections reconcile across the operating surfaces", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  await openWorkspace(page, "/today", "Full room, Donald.");
  await expect(page.getByText("96 covers", { exact: true })).toBeVisible();
  await expect(page.getByText("60 seated", { exact: true })).toBeVisible();
  await expect(page.getByText("$5,460", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("17 of 17 tables occupied", { exact: true })).toBeVisible();

  await openWorkspace(page, "/reservations", /^Saturday, April 18/);
  await expect(page.getByText(/60 seated · 0 remaining/)).toBeVisible();

  await openWorkspace(page, "/service", "Service control");
  await expect(page.getByText("Oysters du Jour", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("86", { exact: true }).last()).toBeVisible();

  await openWorkspace(page, "/income", "Income");
  await expect(page.getByText("$5,460", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("29 checks · 96 covers", { exact: true })).toBeVisible();

  await openWorkspace(page, "/closeout", "Closeout & tips");
  await expect(page.getByText("$5,460", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel(/Expected cash/)).toHaveValue("552.00");
  await expect(page.getByLabel(/Actual cash/)).toHaveValue("552.00");

  await openWorkspace(page, "/reports", "Reports");
  await expect(
    page.getByText("Local replay passed · release blocked", { exact: true }),
  ).toBeVisible();
});

test("captures numbered phase evidence and blocks serious accessibility defects", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  mkdirSync(evidenceDirectory, { recursive: true });

  for (const surface of phaseSurfaces) {
    await openWorkspace(page, surface.path, surface.heading);
    await expectNoBlockingAxeViolations(page);
    const screenshotPath = resolve(
      evidenceDirectory,
      `${surface.number}-${surface.slug}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(`${surface.number}-${surface.slug}`, {
      path: screenshotPath,
      contentType: "image/png",
    });
  }
});

test("Today and Host stay within phone and tablet viewports", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 760, path: "/today", heading: "Full room, Donald." },
    { width: 390, height: 844, path: "/today", heading: "Full room, Donald." },
    { width: 1024, height: 768, path: "/reservations", heading: /^Saturday, April 18/ },
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openWorkspace(page, viewport.path, viewport.heading);
    await expectNoViewportOverflow(page);
  }
});

test("keyboard navigation reaches the authoritative Host view", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  await openWorkspace(page, "/today", "Full room, Donald.");
  const hostLink = page.getByRole("link", { name: "Open reservations" });
  await hostLink.focus();
  await expect(hostLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^Saturday, April 18/ })).toBeVisible();
});

test("a slow document response still reaches current scenario state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  await page.route("**/today", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });
  await openWorkspace(page, "/today", "Full room, Donald.");
  await expect(page.getByText("Synthetic preview", { exact: true })).toBeVisible();
  await expect(page.getByText(/Fixed at 8:00 PM · 2026-04-18/).first()).toBeVisible();
});

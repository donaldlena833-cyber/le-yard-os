import { test } from "@playwright/test";

import { expectNoBlockingAxeViolations } from "../a11y/axe";
import { openWorkspace } from "./helpers/workspace";

const keyRoutes: Array<{ path: string; heading: string }> = [
  { path: "/today", heading: "Good afternoon, Donald." },
  { path: "/schedule", heading: "Dinner schedule" },
  { path: "/messages", heading: "Stay close to service" },
  { path: "/time-clock", heading: "Time, without the guesswork" },
  { path: "/receipts", heading: "Receipts & invoices" },
  { path: "/inventory", heading: "Inventory" },
  { path: "/guests", heading: "Guestbook" },
  { path: "/team", heading: "Your whole team, in one place" },
  { path: "/closeout", heading: "Closeout & tips" },
  { path: "/reports", heading: "Reports" },
];

for (const route of keyRoutes) {
  test(`${route.path} has no serious or critical axe violations`, async ({ page }) => {
    await openWorkspace(page, route.path, route.heading);
    await expectNoBlockingAxeViolations(page);
  });
}

import { test } from "@playwright/test";

import { expectNoBlockingAxeViolations } from "../a11y/axe";
import { openWorkspace } from "./helpers/workspace";

const keyRoutes: Array<{ path: string; heading: string | RegExp }> = [
  { path: "/today", heading: "Good afternoon, Donald." },
  { path: "/schedule", heading: "Dinner schedule" },
  { path: "/messages", heading: "Stay close to service" },
  { path: "/service", heading: "Service control" },
  {
    path: "/reservations",
    heading: /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), /,
  },
  { path: "/reservations/setup", heading: "Reservation setup" },
  { path: "/vendors", heading: "Vendors & prices" },
  { path: "/receipts", heading: "Receipts & invoices" },
  { path: "/inventory", heading: "Inventory" },
  { path: "/guests", heading: "Guestbook" },
  { path: "/team", heading: "Your whole team, in one place" },
  { path: "/closeout", heading: "Closeout & tips" },
  { path: "/income", heading: "Income" },
  { path: "/reports", heading: "Reports" },
];

for (const route of keyRoutes) {
  test(`${route.path} has no serious or critical axe violations`, async ({
    page,
  }) => {
    await openWorkspace(page, route.path, route.heading);
    await expectNoBlockingAxeViolations(page);
  });
}

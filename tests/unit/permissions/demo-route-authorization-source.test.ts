import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routePages = [
  "closeout",
  "earnings",
  "income",
  "inventory",
  "kitchen",
  "messages",
  "receipts",
  "schedule",
  "service",
  "tasks",
  "team",
  "time-clock",
  "today",
  "vendors",
] as const;

describe("demo route authorization ordering", () => {
  it.each(routePages)("authorizes /%s before branching to demo data", (route) => {
    const source = readFileSync(
      resolve(process.cwd(), "src", "app", "(workspace)", route, "page.tsx"),
      "utf8",
    );
    const authorizationIndex = source.indexOf("requireWorkspaceRouteAccess(");
    const demoBranchIndex = source.indexOf('resolution.context.mode === "demo"');

    expect(authorizationIndex).toBeGreaterThan(-1);
    if (demoBranchIndex >= 0) {
      expect(authorizationIndex).toBeLessThan(demoBranchIndex);
    }
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env.server", () => ({
  getServerRuntimeConfiguration: () => ({ ready: true, mode: "connected" }),
}));
vi.mock("@/app/api/exports/reports/live-report-request", () => ({
  liveReportFromRequest: async () => ({
    error: "Sign in to export a report.",
    status: 401,
  }),
  beginInlineReportExport: vi.fn(),
  finalizeInlineReportExport: vi.fn(),
}));

import { GET as exportCsv } from "@/app/api/exports/reports/csv/route";
import { GET as exportPdf } from "@/app/api/exports/reports/pdf/route";

const validReportUrl =
  "https://ops.example.com/api/exports/reports/FORMAT?kind=tips&locationId=all&startsOn=2026-07-01&endsOn=2026-08-01";

describe("connected report export boundary", () => {
  it.each([
    ["csv", exportCsv],
    ["pdf", exportPdf],
  ])("never falls back to demo records for an unauthorized live %s export", async (format, handler) => {
    const response = await handler(
      new Request(validReportUrl.replace("FORMAT", format)),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: "Sign in to export a report.",
    });
  });
});

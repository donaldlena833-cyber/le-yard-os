import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveTodayWorkspace } from "@/components/today/live-today-workspace";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Connected Owner",
    email: "owner@example.com",
    aal: "aal2",
  },
  organization: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Connected Restaurant",
  },
  activeLocation: {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Main Dining Room",
    isPrimary: true,
  },
  locations: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      organizationId: "20000000-0000-4000-8000-000000000001",
      name: "Main Dining Room",
      isPrimary: true,
    },
  ],
  availableWorkspaces: [],
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "owner",
  organizationWide: true,
};

describe("connected Today UI", () => {
  it("renders honest empty states without leaking showcase records", () => {
    const markup = renderToStaticMarkup(
      <LiveTodayWorkspace
        workspace={workspace}
        model={{
          ok: true,
          data: {
            date: "2026-08-01",
            timeZone: "America/New_York",
            currencyCode: "USD",
            shifts: [],
            scheduledCount: 0,
            openShiftCount: 0,
            clockedInCount: 0,
            openPunchCount: 0,
            tasks: [],
            openTaskCount: 0,
            announcements: [],
            closeout: null,
            pendingInventoryCounts: 0,
            configuredParLevels: 0,
          },
        }}
      />,
    );

    expect(markup).toContain("Live · Main Dining Room");
    expect(markup).toContain("No visible shifts today");
    expect(markup).toContain("No live announcements yet");
    expect(markup).toContain("No closeout has been filed");
    expect(markup).not.toContain("Maya Chen");
    expect(markup).not.toContain("Japanese whisky");
  });

  it("renders a safe connected-data error instead of the demo dashboard", () => {
    const markup = renderToStaticMarkup(
      <LiveTodayWorkspace
        workspace={workspace}
        model={{ ok: false, message: "Live records could not be loaded." }}
      />,
    );

    expect(markup).toContain("Today is temporarily unavailable");
    expect(markup).toContain("Live records could not be loaded.");
    expect(markup).not.toContain("Dinner has 86 covers");
  });
});

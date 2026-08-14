import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveTodayWorkspace } from "@/components/today/live-today-workspace";
import type { ServiceDaySnapshot } from "@/data/read-models/service-day-snapshot";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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
  capabilities: [],
};

const emptySnapshot: ServiceDaySnapshot = {
  scope: {
    organizationId: workspace.organization.id,
    locationId: workspace.activeLocation.id,
    membershipId: workspace.membershipId,
    role: workspace.role,
    workMode: "owner_operator",
    businessDate: "2026-08-01",
  },
  observedAt: "2026-08-01T16:00:00.000Z",
  activeJob: null,
  today: {
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
  serviceControl: { ok: false, message: "Service control unavailable." },
  nowAction: null,
  orderedExceptions: [
    {
      id: "service_control:unavailable",
      order: 1,
      source: "service_control",
      label: "Service control unavailable",
      detail: "Availability and pre-shift state could not be refreshed.",
      count: 1,
      urgency: "attention",
      destination: "/service",
    },
  ],
  sourceFreshness: [
    {
      source: "today",
      state: "fresh",
      observedAt: "2026-08-01T16:00:00.000Z",
      staleAt: "2026-08-01T16:01:00.000Z",
      maxAgeSeconds: 60,
    },
    {
      source: "service_control",
      state: "unavailable",
      observedAt: null,
      staleAt: null,
      maxAgeSeconds: null,
    },
    {
      source: "reservations",
      state: "restricted",
      observedAt: null,
      staleAt: null,
      maxAgeSeconds: null,
    },
    {
      source: "providers",
      state: "restricted",
      observedAt: null,
      staleAt: null,
      maxAgeSeconds: null,
    },
  ],
  realtime: {
    state: "snapshot_only",
    transport: "server_request",
    lastEventAt: null,
    detail:
      "The server snapshot remains authoritative; connected clients may attach scoped invalidation and refresh this route.",
  },
  providerHealth: { state: "restricted", providers: [] },
};

describe("connected Today UI", () => {
  it("renders honest empty states without leaking showcase records", () => {
    const markup = renderToStaticMarkup(
      <LiveTodayWorkspace
        workspace={workspace}
        snapshot={{ ok: true, data: emptySnapshot }}
      />,
    );

    expect(markup).toContain("Connected · Main Dining Room");
    expect(markup).toContain("Realtime: scoped invalidation");
    expect(markup).toContain("Provider sync evidence: restricted");
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
        snapshot={{ ok: false, message: "Live records could not be loaded." }}
      />,
    );

    expect(markup).toContain("Today is temporarily unavailable");
    expect(markup).toContain("Live records could not be loaded.");
    expect(markup).not.toContain("Dinner has 86 covers");
  });
});

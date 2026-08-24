import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveReportsWorkspace } from "@/components/reports/live-reports-workspace";
import type { LiveReportsModel } from "@/data/read-models/reports";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Owner",
    email: "owner@example.com",
    aal: "aal2",
  },
  organization: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Le Yard",
  },
  activeLocation: {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Le Yard",
    isPrimary: true,
    timeZone: "America/New_York",
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "owner",
  organizationWide: true,
  capabilities: [],
};

const model: LiveReportsModel = {
  generatedAt: "2026-08-24T20:00:00.000Z",
  truncated: false,
  filters: {
    locationId: "30000000-0000-4000-8000-000000000001",
    startsOn: "2026-08-24",
    endsOn: "2026-08-24",
  },
  locations: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      name: "Le Yard",
      timeZone: "America/New_York",
    },
  ],
  view: {
    kind: "labor",
    title: "Labor",
    description: "Recorded labor.",
    sourceLabel: "Time entries",
    freshnessAt: "2026-08-24T19:45:00.000Z",
    coverageNote: "Source rows only.",
    metrics: [],
    columns: [{ key: "person", label: "Team member" }],
    rows: [],
    chart: {
      title: "Labor evidence",
      description: "Recorded rows.",
      points: [],
    },
  },
};

describe("live report timestamp hydration", () => {
  it("renders generated and freshness timestamps in an explicit service timezone", () => {
    const markup = renderToStaticMarkup(
      <LiveReportsWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );
    expect(markup).toContain("Generated Aug 24, 4:00 PM");
    expect(markup).toContain("Source updated Aug 24, 3:45 PM");
    expect(markup).not.toContain("8:00 PM");
  });
});

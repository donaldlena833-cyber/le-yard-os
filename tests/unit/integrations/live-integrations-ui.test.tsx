import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveIntegrationsWorkspace } from "@/components/integrations/live-integrations-workspace";
import type { LiveIntegrationsModel } from "@/data/read-models/integrations";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/actions/workflows/integrations", () => ({
  createManualCsvUploadUrlAction: vi.fn(),
  finalizeManualCsvImportAction: vi.fn(),
  retryIntegrationSyncAction: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
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
  locations: [],
  availableWorkspaces: [],
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "owner",
  organizationWide: true,
};

function model(overrides: Partial<LiveIntegrationsModel> = {}): LiveIntegrationsModel {
  return {
    organizationName: workspace.organization.name,
    locationId: workspace.activeLocation.id,
    locationName: workspace.activeLocation.name,
    role: "owner",
    canManageSettings: true,
    ownerNeedsMfa: false,
    connections: [],
    syncJobs: [],
    importJobs: [],
    events: [],
    auditEvents: [],
    syncRecordEvidenceLimited: false,
    ...overrides,
  };
}

describe("connected integrations UI", () => {
  it("renders an honest empty adapter ledger without demo connection claims", () => {
    const markup = renderToStaticMarkup(
      <LiveIntegrationsWorkspace workspace={workspace} result={{ ok: true, data: model() }} />,
    );

    expect(markup).toContain("Tenant scoped");
    expect(markup).toContain("Main Dining Room");
    expect(markup).toContain("Manual available");
    expect(markup).toContain("No sync jobs yet");
    expect(markup).not.toContain("Toast sales import");
    expect(markup).not.toContain("18m");
  });

  it("renders persisted connection and failed sync evidence", () => {
    const markup = renderToStaticMarkup(
      <LiveIntegrationsWorkspace
        workspace={workspace}
        result={{
          ok: true,
          data: model({
            connections: [
              {
                id: "50000000-0000-4000-8000-000000000001",
                provider: "toast",
                displayName: "Dining Room Toast",
                adapterVersion: "toast-v1",
                status: "degraded",
                capabilities: ["sales"],
                locationId: workspace.activeLocation.id,
                scopeLabel: workspace.activeLocation.name,
                lastSyncedAt: null,
                createdAt: "2026-08-01T12:00:00.000Z",
                updatedAt: "2026-08-01T12:00:00.000Z",
              },
            ],
            syncJobs: [
              {
                id: "60000000-0000-4000-8000-000000000001",
                connectionId: "50000000-0000-4000-8000-000000000001",
                provider: "toast",
                connectionName: "Dining Room Toast",
                direction: "import",
                resourceType: "sales",
                status: "failed",
                attempts: 2,
                maxAttempts: 5,
                nextAttemptAt: null,
                recordsProcessed: 0,
                recordOutcomes: {},
                errorMessage: "Partner endpoint timed out; token=[redacted]",
                startedAt: "2026-08-01T12:00:00.000Z",
                completedAt: "2026-08-01T12:01:00.000Z",
                createdAt: "2026-08-01T12:00:00.000Z",
                updatedAt: "2026-08-01T12:01:00.000Z",
                canRetry: true,
              },
            ],
          }),
        }}
      />,
    );

    expect(markup).toContain("Dining Room Toast");
    expect(markup).toContain("Degraded");
    expect(markup).toContain("Partner endpoint timed out; token=[redacted]");
    expect(markup).toContain("Retry");
  });

  it("fails closed instead of falling back to demo data", () => {
    const markup = renderToStaticMarkup(
      <LiveIntegrationsWorkspace
        workspace={workspace}
        result={{ ok: false, message: "Management access is required." }}
      />,
    );
    expect(markup).toContain("Integration records unavailable");
    expect(markup).toContain("Management access is required.");
    expect(markup).not.toContain("synthetic row");
  });
});

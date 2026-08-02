import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveTasksWorkspace } from "@/components/tasks/live-tasks-workspace";
import type { LiveOperationsModel } from "@/data/read-models/operations";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/actions/workflows/operations", () => ({
  acknowledgeSopAction: vi.fn(),
  completeChecklistRunAction: vi.fn(),
  createChecklistEvidenceUploadUrlAction: vi.fn(),
  createChecklistTemplateVersionAction: vi.fn(),
  createIncidentAction: vi.fn(),
  createMaintenanceRequestAction: vi.fn(),
  createTaskAction: vi.fn(),
  createSopDraftAction: vi.fn(),
  createSopVersionAction: vi.fn(),
  publishChecklistTemplateAction: vi.fn(),
  publishSopVersionAction: vi.fn(),
  recordChecklistResponseAction: vi.fn(),
  setIncidentStatusAction: vi.fn(),
  setMaintenanceStatusAction: vi.fn(),
  startChecklistRunAction: vi.fn(),
  transitionTaskAction: vi.fn(),
  updateSopDraftAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/files", () => ({
  createPrivateFileDownloadUrlAction: vi.fn(),
}));

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Connected Manager",
    email: "manager@example.com",
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
  role: "manager",
  organizationWide: false,
};

const emptyModel: LiveOperationsModel = {
  date: "2026-08-01",
  loadedAt: "2026-08-01T16:00:00.000Z",
  timeZone: "America/New_York",
  currencyCode: "USD",
  currentEmployeeId: "50000000-0000-4000-8000-000000000001",
  assignees: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      name: "Connected Manager",
    },
    {
      id: "50000000-0000-4000-8000-000000000002",
      name: "Maris",
    },
  ],
  tasks: [],
  checklistTemplates: [],
  checklistRuns: [],
  sops: [],
  maintenance: [],
  incidents: [],
};

describe("connected Operations UI", () => {
  it("renders honest tenant-scoped empty states and management command controls", () => {
    const markup = renderToStaticMarkup(
      <LiveTasksWorkspace
        workspace={workspace}
        result={{ ok: true, data: emptyModel }}
      />,
    );

    expect(markup).toContain("Connected");
    expect(markup).toContain("Management controls");
    expect(markup).toContain("Main Dining Room");
    expect(markup).toContain("No tasks in this location scope");
    expect(markup).toContain("Create task");
    expect(markup).toContain("server-owned commands");
    expect(markup).not.toContain("Confirm ice machine service window");
    expect(markup).not.toContain("Route 66");
  });

  it("fails closed rather than falling back to demo operations", () => {
    const markup = renderToStaticMarkup(
      <LiveTasksWorkspace
        workspace={workspace}
        result={{ ok: false, message: "Live operations records could not be loaded." }}
      />,
    );

    expect(markup).toContain("Operations unavailable");
    expect(markup).toContain("Live operations records could not be loaded.");
    expect(markup).not.toContain("Today’s work");
    expect(markup).not.toContain("Closing checklist refresh");
  });

  it("derives metrics only from connected rows", () => {
    const markup = renderToStaticMarkup(
      <LiveTasksWorkspace
        workspace={workspace}
        result={{
          ok: true,
          data: {
            ...emptyModel,
            tasks: [
              {
                id: "60000000-0000-4000-8000-000000000001",
                title: "Verify patio handoff",
                description: "Confirm the recorded handoff is complete.",
                status: "open",
                priority: "high",
                assignedEmployeeId: null,
                assigneeName: null,
                dueAt: "2026-08-01T15:00:00.000Z",
                completedAt: null,
                completedByName: null,
                createdAt: "2026-08-01T12:00:00.000Z",
                sourceType: null,
              },
            ],
          },
        }}
      />,
    );

    expect(markup).toContain("Verify patio handoff");
    expect(markup).toContain("1 overdue by recorded due time");
    expect(markup).toContain("Unassigned");
  });
});

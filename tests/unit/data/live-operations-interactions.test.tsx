// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeSopAction,
  createTaskAction,
  startChecklistRunAction,
  transitionTaskAction,
} from "@/app/actions/workflows/operations";
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

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const channel = { on: vi.fn(), subscribe: vi.fn() };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    return { channel: vi.fn(() => channel), removeChannel: vi.fn() };
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Connected Employee",
    email: "employee@example.com",
    aal: "aal1",
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
  role: "employee",
  organizationWide: false,
  capabilities: [],
};

const model: LiveOperationsModel = {
  date: "2026-08-01",
  loadedAt: "2026-08-01T16:00:00.000Z",
  timeZone: "America/New_York",
  currencyCode: "USD",
  currentEmployeeId: "50000000-0000-4000-8000-000000000001",
  assignees: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      name: "Connected Employee",
    },
  ],
  tasks: [],
  checklistTemplates: [
    {
      id: "60000000-0000-4000-8000-000000000001",
      name: "Opening room check",
      checklistType: "opening",
      version: 2,
      active: true,
      itemCount: 1,
      requiredCount: 1,
      todayRunId: "70000000-0000-4000-8000-000000000001",
    },
  ],
  checklistRuns: [
    {
      id: "70000000-0000-4000-8000-000000000001",
      templateId: "60000000-0000-4000-8000-000000000001",
      templateName: "Opening room check",
      checklistType: "opening",
      templateVersion: 2,
      businessDate: "2026-08-01",
      status: "completed",
      assignedEmployeeId: "50000000-0000-4000-8000-000000000001",
      assigneeName: "Connected Employee",
      startedAt: "2026-08-01T13:00:00.000Z",
      completedAt: "2026-08-01T13:10:00.000Z",
      approvedByName: null,
      approvedAt: null,
      requiredCount: 1,
      requiredResponseCount: 1,
      responseCount: 1,
      items: [
        {
          id: "80000000-0000-4000-8000-000000000001",
          label: "Room reset recorded",
          instructions: "Confirm the room was reviewed.",
          responseType: "checkbox",
          required: true,
          recorded: true,
          response: true,
          responseLabel: "Yes",
          respondedBy: "Connected Employee",
          respondedAt: "2026-08-01T13:09:00.000Z",
          notes: null,
          storagePath: null,
        },
      ],
    },
  ],
  sops: [
    {
      id: "90000000-0000-4000-8000-000000000001",
      title: "Guest arrival procedure",
      category: "Service",
      versionId: "91000000-0000-4000-8000-000000000001",
      version: 3,
      body: "Welcome the guest and verify the reservation details.",
      storagePath: null,
      changeSummary: "Clarified reservation verification.",
      publishedAt: "2026-08-01T12:00:00.000Z",
      isDraft: false,
      documentPublished: true,
      requiresAcknowledgement: true,
      acknowledgementCount: 2,
      acknowledgedByCurrentEmployee: false,
      currentEmployeeAcknowledgedAt: null,
    },
  ],
  maintenance: [],
  incidents: [
    {
      id: "a0000000-0000-4000-8000-000000000001",
      incidentType: "equipment",
      occurredAt: "2026-08-01T15:00:00.000Z",
      description:
        "A small appliance stopped during setup. It was unplugged and moved away from service.",
      severity: "medium",
      status: "investigating",
      reportedBy: "Connected Employee",
      involvedEmployeeNames: [],
      followUp: "Manager review is pending.",
      resolvedBy: null,
      resolvedAt: null,
      createdAt: "2026-08-01T15:05:00.000Z",
    },
  ],
};

const marisEmployeeId = "50000000-0000-4000-8000-000000000002";
const managementModel: LiveOperationsModel = {
  ...model,
  assignees: [...model.assignees, { id: marisEmployeeId, name: "Maris" }],
};

function managementWorkspace(
  role: "owner" | "admin" | "manager",
): WorkspaceContextValue {
  return {
    ...workspace,
    role,
    identity: {
      ...workspace.identity,
      displayName: "Connected Manager",
      email: "manager@example.com",
      aal: "aal2",
    },
  };
}

describe("connected Operations review interactions", () => {
  it("reveals task evidence on demand and opens the selected named transition", async () => {
    vi.mocked(transitionTaskAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {
        id: "a4000000-0000-4000-8000-000000000001",
        status: "completed",
        completedAt: "2026-08-01T16:30:00.000Z",
      },
    });
    const assignedTask: LiveOperationsModel["tasks"][number] = {
      id: "a4000000-0000-4000-8000-000000000001",
      title: "Verify dining room handoff",
      description: "Confirm every section has a named closer.",
      status: "open",
      priority: "high",
      assignedEmployeeId: model.currentEmployeeId,
      assigneeName: "Connected Employee",
      dueAt: "2026-08-01T17:00:00.000Z",
      completedAt: null,
      completedByName: null,
      createdAt: "2026-08-01T15:00:00.000Z",
      sourceType: "manual",
    };

    render(
      <LiveTasksWorkspace
        workspace={workspace}
        result={{ ok: true, data: { ...model, tasks: [assignedTask] } }}
      />,
    );

    expect(
      screen.queryByText("Confirm every section has a named closer."),
    ).toBeNull();
    const disclosure = screen.getByRole("button", {
      name: "Show details for Verify dining room handoff",
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByText("Confirm every section has a named closer."),
    ).toBeTruthy();

    const actions = screen.getByRole("group", {
      name: "Actions for Verify dining room handoff",
    });
    expect(within(actions).getByRole("button", { name: "Start" })).toBeTruthy();
    expect(within(actions).getByRole("button", { name: "Block" })).toBeTruthy();
    expect(
      within(actions).getByRole("button", { name: "Complete" }),
    ).toBeTruthy();
    expect(
      within(actions).queryByRole("button", { name: "Cancel" }),
    ).toBeNull();

    fireEvent.click(within(actions).getByRole("button", { name: "Complete" }));
    const dialog = screen.getByRole("dialog", { name: "Update task" });
    expect(
      (within(dialog).getByLabelText("Next status") as HTMLSelectElement).value,
    ).toBe("completed");
    fireEvent.change(within(dialog).getByLabelText("Transition note"), {
      target: { value: "Closing handoff confirmed." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Update task" }),
    );

    await waitFor(() => expect(transitionTaskAction).toHaveBeenCalledOnce());
    expect(transitionTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: assignedTask.id,
        status: "completed",
        note: "Closing handoff confirmed.",
      }),
    );
  });

  it.each(["owner", "admin", "manager"] as const)(
    "offers the verified location roster to an MFA-ready %s",
    (role) => {
      render(
        <LiveTasksWorkspace
          workspace={managementWorkspace(role)}
          result={{ ok: true, data: managementModel }}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Create task" }));
      const dialog = screen.getByRole("dialog", { name: "Create task" });
      expect(
        within(dialog).getByRole("option", {
          name: "Connected Employee (you)",
        }),
      ).toBeTruthy();
      expect(
        within(dialog).getByRole("option", { name: "Maris" }),
      ).toBeTruthy();
    },
  );

  it("sends the selected verified employee id when management creates a task", async () => {
    vi.mocked(createTaskAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {
        id: "a1000000-0000-4000-8000-000000000001",
        status: "open",
        createdAt: "2026-08-01T16:00:00.000Z",
      },
    });
    render(
      <LiveTasksWorkspace
        workspace={managementWorkspace("manager")}
        result={{ ok: true, data: managementModel }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    const dialog = screen.getByRole("dialog", { name: "Create task" });
    fireEvent.change(within(dialog).getByLabelText("Task title"), {
      target: { value: "Verify dining room handoff" },
    });
    fireEvent.change(within(dialog).getByLabelText("Assignment"), {
      target: { value: marisEmployeeId },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create task" }),
    );

    await waitFor(() => expect(createTaskAction).toHaveBeenCalledOnce());
    expect(createTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: workspace.activeLocation.id,
        title: "Verify dining room handoff",
        assignedEmployeeId: marisEmployeeId,
      }),
    );
  });

  it("uses the verified roster for management checklist assignment", async () => {
    vi.mocked(startChecklistRunAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {
        id: "a2000000-0000-4000-8000-000000000001",
        status: "in_progress",
        startedAt: "2026-08-01T16:00:00.000Z",
      },
    });
    render(
      <LiveTasksWorkspace
        workspace={managementWorkspace("manager")}
        result={{ ok: true, data: managementModel }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Checklists/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
    const dialog = screen.getByRole("dialog", { name: "Start checklist" });
    fireEvent.change(within(dialog).getByLabelText("Template"), {
      target: { value: model.checklistTemplates[0].id },
    });
    fireEvent.change(within(dialog).getByLabelText("Assignment"), {
      target: { value: marisEmployeeId },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run" }));

    await waitFor(() => expect(startChecklistRunAction).toHaveBeenCalledOnce());
    expect(startChecklistRunAction).toHaveBeenCalledWith(
      expect.objectContaining({
        businessDate: model.date,
        assignedEmployeeId: marisEmployeeId,
      }),
    );
  });

  it("keeps employee checklist assignment self-only", async () => {
    vi.mocked(startChecklistRunAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {
        id: "a3000000-0000-4000-8000-000000000001",
        status: "in_progress",
        startedAt: "2026-08-01T16:00:00.000Z",
      },
    });
    render(
      <LiveTasksWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Checklists/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
    const dialog = screen.getByRole("dialog", { name: "Start checklist" });
    expect(within(dialog).queryByLabelText("Assignment")).toBeNull();
    expect(
      within(dialog).getByText(
        "This run will be assigned to your active employee profile.",
      ),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Template"), {
      target: { value: model.checklistTemplates[0].id },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run" }));

    await waitFor(() => expect(startChecklistRunAction).toHaveBeenCalledOnce());
    expect(startChecklistRunAction).toHaveBeenCalledWith(
      expect.objectContaining({ assignedEmployeeId: model.currentEmployeeId }),
    );
  });

  it("shows immutable checklist evidence without enabling completion", async () => {
    render(
      <LiveTasksWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Checklists/ }));

    expect(
      (await screen.findAllByText("Opening room check")).length,
    ).toBeGreaterThan(0);
    expect((await screen.findByText(/Response ·/)).textContent).toContain(
      "Yes",
    );
    expect(await screen.findByText("Evidence locked")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Complete run",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("shows only the published SOP version and records acknowledgement through the server action", async () => {
    vi.mocked(acknowledgeSopAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {
        id: "92000000-0000-4000-8000-000000000001",
        acknowledgedAt: "2026-08-01T16:00:00.000Z",
      },
    });
    render(
      <LiveTasksWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /SOPs/ }));

    expect(
      (await screen.findAllByText("Guest arrival procedure")).length,
    ).toBeGreaterThan(0);
    expect(
      await screen.findByText(
        "Welcome the guest and verify the reservation details.",
      ),
    ).toBeTruthy();
    const acknowledge = screen.getByRole("button", { name: "Acknowledge v3" });
    expect((acknowledge as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(acknowledge);
    expect(await screen.findByText("SOP v3 acknowledged.")).toBeTruthy();
    expect(acknowledgeSopAction).toHaveBeenCalledOnce();
  });

  it("keeps incident details concealed until an authorized record is selected", async () => {
    render(
      <LiveTasksWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Incidents/ }));
    expect(await screen.findByText("Details stay concealed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Equipment/ }));
    expect(screen.getByText("Manager review is pending.")).toBeTruthy();
    expect(screen.getByText(/manager-only and server stamped/)).toBeTruthy();
  });
});

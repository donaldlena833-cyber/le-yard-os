// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewPrepCompletionAction } from "@/app/actions/workflows/prep";
import { LivePrepWorkspace } from "@/components/prep/live-prep-workspace";
import type { LivePrepModel, LivePrepTask } from "@/data/read-models/prep";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/actions/workflows/prep", () => ({
  completePrepTaskAction: vi.fn(),
  correctPrepCompletionAction: vi.fn(),
  previewPrepCompletionAction: vi.fn(),
  savePrepTaskAction: vi.fn(),
  transitionPrepTaskAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Prep Manager",
    email: "prep@example.com",
    aal: "aal2",
  },
  organization: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Le Yard",
  },
  activeLocation: {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Main Dining Room",
    isPrimary: true,
    timeZone: "America/New_York",
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "manager",
  organizationWide: false,
  capabilities: ["prep.complete"],
};

function task(
  id: string,
  recipeName: string,
  targetQuantity: number,
): LivePrepTask {
  return {
    id,
    businessDate: "2026-08-24",
    servicePeriod: "prep",
    station: "Garde manger",
    recipeId: id,
    recipeName,
    outputInventoryItemId: null,
    outputItemName: null,
    targetQuantity,
    targetUnitId: "50000000-0000-4000-8000-000000000001",
    targetUnitSymbol: "qt",
    dueAt: "2026-08-24T20:00:00.000Z",
    assigneeUserId: null,
    assigneeName: null,
    state: "in_progress",
    actualYield: null,
    note: null,
    stockOverride: false,
    stockWarnings: [],
    version: 3,
    completionNote: null,
    correctionNote: null,
  };
}

const model: LivePrepModel = {
  date: "2026-08-24",
  timeZone: "America/New_York",
  tasks: [task("task-a", "Tomato conserva", 10), task("task-b", "Herb oil", 20)],
  recipes: [],
  outputItems: [],
  units: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      name: "Quart",
      symbol: "qt",
    },
  ],
  assignees: [],
};

describe("Prep completion task isolation", () => {
  it("clears one task yield before reviewing another task", async () => {
    vi.mocked(previewPrepCompletionAction).mockImplementation(async (input) => {
      const value = input as { taskId: string; actualYield: number };
      return {
        ok: true,
        persisted: false,
        mode: "live",
        data: {
          task_id: value.taskId,
          version: 3,
          actual_yield: value.actualYield,
          has_shortage: false,
          movements: [],
        },
      };
    });

    render(
      <LivePrepWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );

    const firstYield = screen.getByLabelText("Actual yield for Tomato conserva");
    const secondYield = screen.getByLabelText("Actual yield for Herb oil");
    fireEvent.focus(firstYield);
    fireEvent.change(firstYield, { target: { value: "7.5" } });
    expect(firstYield).toHaveProperty("value", "7.5");

    fireEvent.focus(secondYield);
    expect(firstYield).toHaveProperty("value", "");
    expect(secondYield).toHaveProperty("value", "20");
    fireEvent.click(screen.getAllByRole("button", { name: "Review completion" })[1]!);

    await waitFor(() =>
      expect(previewPrepCompletionAction).toHaveBeenCalledWith({
        taskId: "task-b",
        actualYield: 20,
      }),
    );
  });
});

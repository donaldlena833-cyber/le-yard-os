// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { previewPrepCompletionAction, transitionPrepTaskAction } from "@/app/actions/workflows/prep";
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
    formulaCapturedAt: "2026-08-24T14:00:00.000Z",
    formulaRecipeVersion: 2,
    needsFormulaReview: false,
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
    expect(secondYield).toHaveProperty("value", "");
    fireEvent.change(secondYield, { target: { value: "17" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Review completion" })[1]!);

    await waitFor(() =>
      expect(previewPrepCompletionAction).toHaveBeenCalledWith({
        taskId: "task-b",
        actualYield: 17,
      }),
    );
  });
});


describe("Prep formula review", () => {
  it("shows the captured recipe version", () => {
    render(<LivePrepWorkspace workspace={workspace} result={{ ok: true, data: { ...model, tasks: [model.tasks[0]!] } }} />);
    expect(screen.getByText(/Recipe v2/)).toBeTruthy();
  });

  it("withholds start and completion for an unreviewed legacy task", () => {
    const legacy = { ...model.tasks[0]!, state: "published" as const, formulaCapturedAt: null, formulaRecipeVersion: null, needsFormulaReview: true };
    render(<LivePrepWorkspace workspace={workspace} result={{ ok: true, data: { ...model, tasks: [legacy] } }} />);
    expect(screen.getByText(/manager must review the current formula/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review completion" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review existing formula" })).toBeNull();
  });

  it("requires a manager confirmation before adopting a legacy formula", async () => {
    vi.mocked(transitionPrepTaskAction).mockResolvedValue({ ok: true, persisted: true, mode: "live", data: { id: "task-a", state: "published", version: 4 } });
    const legacy = { ...model.tasks[0]!, state: "published" as const, formulaCapturedAt: null, formulaRecipeVersion: null, needsFormulaReview: true };
    render(<LivePrepWorkspace workspace={{ ...workspace, capabilities: ["prep.manage", "prep.complete"] }} result={{ ok: true, data: { ...model, tasks: [legacy] } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Review existing formula" }));
    expect(transitionPrepTaskAction).not.toHaveBeenCalled();
    expect(screen.getByText(/checking the station instructions and any prep already done/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Capture reviewed formula" }));
    await waitFor(() => expect(transitionPrepTaskAction).toHaveBeenCalledWith({ requestId: expect.any(String), taskId: "task-a", expectedVersion: 3, command: "bind_formula" }));
    expect(previewPrepCompletionAction).not.toHaveBeenCalled();
  });
});


describe("Measured prep yield entry", () => {
  it("does not substitute the planned target for an empty actual yield", () => {
    render(<LivePrepWorkspace workspace={workspace} result={{ ok: true, data: { ...model, tasks: [model.tasks[0]!] } }} />);
    const input = screen.getByLabelText("Actual yield for Tomato conserva");
    fireEvent.focus(input);
    expect(input).toHaveProperty("value", "");
    fireEvent.click(screen.getByRole("button", { name: "Review completion" }));
    expect(screen.getByText("Enter an actual yield greater than zero.")).toBeTruthy();
    expect(previewPrepCompletionAction).not.toHaveBeenCalled();
  });

  it("accepts the first typed measured yield without prefixing the planned quantity", async () => {
    vi.mocked(previewPrepCompletionAction).mockImplementation(async (input) => {
      const value = input as { taskId: string; actualYield: number };
      return { ok: true, persisted: false, mode: "live", data: { task_id: value.taskId, version: 3, actual_yield: value.actualYield, has_shortage: false, movements: [] } };
    });
    const user = userEvent.setup();
    render(<LivePrepWorkspace workspace={workspace} result={{ ok: true, data: { ...model, tasks: [model.tasks[0]!] } }} />);
    const input = screen.getByLabelText("Actual yield for Tomato conserva");
    await user.click(input);
    await user.type(input, "0.5");
    expect(input).toHaveProperty("value", "0.5");
    await user.click(screen.getByRole("button", { name: "Review completion" }));
    await waitFor(() => expect(previewPrepCompletionAction).toHaveBeenCalledWith({ taskId: "task-a", actualYield: 0.5 }));
  });
});


describe("Posted prep review", () => {
  it("keeps recorded actual yield visible beside the original target", () => {
    const posted = { ...model.tasks[0]!, state: "completed" as const, actualYield: 0.5 };
    render(<LivePrepWorkspace workspace={workspace} result={{ ok: true, data: { ...model, tasks: [posted] } }} />);
    expect(screen.getByText("Recorded yield: 0.5 qt")).toBeTruthy();
    expect(screen.getByText(/Target 10 qt/)).toBeTruthy();
  });

  it("identifies the calendar date and restaurant timezone of an overnight deadline", () => {
    const overnight = { ...model.tasks[0]!, dueAt: "2026-08-25T05:30:00Z" };
    render(<LivePrepWorkspace workspace={workspace} result={{ ok: true, data: { ...model, tasks: [overnight] } }} />);
    expect(screen.getByText(/due Aug 25, 1:30.*EDT/)).toBeTruthy();
  });
});

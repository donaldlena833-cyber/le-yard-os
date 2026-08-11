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

import { LiveScheduleWorkspace } from "@/components/schedule/live-schedule-workspace";
import type { LiveScheduleModel } from "@/data/read-models/schedule";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import {
  reopenLiveShiftAction,
  requestLiveShiftSwapAction,
} from "@/app/actions/workflows/live-schedule";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  KeyboardSensor: class KeyboardSensor {},
  PointerSensor: class PointerSensor {},
  closestCenter: vi.fn(),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Translate: { toString: vi.fn(() => undefined) } },
}));

vi.mock("@/app/actions/workflows/live-schedule", () => ({
  claimLiveOpenShiftAction: vi.fn(),
  createLiveScheduleAction: vi.fn(),
  createLiveShiftAction: vi.fn(),
  decideLiveShiftSwapAction: vi.fn(),
  editLiveShiftAction: vi.fn(),
  moveLiveShiftAction: vi.fn(),
  offerLiveShiftSwapAction: vi.fn(),
  reopenLiveShiftAction: vi.fn(),
  requestLiveShiftSwapAction: vi.fn(),
  saveLiveScheduleTemplateAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/schedule", () => ({
  acknowledgeShiftAction: vi.fn(),
  publishScheduleAction: vi.fn(),
}));

const organizationId = "20000000-0000-4000-8000-000000000001";
const locationId = "30000000-0000-4000-8000-000000000001";
const shiftId = "70000000-0000-4000-8000-000000000001";

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Connected Manager",
    email: "manager@example.com",
    aal: "aal1",
  },
  organization: { id: organizationId, name: "Connected Restaurant" },
  activeLocation: {
    id: locationId,
    organizationId,
    name: "Main Dining Room",
    isPrimary: true,
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "80000000-0000-4000-8000-000000000001",
  role: "manager",
  organizationWide: false,
  capabilities: ["schedule.manage"],
};

const model: LiveScheduleModel = {
  weekStart: "2026-08-10",
  previousWeek: "2026-08-03",
  nextWeek: "2026-08-17",
  weekDates: [
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
    "2026-08-16",
  ],
  timeZone: "America/New_York",
  canManage: true,
  canPublish: false,
  selfEmployeeId: null,
  schedule: {
    id: "60000000-0000-4000-8000-000000000001",
    status: "draft",
    version: 3,
    publishedAt: null,
  },
  shifts: [
    {
      id: shiftId,
      employeeId: "40000000-0000-4000-8000-000000000001",
      employeeName: "Aisha R.",
      jobRoleId: "50000000-0000-4000-8000-000000000001",
      jobName: "Server",
      startsAt: "2026-08-10T20:00:00.000Z",
      endsAt: "2026-08-11T03:00:00.000Z",
      date: "2026-08-10",
      startLabel: "4:00 PM",
      endLabel: "11:00 PM",
      startLocal: "16:00",
      endLocal: "23:00",
      breakMinutes: 30,
      status: "scheduled",
      isOpen: false,
      notes: null,
      acknowledged: false,
    },
  ],
  employees: [{ id: "40000000-0000-4000-8000-000000000001", name: "Aisha R." }],
  jobRoles: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      name: "Server",
      code: "SERVER",
    },
  ],
  templates: [],
  swaps: [],
};

afterEach(cleanup);

describe("connected schedule responsive workflow", () => {
  it("keeps mobile editing available without drag and uses the shared modal", async () => {
    render(
      <LiveScheduleWorkspace
        workspace={workspace}
        model={{ ok: true, data: model }}
      />,
    );

    const agenda = screen.getByLabelText("Weekly schedule agenda");
    const edit = within(agenda).getByRole("button", {
      name: "Edit Aisha R. shift",
    });
    edit.focus();
    fireEvent.click(edit);

    expect(screen.getByRole("dialog", { name: "Edit shift" })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Date")),
    );

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(edit);
  });

  it("opens a labelled swap form from the employee object action", async () => {
    vi.mocked(requestLiveShiftSwapAction).mockResolvedValue({
      ok: true,
      persisted: true,
    } as never);
    const employeeWorkspace: WorkspaceContextValue = {
      ...workspace,
      role: "employee",
      capabilities: [],
      activeJob: { name: "Server", code: "SERVER", department: "FOH" },
    };
    const publishedModel: LiveScheduleModel = {
      ...model,
      canManage: false,
      selfEmployeeId: model.shifts[0]!.employeeId,
      schedule: { ...model.schedule!, status: "published" },
    };

    render(
      <LiveScheduleWorkspace
        workspace={employeeWorkspace}
        model={{ ok: true, data: publishedModel }}
      />,
    );

    const agenda = screen.getByLabelText("Weekly schedule agenda");
    expect(
      within(agenda).getByRole("button", {
        name: "Acknowledge Aisha R. shift",
      }),
    ).toBeTruthy();
    const requestSwap = within(agenda).getByRole("button", {
      name: "Request swap for Aisha R. shift",
    });
    fireEvent.click(requestSwap);

    const dialog = screen.getByRole("dialog", { name: "Request shift swap" });
    const reason = within(dialog).getByLabelText(/Reason/);
    await waitFor(() => expect(document.activeElement).toBe(reason));
    fireEvent.change(reason, { target: { value: "Family commitment" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );

    await waitFor(() =>
      expect(requestLiveShiftSwapAction).toHaveBeenCalledWith(
        expect.objectContaining({
          shiftId,
          reason: "Family commitment",
          requestId: expect.any(String),
        }),
      ),
    );
  });

  it("confirms a manager reopen action before changing coverage", async () => {
    vi.mocked(reopenLiveShiftAction).mockResolvedValue({
      ok: true,
      persisted: true,
    } as never);
    const publishedModel: LiveScheduleModel = {
      ...model,
      schedule: { ...model.schedule!, status: "published" },
    };

    render(
      <LiveScheduleWorkspace
        workspace={workspace}
        model={{ ok: true, data: publishedModel }}
      />,
    );

    const agenda = screen.getByLabelText("Weekly schedule agenda");
    const reopen = within(agenda).getByRole("button", {
      name: "Reopen Aisha R. shift for coverage",
    });
    fireEvent.click(reopen);

    const dialog = screen.getByRole("alertdialog", {
      name: "Reopen this shift for coverage?",
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reopen shift" }),
    );

    await waitFor(() =>
      expect(reopenLiveShiftAction).toHaveBeenCalledWith(
        expect.objectContaining({ shiftId, requestId: expect.any(String) }),
      ),
    );
  });
});

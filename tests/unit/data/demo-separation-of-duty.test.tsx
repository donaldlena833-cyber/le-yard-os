// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloseoutWorkspace } from "@/components/closeout/closeout-workspace";
import { WorkspaceProvider } from "@/components/providers/workspace-provider";
import { ScheduleWorkspace } from "@/components/schedule/schedule-workspace";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { demoIds } from "@/lib/demo";

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  PointerSensor: class {},
  TouchSensor: class {},
  closestCenter: vi.fn(),
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, isDragging: false }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(),
  useSensors: () => [],
}));

const organizationId = demoIds.organization;
const location = {
  id: demoIds.locations.garden,
  organizationId,
  name: "Le Yard",
  isPrimary: true,
};
const owner: WorkspaceContextValue = {
  mode: "demo",
  identity: {
    userId: demoIds.people.donald,
    displayName: "Donald Lena",
    email: null,
    aal: "aal1",
  },
  organization: { id: organizationId, name: "Le Yard" },
  activeLocation: location,
  locations: [location],
  availableWorkspaces: [],
  membershipId: "membership-donald",
  role: "owner",
  organizationWide: true,
  capabilities: [],
};

afterEach(cleanup);

describe("demo separation of duties", () => {
  it("does not let the closeout submitter approve their own submission", async () => {
    render(
      <WorkspaceProvider value={owner}>
        <CloseoutWorkspace />
      </WorkspaceProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    await screen.findByText(/Tip pool calculated and reconciled exactly/i);
    fireEvent.click(screen.getByRole("button", { name: "Submit closeout" }));

    const approve = await screen.findByRole("button", { name: "Owner approve" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Submitted by Donald Lena · a different owner must approve/i)).toBeTruthy();
  });

  it("does not let an owner attest for Mateo's shift", async () => {
    render(
      <WorkspaceProvider value={owner}>
        <ScheduleWorkspace />
      </WorkspaceProvider>,
    );

    const mateoShift = screen.getAllByRole("button").find((button) =>
      /Mateo[\s\S]*Kitchen[\s\S]*2:00p[\s\S]*10:00p/.test(button.textContent ?? ""),
    );
    expect(mateoShift).toBeTruthy();
    fireEvent.click(mateoShift!);

    await waitFor(() => expect(screen.getByText(/Only Mateo can acknowledge this shift/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Acknowledge shift" })).toBeNull();
  });
});

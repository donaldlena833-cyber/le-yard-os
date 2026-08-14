// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReservationSetupWorkspace } from "@/components/reservations/reservation-setup-workspace";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createDemoReservationModel } from "@/lib/reservations/demo";
import type {
  ReservationHostPermissions,
} from "@/lib/reservations/model";
import type { ServiceShiftManagementModel } from "@/lib/reservations/service-shift-management";

const mocks = vi.hoisted(() => ({
  approveDraft: vi.fn(),
  configureException: vi.fn(),
  installDraft: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  revokeException: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/app/actions/workflows/reservations", () => ({
  approveReservationDraftAction: mocks.approveDraft,
  configureServiceShiftExceptionAction: mocks.configureException,
  installReservationDraftAction: mocks.installDraft,
  revokeServiceShiftExceptionAction: mocks.revokeException,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseWorkspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Service manager",
    email: "manager@example.com",
    aal: "aal2",
  },
  organization: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Le Yard",
  },
  activeLocation: {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Main dining room",
    isPrimary: true,
    timeZone: "America/New_York",
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "manager",
  organizationWide: false,
  capabilities: [],
};

const serviceShifts: ServiceShiftManagementModel = {
  businessDate: "2026-08-11",
  timeZone: "America/New_York",
  shifts: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      servicePeriodId: "60000000-0000-4000-8000-000000000001",
      name: "Dinner",
      businessDate: "2026-08-11",
      startsAt: "2026-08-11T21:00:00.000Z",
      endsAt: "2026-08-12T06:00:00.000Z",
      defaultDurationMinutes: 90,
      pacingIntervalMinutes: 15,
      pacingCoverLimit: 14,
      minPartySize: 1,
      maxPartySize: 10,
      onlineEnabled: false,
      status: "scheduled",
      configurationState: "approved",
      exceptions: [
        {
          id: "70000000-0000-4000-8000-000000000001",
          kind: "closure",
          status: "active",
          startsAt: "2026-08-11T23:00:00.000Z",
          endsAt: "2026-08-12T01:00:00.000Z",
          pacingIntervalMinutes: null,
          pacingCoverLimit: null,
          openingBufferMinutes: null,
          closingBufferMinutes: null,
          reason: "Private event",
        },
      ],
    },
  ],
};

function renderControls(permissions: ReservationHostPermissions) {
  const model = createDemoReservationModel(
    serviceShifts.businessDate,
    permissions,
  );
  return render(
    <ReservationSetupWorkspace
      workspace={{
        ...baseWorkspace,
        capabilities: [
          ...(permissions.override
            ? (["reservations.override"] as const)
            : []),
          ...(permissions.configure
            ? (["reservations.configure"] as const)
            : []),
        ],
      }}
      model={model}
      serviceShifts={serviceShifts}
    />,
  );
}

describe("reservation service controls", () => {
  it("lets an override-only manager record exact materialized boundaries", async () => {
    mocks.configureException.mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {},
    });
    renderControls({
      view: false,
      operate: false,
      override: true,
      configure: false,
    });

    expect(
      screen.getByRole("button", { name: "Install or reset draft" }),
    ).toHaveProperty("disabled", true);
    const reason = screen.getByRole("textbox", {
      name: /Operational reason/,
    });
    fireEvent.change(reason, { target: { value: "Private event" } });
    fireEvent.submit(reason.closest("form")!);

    await waitFor(() => expect(mocks.configureException).toHaveBeenCalledOnce());
    expect(mocks.configureException).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: baseWorkspace.organization.id,
        locationId: baseWorkspace.activeLocation.id,
        serviceShiftId: serviceShifts.shifts[0]?.id,
        exceptionKind: "closure",
        effectiveStartsAt: serviceShifts.shifts[0]?.startsAt,
        effectiveEndsAt: serviceShifts.shifts[0]?.endsAt,
        active: true,
      }),
    );
  });

  it("keeps configure-only staff from creating or revoking overrides", () => {
    renderControls({
      view: false,
      operate: false,
      override: false,
      configure: true,
    });

    expect(
      screen.getByRole("button", { name: "Record service exception" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Revoke" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByText(/exact reservations\.override capability/i),
    ).toBeTruthy();
  });

  it("requires an explicit revocation reason in a safe-focus confirmation", async () => {
    mocks.revokeException.mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {},
    });
    renderControls({
      view: false,
      operate: false,
      override: true,
      configure: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Revoke closure?",
    });
    expect(dialog).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Cancel" }),
      ),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: /Revocation reason/ }),
      { target: { value: "Event cancelled" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke exception" }),
    );

    await waitFor(() => expect(mocks.revokeException).toHaveBeenCalledOnce());
    expect(mocks.revokeException).toHaveBeenCalledWith(
      expect.objectContaining({
        exceptionId: serviceShifts.shifts[0]?.exceptions[0]?.id,
        reason: "Event cancelled",
      }),
    );
  });
});

// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReservationsWorkspace } from "@/components/reservations/reservations-workspace";
import { localDateKey } from "@/data/read-models/local-time";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createDemoReservationModel } from "@/lib/reservations/demo";
import type { ReservationHostPermissions } from "@/lib/reservations/model";

const mocks = vi.hoisted(() => ({
  assignTables: vi.fn(),
  cancelReservation: vi.fn(),
  loadLifecycleHead: vi.fn(),
  modifyReservation: vi.fn(),
  saveReservation: vi.fn(),
  saveWaitlist: vi.fn(),
  seatWaitlist: vi.fn(),
  setTableStatus: vi.fn(),
  transitionReservation: vi.fn(),
  transitionWaitlist: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/actions/workflows/reservations", () => ({
  assignReservationTablesAction: mocks.assignTables,
  cancelReservationAction: mocks.cancelReservation,
  loadReservationLifecycleHeadAction: mocks.loadLifecycleHead,
  modifyReservationAction: mocks.modifyReservation,
  saveReservationWithGuestAction: mocks.saveReservation,
  saveWaitlistEntryAction: mocks.saveWaitlist,
  seatWaitlistEntryAction: mocks.seatWaitlist,
  setReservationTableStatusAction: mocks.setTableStatus,
  transitionReservationAction: mocks.transitionReservation,
  transitionWaitlistEntryAction: mocks.transitionWaitlist,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const channel = {
      on: vi.fn(),
      subscribe: vi.fn(),
    };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    return {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    };
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
    displayName: "Connected Host",
    email: "host@example.com",
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
    timeZone: "America/New_York",
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "employee",
  organizationWide: false,
  capabilities: [],
};

const currentDate = localDateKey(new Date(), "America/New_York");

function renderHost(
  permissions: ReservationHostPermissions,
  businessDate = currentDate,
  configurationReady = true,
  customize?: (model: ReturnType<typeof createDemoReservationModel>) => void,
) {
  const model = createDemoReservationModel(businessDate, permissions);
  model.configuration.ready = configurationReady;
  customize?.(model);
  return render(
    <ReservationsWorkspace
      workspace={{
        ...workspace,
        capabilities: [
          ...(permissions.view ? (["reservations.view"] as const) : []),
          ...(permissions.operate ? (["reservations.operate"] as const) : []),
          ...(permissions.override ? (["reservations.override"] as const) : []),
          ...(permissions.configure
            ? (["reservations.configure"] as const)
            : []),
        ],
      }}
      result={{ ok: true, data: model }}
    />,
  );
}

describe("reservation host capability affordances", () => {
  it("keeps view-only workflows readable and explains disabled mutations", () => {
    renderHost({
      view: true,
      operate: false,
      override: false,
      configure: false,
    });

    const explanation = screen.getByText(/exact reservations\.operate/i);
    const book = screen.getByRole("button", { name: "Book" });
    expect(book).toHaveProperty("disabled", true);
    expect(book.getAttribute("aria-describedby")).toBe(
      explanation.closest("[role='note']")?.id,
    );
    expect(screen.getByRole("button", { name: "Waitlist" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Walk-in" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: /Nora Example/ }));
    expect(
      screen.getByRole("button", { name: "Suggest table" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Arrive" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.queryByRole("button", { name: "Edit / reschedule" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

    fireEvent.click(screen.getByTitle(/^Table 1 ·/));
    expect(screen.getByRole("button", { name: "Needs reset" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(mocks.assignTables).not.toHaveBeenCalled();
  });

  it("lets an operate-only host run service without granting configuration", () => {
    renderHost(
      {
        view: false,
        operate: true,
        override: false,
        configure: false,
      },
      currentDate,
      false,
    );

    expect(screen.queryByText(/Read-only reservation access/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Book" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.getByRole("button", { name: "Waitlist" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(
      screen.getByRole("button", { name: "Configuration" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen
        .getByText(/reservations\.configure capability/i)
        .classList.contains("sr-only"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Nora Example/ }));
    expect(
      screen
        .getByRole("group", { name: "Reservation workspace view" })
        .querySelector('[data-state="active"]')?.textContent,
    ).toContain("Service");
    expect(screen.getByRole("button", { name: "Arrive" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(
      screen.getByRole("button", { name: "Edit / reschedule" }),
    ).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("confirms a no-show before invoking the terminal transition", async () => {
    mocks.transitionReservation.mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {},
    });
    renderHost({
      view: true,
      operate: true,
      override: false,
      configure: false,
    });

    fireEvent.click(screen.getByRole("button", { name: /Nora Example/ }));
    fireEvent.click(screen.getByRole("button", { name: "No-show" }));

    expect(mocks.transitionReservation).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", {
        name: "Mark this reservation as a no-show?",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark no-show" }));

    await waitFor(() =>
      expect(mocks.transitionReservation).toHaveBeenCalledOnce(),
    );
    expect(mocks.transitionReservation).toHaveBeenCalledWith(
      expect.objectContaining({ targetStatus: "no_show" }),
    );
  });

  it("renders an explicit denial when no reservation capability is present", () => {
    renderHost({
      view: false,
      operate: false,
      override: false,
      configure: false,
    });

    expect(
      screen.getByRole("heading", { name: "Reservation access not assigned" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
  });

  it("keeps future reservation lifecycle actions separate from floor-now actions", () => {
    renderHost(
      {
        view: true,
        operate: true,
        override: true,
        configure: true,
      },
      "2099-08-10",
    );

    expect(
      screen.getByText(/current-service actions are paused/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Book" })).toHaveProperty(
      "disabled",
      false,
    );
    for (const name of ["Waitlist", "Walk-in", "Notify", "Accept"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty(
        "disabled",
        true,
      );
    }
    for (const seat of screen.getAllByRole("button", {
      name: "Seat now",
    })) {
      expect(seat).toHaveProperty("disabled", true);
    }
    for (const remove of screen.getAllByRole("button", {
      name: "Remove",
    })) {
      expect(remove).toHaveProperty("disabled", true);
      fireEvent.click(remove);
    }
    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: /Nora Example/ }));
    expect(screen.getByRole("button", { name: "Arrive" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByRole("button", { name: "Edit / reschedule" }),
    ).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit / reschedule" }));
    expect(
      screen.getByRole("dialog", { name: "Edit / reschedule" }),
    ).toBeTruthy();
    expect(mocks.transitionWaitlist).not.toHaveBeenCalled();
    expect(mocks.transitionReservation).not.toHaveBeenCalled();
    expect(mocks.seatWaitlist).not.toHaveBeenCalled();
  });

  it("keeps external-source reservations read-only under the one-writer gate", () => {
    renderHost(
      {
        view: true,
        operate: true,
        override: false,
        configure: false,
      },
      currentDate,
      true,
      (model) => {
        model.reservations[0]!.source = "resy";
        model.reservations[0]!.bookingChannel = "partner";
      },
    );

    fireEvent.click(screen.getByRole("button", { name: /Nora Example/ }));
    expect(
      screen.getByText(
        /read-only in Le Yard OS until source writer ownership is approved/i,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Edit / reschedule" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("omits edit and cancellation for seated and terminal reservations", () => {
    renderHost(
      {
        view: true,
        operate: true,
        override: false,
        configure: false,
      },
      currentDate,
      true,
      (model) => {
        model.reservations[0]!.status = "seated";
      },
    );

    fireEvent.click(screen.getByRole("button", { name: /Nora Example/ }));
    expect(
      screen.queryByRole("button", { name: "Edit / reschedule" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByRole("button", { name: "Complete" })).toBeTruthy();
  });
});

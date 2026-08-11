// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelReservationAction,
  loadReservationLifecycleHeadAction,
  modifyReservationAction,
} from "@/app/actions/workflows/reservations";
import {
  ReservationCancelDialog,
  ReservationEditDialog,
} from "@/components/reservations/reservation-lifecycle-dialogs";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createDemoReservationModel } from "@/lib/reservations/demo";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/actions/workflows/reservations", () => ({
  cancelReservationAction: vi.fn(),
  loadReservationLifecycleHeadAction: vi.fn(),
  modifyReservationAction: vi.fn(),
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
  role: "employee",
  organizationWide: false,
  capabilities: ["reservations.view", "reservations.operate"],
};

function fixture() {
  const model = createDemoReservationModel("2026-08-11");
  const reservation = {
    ...model.reservations[0]!,
    id: "50000000-0000-4000-8000-000000000001",
    version: 7,
    startsAt: "2026-08-11T23:00:00.000Z",
    tableIds: ["60000000-0000-4000-8000-000000000001"],
  };
  return { model, reservation };
}

function lifecycleSuccess(
  kind: "staff_modified" | "staff_cancelled",
  replayed = false,
  guestNotificationQueued = false,
) {
  return {
    ok: true as const,
    persisted: true as const,
    mode: "live" as const,
    data: {
      id: "50000000-0000-4000-8000-000000000001",
      status: kind === "staff_cancelled" ? ("cancelled" as const) : ("confirmed" as const),
      version: 8,
      reservedAt: "2026-08-11T23:30:00.000Z",
      durationMinutes: 90,
      partySize: 2,
      revisionId: "70000000-0000-4000-8000-000000000001",
      revisionKind: kind,
      policyEvidenceCaptured: true,
      guestNotificationQueued,
      replayed,
    },
  };
}

function fillAndReviewEdit() {
  fireEvent.change(screen.getByLabelText(/Time/), {
    target: { value: "19:30" },
  });
  fireEvent.change(screen.getByLabelText(/Reason for change/), {
    target: { value: "Guest requested a later arrival." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
}

describe("staff reservation lifecycle dialogs", () => {
  it("keeps a valid nonstandard turn visible and accepts another configured duration", () => {
    const { model, reservation } = fixture();

    render(
      <ReservationEditDialog
        workspace={workspace}
        model={model}
        reservation={{ ...reservation, durationMinutes: 75 }}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Turn time/)).toHaveProperty("value", "75");
    fireEvent.change(screen.getByLabelText(/Turn time/), {
      target: { value: "105" },
    });
    expect(screen.getByLabelText(/Turn time/)).toHaveProperty("value", "105");
  });

  it("restores focus to the primary edit field when returning from review", async () => {
    const { model, reservation } = fixture();
    render(
      <ReservationEditDialog
        workspace={workspace}
        model={model}
        reservation={reservation}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    );

    fillAndReviewEdit();
    const back = screen.getByRole("button", { name: "Back to edit" });
    await waitFor(() => expect(document.activeElement).toBe(back));
    fireEvent.click(back);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/Date/)),
    );
  });

  it("reviews an edit before submitting expected-version evidence", async () => {
    vi.mocked(modifyReservationAction).mockResolvedValue(
      lifecycleSuccess("staff_modified", false, true),
    );
    const { model, reservation } = fixture();
    const onClose = vi.fn();
    const onCompleted = vi.fn();

    render(
      <ReservationEditDialog
        workspace={workspace}
        model={model}
        reservation={reservation}
        onClose={onClose}
        onCompleted={onCompleted}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Edit / reschedule" }),
    ).toBeTruthy();
    expect(screen.getByText("Current record · version 7")).toBeTruthy();
    fillAndReviewEdit();

    expect(modifyReservationAction).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Review reservation changes" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Back to edit" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));

    await waitFor(() => expect(modifyReservationAction).toHaveBeenCalledOnce());
    const input = vi.mocked(modifyReservationAction).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(input).toEqual(
      expect.objectContaining({
        locationId: workspace.activeLocation.id,
        reservationId: reservation.id,
        expectedVersion: 7,
        reservedAt: "2026-08-11T23:30:00.000Z",
        partySize: 2,
        tableIds: reservation.tableIds,
        reason: "Guest requested a later arrival.",
      }),
    );
    expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(input).not.toHaveProperty("guestId");
    expect(input).not.toHaveProperty("source");
    expect(onCompleted).toHaveBeenCalledWith(
      expect.stringMatching(
        /revision 8.*policy evidence captured.*verified-channel guest update was queued/i,
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves one request id when an ambiguous edit is retried unchanged", async () => {
    vi.mocked(modifyReservationAction)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(lifecycleSuccess("staff_modified", true));
    const { model, reservation } = fixture();

    const view = render(
      <ReservationEditDialog
        workspace={workspace}
        model={model}
        reservation={reservation}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    );

    fillAndReviewEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(
      await screen.findByText(/connection ended before a result was confirmed/i),
    ).toBeTruthy();
    view.rerender(
      <ReservationEditDialog
        workspace={workspace}
        model={model}
        reservation={{ ...reservation, version: 8, status: "cancelled" }}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    );
    expect(screen.getByText(/exact request can still be retried safely/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save revision" })).toHaveProperty(
      "disabled",
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));

    await waitFor(() => expect(modifyReservationAction).toHaveBeenCalledTimes(2));
    const [first, second] = vi
      .mocked(modifyReservationAction)
      .mock.calls.map(([input]) => input as { requestId: string });
    expect(second.requestId).toBe(first.requestId);
  });

  it("preserves the draft and loads a moved-out-of-window head after a stale response", async () => {
    vi.mocked(modifyReservationAction).mockResolvedValue({
      ok: false,
      persisted: false,
      code: "stale",
      message:
        "This record changed while you were working. Review the latest details before trying again.",
    });
    const { model, reservation } = fixture();
    vi.mocked(loadReservationLifecycleHeadAction).mockResolvedValue({
      ok: true,
      persisted: false,
      mode: "live",
      data: {
        id: reservation.id,
        version: 8,
        reservedAt: "2026-08-13T23:00:00.000Z",
        durationMinutes: 120,
        partySize: 4,
        status: "confirmed",
        tableIds: [],
        specialRequests: "Patio if dry",
        source: "manual",
        bookingChannel: "staff",
        policyEvidenceCaptured: true,
        lastRevision: null,
      },
    });
    render(
      <ReservationEditDialog
        workspace={workspace}
        model={model}
        reservation={reservation}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    );

    fillAndReviewEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(
      await screen.findByText(/review it now against version 8/i),
    ).toBeTruthy();
    expect(screen.getByLabelText(/Reason for change/)).toHaveProperty(
      "value",
      "Guest requested a later arrival.",
    );
    expect(modifyReservationAction).toHaveBeenCalledOnce();
    expect(loadReservationLifecycleHeadAction).toHaveBeenCalledWith({
      locationId: workspace.activeLocation.id,
      reservationId: reservation.id,
    });
    expect(screen.getByText(/Thu, Aug 13/)).toBeTruthy();
    expect(refresh).toHaveBeenCalledOnce();
    expect(modifyReservationAction).toHaveBeenCalledOnce();
  });

  it("requires cancellation evidence and states that guest contact is manual", async () => {
    vi.mocked(cancelReservationAction).mockResolvedValue(
      lifecycleSuccess("staff_cancelled"),
    );
    const { model, reservation } = fixture();
    const onCompleted = vi.fn();

    render(
      <ReservationCancelDialog
        workspace={workspace}
        model={model}
        reservation={reservation}
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />,
    );

    expect(
      screen.getByRole("alertdialog", { name: "Cancel this reservation?" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Keep reservation" }),
      ),
    );
    expect(
      screen.getByText(/queued only when a verified, approved channel/i),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
    expect(await screen.findByText(/enter a cancellation reason/i)).toBeTruthy();
    expect(cancelReservationAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Cancellation reason/), {
      target: { value: "Guest called because plans changed." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));

    await waitFor(() => expect(cancelReservationAction).toHaveBeenCalledOnce());
    expect(cancelReservationAction).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: reservation.id,
        expectedVersion: 7,
        reason: "Guest called because plans changed.",
      }),
    );
    expect(onCompleted).toHaveBeenCalledWith(
      expect.stringMatching(
        /inventory was released.*no guest message was queued.*contact the guest manually/i,
      ),
    );
  });

  it("preserves a cancellation reason and adopts the exact head after stale", async () => {
    vi.mocked(cancelReservationAction)
      .mockResolvedValueOnce({
        ok: false,
        persisted: false,
        code: "stale",
        message:
          "This record changed while you were working. Review the latest details before trying again.",
      })
      .mockResolvedValueOnce(lifecycleSuccess("staff_cancelled"));
    const { model, reservation } = fixture();
    vi.mocked(loadReservationLifecycleHeadAction).mockResolvedValue({
      ok: true,
      persisted: false,
      mode: "live",
      data: {
        id: reservation.id,
        version: 8,
        reservedAt: "2026-08-13T23:00:00.000Z",
        durationMinutes: null,
        partySize: 4,
        status: "confirmed",
        tableIds: [],
        specialRequests: null,
        source: "manual",
        bookingChannel: "staff",
        policyEvidenceCaptured: true,
        lastRevision: null,
      },
    });

    render(
      <ReservationCancelDialog
        workspace={workspace}
        model={model}
        reservation={reservation}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Cancellation reason/), {
      target: { value: "Guest called because plans changed." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));

    expect(
      await screen.findByText(/review version 8 above/i),
    ).toBeTruthy();
    expect(screen.getByLabelText(/Cancellation reason/)).toHaveProperty(
      "value",
      "Guest called because plans changed.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
    await waitFor(() => expect(cancelReservationAction).toHaveBeenCalledTimes(2));
    const [first, second] = vi
      .mocked(cancelReservationAction)
      .mock.calls.map(([input]) =>
        input as { expectedVersion: number; requestId: string },
      );
    expect(first.expectedVersion).toBe(7);
    expect(second.expectedVersion).toBe(8);
    expect(second.requestId).not.toBe(first.requestId);
  });
});

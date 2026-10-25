// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteStaffReservationTurnAction } from "@/app/actions/workflows/reservations";
import { StaffTurnPolicyNotice, useStaffTurnPolicy } from "@/components/reservations/staff-turn-policy";
import type { StaffReservationTurnInput } from "@/data/reservation-schemas";

vi.mock("@/app/actions/workflows/reservations", () => ({ quoteStaffReservationTurnAction: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const input = { locationId: "30000000-0000-4000-8000-000000000001", startsAt: "2027-01-20T22:00:00.000Z", partySize: 2, reservationId: null };
const success = (partySize: number, durationMinutes: number) => ({
  ok: true as const, persisted: false as const, mode: "live" as const,
  data: { ...input, partySize, durationMinutes, serviceShiftId: "90000000-0000-4000-8000-000000000001", policyHash: "a".repeat(64) },
});
function Harness({ intent }: { intent: StaffReservationTurnInput | null }) {
  const policy = useStaffTurnPolicy(intent, true);
  return <><input aria-label="Turn time" readOnly value={policy.quote?.durationMinutes ?? ""} /><button disabled={policy.status !== "ready"}>Save</button><StaffTurnPolicyNotice policy={policy} /></>;
}

describe("authoritative staff turn lookup", () => {
  it("blocks the old quote immediately and ignores a late result for a different party", async () => {
    let first!: (r: ReturnType<typeof success>) => void;
    let second!: (r: ReturnType<typeof success>) => void;
    vi.mocked(quoteStaffReservationTurnAction)
      .mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
    const view = render(<Harness intent={input} />);
    await waitFor(() => expect(quoteStaffReservationTurnAction).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    view.rerender(<Harness intent={{ ...input, partySize: 4 }} />);
    expect(screen.getByLabelText("Turn time")).toHaveProperty("value", "");
    await waitFor(() => expect(quoteStaffReservationTurnAction).toHaveBeenCalledTimes(2));
    await act(async () => { second(success(4, 90)); });
    await waitFor(() => expect(screen.getByLabelText("Turn time")).toHaveProperty("value", "90"));
    await act(async () => { first(success(2, 75)); });
    expect(screen.getByLabelText("Turn time")).toHaveProperty("value", "90");
  });
  it("does not reuse a ready duration when date or time changes", async () => {
    vi.mocked(quoteStaffReservationTurnAction).mockResolvedValueOnce(success(2, 75)).mockImplementationOnce(() => new Promise(() => {}));
    const view = render(<Harness intent={input} />);
    await waitFor(() => expect(screen.getByLabelText("Turn time")).toHaveProperty("value", "75"));
    view.rerender(<Harness intent={{ ...input, startsAt: "2027-01-21T22:00:00.000Z" }} />);
    expect(screen.getByLabelText("Turn time")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });
  it("keeps failures unavailable until an explicit successful retry", async () => {
    vi.mocked(quoteStaffReservationTurnAction).mockResolvedValueOnce({ ok: false, persisted: false, code: "conflict", message: "This service is closed." }).mockResolvedValueOnce(success(2, 80));
    render(<Harness intent={input} />);
    await screen.findByText("This service is closed.");
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Retry policy check" }));
    await waitFor(() => expect(screen.getByLabelText("Turn time")).toHaveProperty("value", "80"));
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  });
  it("does not estimate a duration for an invalid local-time intent", () => {
    render(<Harness intent={null} />);
    expect(quoteStaffReservationTurnAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Turn time")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });
});

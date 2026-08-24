import { afterEach, describe, expect, it } from "vitest";
import { BookingApiError } from "@/lib/reservations/api-auth.server";
import {
  assertPublicReleaseAllowsBusinessDate,
  effectivePublicPacingCoverLimit,
  isPublicReservationEmergencyGateOpen,
  type PublicReleaseState,
} from "@/lib/reservations/public-release-control.server";

const originalGate = process.env.RESERVATION_PUBLIC_BOOKING_ENABLED;

afterEach(() => {
  if (originalGate === undefined)
    delete process.env.RESERVATION_PUBLIC_BOOKING_ENABLED;
  else process.env.RESERVATION_PUBLIC_BOOKING_ENABLED = originalGate;
});

const releasedPilot: PublicReleaseState = {
  state: "pilot",
  acceptReservationsFrom: "2026-12-01",
  publicInventoryPercent: 25,
  bookingApproved: true,
  supportReady: true,
  bookingEnabled: true,
  releaseId: "11111111-1111-4111-8111-111111111111",
  version: 2,
  updatedAt: "2026-08-24T20:00:00.000Z",
};

describe("authoritative public release controls", () => {
  it("treats the environment flag only as an emergency negative gate", () => {
    delete process.env.RESERVATION_PUBLIC_BOOKING_ENABLED;
    expect(isPublicReservationEmergencyGateOpen()).toBe(true);
    process.env.RESERVATION_PUBLIC_BOOKING_ENABLED = "false";
    expect(isPublicReservationEmergencyGateOpen()).toBe(false);
    process.env.RESERVATION_PUBLIC_BOOKING_ENABLED = "OFF";
    expect(isPublicReservationEmergencyGateOpen()).toBe(false);
    process.env.RESERVATION_PUBLIC_BOOKING_ENABLED = "invalid";
    expect(isPublicReservationEmergencyGateOpen()).toBe(false);
    process.env.RESERVATION_PUBLIC_BOOKING_ENABLED = "true";
    expect(isPublicReservationEmergencyGateOpen()).toBe(true);
  });

  it("allows only released business dates beginning December 1", () => {
    expect(() =>
      assertPublicReleaseAllowsBusinessDate(releasedPilot, "2026-12-01"),
    ).not.toThrow();
    expect(() =>
      assertPublicReleaseAllowsBusinessDate(releasedPilot, "2026-11-30"),
    ).toThrowError(BookingApiError);
    expect(() =>
      assertPublicReleaseAllowsBusinessDate(
        { ...releasedPilot, bookingEnabled: false },
        "2026-12-01",
      ),
    ).toThrowError(BookingApiError);
  });

  it("floors pilot pacing to exactly 25 percent of configured covers", () => {
    expect(effectivePublicPacingCoverLimit(20, 25)).toBe(5);
    expect(effectivePublicPacingCoverLimit(18, 25)).toBe(4);
    expect(effectivePublicPacingCoverLimit(3, 25)).toBe(0);
    expect(effectivePublicPacingCoverLimit(20, 101)).toBe(0);
  });
});

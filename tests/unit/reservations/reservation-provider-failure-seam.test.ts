import { afterEach, describe, expect, it, vi } from "vitest";
import { sendReservationOutboxMessage } from "@/lib/reservations/messaging.server";

describe("reservation provider failure seam", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forces only the selected template/channel before provider I/O in tests", async () => {
    vi.stubEnv(
      "RESERVATION_DELIVERY_FORCE_FAILURE",
      "waitlist_table_ready:email",
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendReservationOutboxMessage({
        messageId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        locationId: "33333333-3333-4333-8333-333333333333",
        reservationId: null,
        bookingHoldId: null,
        channel: "email",
        templateKey: "waitlist_table_ready",
        guestName: "Ada",
        email: "ada@example.com",
        phone: null,
        publicCode: null,
        reservedAt: null,
        offerExpiresAt: "2026-08-24T22:00:00Z",
        holdExpiresAt: null,
        messageCreatedAt: "2026-08-24T21:00:00Z",
      }),
    ).resolves.toEqual({ state: "failed", providerMessageId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

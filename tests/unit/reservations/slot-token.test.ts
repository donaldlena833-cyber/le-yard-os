import { afterEach, describe, expect, it } from "vitest";
import { BookingApiError } from "@/lib/reservations/api-auth.server";
import {
  createBookingSlotToken,
  verifyBookingSlotToken,
} from "@/lib/reservations/slot-token.server";

const originalSecret = process.env.BOOKING_SLOT_SIGNING_SECRET;
const originalSupabaseSecret = process.env.SUPABASE_SECRET_KEY;

afterEach(() => {
  if (originalSecret === undefined)
    delete process.env.BOOKING_SLOT_SIGNING_SECRET;
  else process.env.BOOKING_SLOT_SIGNING_SECRET = originalSecret;
  if (originalSupabaseSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = originalSupabaseSecret;
});

describe("booking slot token key separation", () => {
  it("fails closed without a dedicated signing secret", () => {
    delete process.env.BOOKING_SLOT_SIGNING_SECRET;
    process.env.SUPABASE_SECRET_KEY = "must-not-be-used".repeat(4);
    expect(() =>
      createBookingSlotToken({
        clientId: "11111111-1111-4111-8111-111111111111",
        locationId: "22222222-2222-4222-8222-222222222222",
        releaseId: "55555555-5555-4555-8555-555555555555",
        businessDate: "2026-12-12",
        startsAt: "2026-08-12T23:00:00.000Z",
        durationMinutes: 90,
        partySize: 2,
        tableIds: ["33333333-3333-4333-8333-333333333333"],
      }),
    ).toThrowError(BookingApiError);
  });

  it("round-trips only with the dedicated secret and bound client", () => {
    process.env.BOOKING_SLOT_SIGNING_SECRET = "b".repeat(48);
    const clientId = "11111111-1111-4111-8111-111111111111";
    const token = createBookingSlotToken({
      clientId,
      locationId: "22222222-2222-4222-8222-222222222222",
      releaseId: "55555555-5555-4555-8555-555555555555",
      businessDate: "2026-12-12",
      startsAt: "2026-08-12T23:00:00.000Z",
      durationMinutes: 90,
      partySize: 2,
      tableIds: ["33333333-3333-4333-8333-333333333333"],
    });
    expect(verifyBookingSlotToken(token, clientId)).toMatchObject({
      clientId,
      partySize: 2,
    });
    expect(() =>
      verifyBookingSlotToken(
        token,
        "44444444-4444-4444-8444-444444444444",
      ),
    ).toThrowError(BookingApiError);
  });

  it("rejects a signed token whose release identifier is not a valid UUID", () => {
    process.env.BOOKING_SLOT_SIGNING_SECRET = "b".repeat(48);
    const clientId = "11111111-1111-4111-8111-111111111111";
    const token = createBookingSlotToken({
      clientId,
      locationId: "22222222-2222-4222-8222-222222222222",
      releaseId: "------------------------------------",
      businessDate: "2026-12-12",
      startsAt: "2026-12-12T23:00:00.000Z",
      durationMinutes: 90,
      partySize: 2,
      tableIds: ["33333333-3333-4333-8333-333333333333"],
    });

    expect(() => verifyBookingSlotToken(token, clientId)).toThrowError(
      BookingApiError,
    );
  });
});

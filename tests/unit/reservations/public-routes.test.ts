import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  authenticate: vi.fn(),
  rateLimit: vi.fn(),
  contactRateLimit: vi.fn(),
  verifySlot: vi.fn(),
  availability: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                guest_messaging_enabled: true,
                verification_channels: ["email"],
              },
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/reservations/api-auth.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/reservations/api-auth.server")>();
  return {
    ...actual,
    authenticateBookingApiRequest: mocks.authenticate,
    enforceBookingRateLimit: mocks.rateLimit,
    enforceBookingContactRateLimit: mocks.contactRateLimit,
  };
});

vi.mock("@/lib/reservations/slot-token.server", () => ({
  verifyBookingSlotToken: mocks.verifySlot,
}));

vi.mock("@/lib/reservations/public-availability.server", () => ({
  loadPublicAvailability: mocks.availability,
}));

const client = {
  id: "99999999-9999-4999-8999-999999999999",
  organizationId: "11111111-1111-4111-8111-111111111111",
  locationId: "22222222-2222-4222-8222-222222222222",
  name: "Public site",
  scopes: ["reservations:write"],
  abuseIdentity: "88888888-8888-4888-8888-888888888888",
};

const environment = {
  RESERVATION_PUBLIC_SITE_URL: process.env.RESERVATION_PUBLIC_SITE_URL,
  RESERVATION_LINK_SIGNING_SECRET: process.env.RESERVATION_LINK_SIGNING_SECRET,
  RESERVATION_DELIVERY_SECRET: process.env.RESERVATION_DELIVERY_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESERVATION_EMAIL_FROM: process.env.RESERVATION_EMAIL_FROM,
  RESERVATION_SMS_DELIVERY_ENABLED:
    process.env.RESERVATION_SMS_DELIVERY_ENABLED,
  RESERVATION_PUBLIC_BOOKING_ENABLED:
    process.env.RESERVATION_PUBLIC_BOOKING_ENABLED,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
};

beforeEach(() => {
  mocks.authenticate.mockResolvedValue(client);
  mocks.rateLimit.mockResolvedValue({ allowed: true });
  mocks.contactRateLimit.mockResolvedValue(undefined);
  mocks.verifySlot.mockReturnValue({
    locationId: client.locationId,
    partySize: 2,
    startsAt: "2026-08-12T23:00:00.000Z",
    durationMinutes: 90,
    tableIds: ["33333333-3333-4333-8333-333333333333"],
  });
  process.env.RESERVATION_PUBLIC_SITE_URL = "https://www.leyard.example";
  process.env.RESERVATION_LINK_SIGNING_SECRET = "s".repeat(48);
  process.env.RESERVATION_DELIVERY_SECRET = "d".repeat(48);
  process.env.RESEND_API_KEY = "resend-test";
  process.env.RESERVATION_EMAIL_FROM = "reservations@leyard.example";
  process.env.RESERVATION_SMS_DELIVERY_ENABLED = "false";
  process.env.RESERVATION_PUBLIC_BOOKING_ENABLED = "true";
  mocks.availability.mockResolvedValue({
    location: {
      id: client.locationId,
      name: "Le Yard",
      timeZone: "America/New_York",
    },
    businessDate: "2026-08-12",
    partySize: 2,
    slots: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("public reservation API contracts", () => {
  it("keeps new public holds disabled unless the deployment switch is exactly true", async () => {
    delete process.env.RESERVATION_PUBLIC_BOOKING_ENABLED;
    const { POST } = await import("@/app/api/v1/reservations/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "55555555-5555-4555-8555-555555555555",
        },
        body: JSON.stringify({
          slotToken: "x".repeat(80),
          partySize: 2,
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          phone: "+1 212 555 0100",
        }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "booking_unavailable" },
    });
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps new availability disabled before API authentication", async () => {
    process.env.RESERVATION_PUBLIC_BOOKING_ENABLED = "TRUE";
    const { GET } = await import("@/app/api/v1/availability/route");
    const response = await GET(
      new Request(
        "https://os.example/api/v1/availability?date=2026-08-12&partySize=2",
      ),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "booking_unavailable" },
    });
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.availability).not.toHaveBeenCalled();
  });

  it("preserves availability for a valid existing management session while new inventory is off", async () => {
    process.env.RESERVATION_PUBLIC_BOOKING_ENABLED = "false";
    mocks.rpc.mockResolvedValueOnce({
      data: { status: "confirmed" },
      error: null,
    });
    const { GET } = await import("@/app/api/v1/availability/route");
    const response = await GET(
      new Request(
        "https://os.example/api/v1/availability?date=2026-08-12&partySize=2",
        { headers: { "x-booking-manage-token": "m".repeat(64) } },
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_get_managed_reservation",
      expect.objectContaining({
        p_organization_id: client.organizationId,
        p_location_id: client.locationId,
        p_manage_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(mocks.availability).toHaveBeenCalledWith(client, "2026-08-12", 2, {
      existingManagementSessionAuthorized: true,
    });
  });

  it("does not let an invalid management token bypass the disabled inventory gate", async () => {
    process.env.RESERVATION_PUBLIC_BOOKING_ENABLED = "false";
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002" },
    });
    const { GET } = await import("@/app/api/v1/availability/route");
    const response = await GET(
      new Request(
        "https://os.example/api/v1/availability?date=2026-08-12&partySize=2",
        { headers: { "x-booking-manage-token": "m".repeat(64) } },
      ),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "booking_unavailable" },
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.availability).not.toHaveBeenCalled();
  });

  it("creates a scoped hold with server adapter channels and returns only hold state", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        holdId: "44444444-4444-4444-8444-444444444444",
        holdExpiresAt: "2026-08-12T22:15:00.000Z",
        deliveryState: { email: "queued" },
        replayed: false,
        publicCode: "must-not-leak",
      },
      error: null,
    });
    const { POST } = await import("@/app/api/v1/reservations/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "55555555-5555-4555-8555-555555555555",
        },
        body: JSON.stringify({
          slotToken: "x".repeat(80),
          partySize: 2,
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ADA@example.com",
          phone: "+1 212 555 0100",
          specialRequests: null,
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      data: {
        holdId: "44444444-4444-4444-8444-444444444444",
        holdExpiresAt: "2026-08-12T22:15:00.000Z",
        deliveryState: { email: "queued" },
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_create_public_reservation",
      expect.objectContaining({
        p_organization_id: client.organizationId,
        p_location_id: client.locationId,
        p_available_channels: ["email"],
      }),
    );
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty(
      "p_confirmation_token_hash",
    );
    expect(mocks.verifySlot.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rateLimit.mock.invocationCallOrder[0]!,
    );
    expect(mocks.rateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.contactRateLimit.mock.invocationCallOrder[0]!,
    );
    expect(mocks.contactRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0]!,
    );
  });

  it("does not spend create quotas on malformed JSON", async () => {
    const { POST } = await import("@/app/api/v1/reservations/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "55555555-5555-4555-8555-555555555555",
        },
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.verifySlot).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.contactRateLimit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not spend create quotas on a body that fails the strict schema", async () => {
    const { POST } = await import("@/app/api/v1/reservations/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "55555555-5555-4555-8555-555555555555",
        },
        body: JSON.stringify({
          slotToken: "x".repeat(80),
          partySize: 2,
          firstName: "Ada",
          lastName: "Lovelace",
          phone: "+1 212 555 0100",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.verifySlot).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.contactRateLimit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not spend create quotas on a malformed idempotency header", async () => {
    const { POST } = await import("@/app/api/v1/reservations/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "not-a-uuid",
        },
        body: JSON.stringify({
          slotToken: "x".repeat(80),
          partySize: 2,
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          phone: "+1 212 555 0100",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.verifySlot).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.contactRateLimit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not spend create quotas when API scope authentication fails", async () => {
    const { BookingApiError } =
      await import("@/lib/reservations/api-auth.server");
    mocks.authenticate.mockRejectedValueOnce(
      new BookingApiError(
        403,
        "forbidden",
        "This API client does not have the required scope.",
      ),
    );
    const { POST } = await import("@/app/api/v1/reservations/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "55555555-5555-4555-8555-555555555555",
        },
        body: JSON.stringify({
          slotToken: "x".repeat(80),
          partySize: 2,
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          phone: "+1 212 555 0100",
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.verifySlot).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.contactRateLimit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("validates the signed slot before charging the contact limiter", async () => {
    const { BookingApiError } =
      await import("@/lib/reservations/api-auth.server");
    mocks.verifySlot.mockImplementationOnce(() => {
      throw new BookingApiError(
        400,
        "invalid_slot",
        "The selected time is unavailable.",
      );
    });
    const { POST } = await import("@/app/api/v1/reservations/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "55555555-5555-4555-8555-555555555555",
        },
        body: JSON.stringify({
          slotToken: "x".repeat(80),
          partySize: 2,
          firstName: "Ada",
          lastName: "Lovelace",
          email: "victim@example.com",
          phone: "+1 212 555 0100",
          specialRequests: null,
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.contactRateLimit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a locked delivery-readiness race to verification unavailable", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000" },
    });
    const { POST } = await import("@/app/api/v1/reservations/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "55555555-5555-4555-8555-555555555555",
        },
        body: JSON.stringify({
          slotToken: "x".repeat(80),
          partySize: 2,
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          phone: "+1 212 555 0100",
          specialRequests: null,
        }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "verification_unavailable" },
    });
  });

  it("confirms a signed hold with scoped one-time fingerprint semantics", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        status: "confirmed",
        manageDeliveryState: { email: "queued" },
        replayed: false,
      },
      error: null,
    });
    const { createReservationLinkToken } =
      await import("@/lib/reservations/link-token.server");
    const verificationToken = createReservationLinkToken({
      purpose: "verify",
      organizationId: client.organizationId,
      locationId: client.locationId,
      subjectId: "66666666-6666-4666-8666-666666666666",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      verifiedChannel: "email",
    });
    const { POST } = await import("@/app/api/v1/reservations/confirm/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations/confirm", {
        method: "POST",
        body: JSON.stringify({ verificationToken }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_confirm_public_reservation",
      expect.objectContaining({
        p_organization_id: client.organizationId,
        p_location_id: client.locationId,
        p_booking_hold_id: "66666666-6666-4666-8666-666666666666",
        p_confirmation_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        p_verified_channel: "email",
        p_available_channels: ["email"],
      }),
    );
    expect(mocks.rateLimit).toHaveBeenCalledOnce();
  });

  it("does not spend confirmation quota on an invalid signed link", async () => {
    const { POST } = await import("@/app/api/v1/reservations/confirm/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations/confirm", {
        method: "POST",
        body: JSON.stringify({ verificationToken: "x".repeat(80) }),
      }),
    );
    expect(response.status).toBe(404);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not substitute an available email adapter for an SMS verification", async () => {
    const { createReservationLinkToken } =
      await import("@/lib/reservations/link-token.server");
    const verificationToken = createReservationLinkToken({
      purpose: "verify",
      organizationId: client.organizationId,
      locationId: client.locationId,
      subjectId: "67676767-6767-4767-8767-676767676767",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      verifiedChannel: "sms",
    });
    const { POST } = await import("@/app/api/v1/reservations/confirm/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations/confirm", {
        method: "POST",
        body: JSON.stringify({ verificationToken }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "verification_unavailable" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a management-delivery result for a channel the token did not prove", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        status: "confirmed",
        manageDeliveryState: { sms: "queued" },
        replayed: false,
      },
      error: null,
    });
    const { createReservationLinkToken } =
      await import("@/lib/reservations/link-token.server");
    const verificationToken = createReservationLinkToken({
      purpose: "verify",
      organizationId: client.organizationId,
      locationId: client.locationId,
      subjectId: "68686868-6868-4868-8868-686868686868",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      verifiedChannel: "email",
    });
    const { POST } = await import("@/app/api/v1/reservations/confirm/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations/confirm", {
        method: "POST",
        body: JSON.stringify({ verificationToken }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "verification_unavailable" },
    });
  });

  it("never mislabels a delivery prerequisite failure as an expired hold", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000" },
    });
    const { createReservationLinkToken } =
      await import("@/lib/reservations/link-token.server");
    const verificationToken = createReservationLinkToken({
      purpose: "verify",
      organizationId: client.organizationId,
      locationId: client.locationId,
      subjectId: "77777777-7777-4777-8777-777777777777",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      verifiedChannel: "email",
    });
    const { POST } = await import("@/app/api/v1/reservations/confirm/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations/confirm", {
        method: "POST",
        body: JSON.stringify({ verificationToken }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "verification_unavailable" },
    });
  });

  it("fails confirmation safely before the RPC when providers are unavailable", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESERVATION_EMAIL_FROM;
    const { createReservationLinkToken } =
      await import("@/lib/reservations/link-token.server");
    const verificationToken = createReservationLinkToken({
      purpose: "verify",
      organizationId: client.organizationId,
      locationId: client.locationId,
      subjectId: "88888888-8888-4888-8888-888888888888",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      verifiedChannel: "email",
    });
    const { POST } = await import("@/app/api/v1/reservations/confirm/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations/confirm", {
        method: "POST",
        body: JSON.stringify({ verificationToken }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "verification_unavailable" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("recovers the same management session after commit-response loss", async () => {
    const { createReservationLinkToken } =
      await import("@/lib/reservations/link-token.server");
    const exchangeToken = createReservationLinkToken({
      purpose: "manage_exchange",
      organizationId: client.organizationId,
      locationId: client.locationId,
      subjectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const { POST } =
      await import("@/app/api/v1/reservations/manage/exchange/route");
    mocks.rpc.mockResolvedValueOnce({
      data: {
        manageExpiresAt: "2026-09-10T01:00:00.000Z",
        replayed: false,
      },
      error: null,
    });
    const first = await POST(
      new Request("https://os.example/api/v1/reservations/manage/exchange", {
        method: "POST",
        body: JSON.stringify({ exchangeToken }),
      }),
    );
    const firstPayload = await first.json();
    const firstHash = mocks.rpc.mock.calls[0][1].p_manage_token_hash;
    const firstBrowserBinding =
      mocks.rpc.mock.calls[0][1].p_browser_binding_hash;
    mocks.rpc.mockClear();
    mocks.rpc.mockResolvedValueOnce({
      data: {
        manageExpiresAt: "2026-09-10T01:00:00.000Z",
        replayed: true,
      },
      error: null,
    });
    const replay = await POST(
      new Request("https://os.example/api/v1/reservations/manage/exchange", {
        method: "POST",
        body: JSON.stringify({ exchangeToken }),
      }),
    );
    const replayPayload = await replay.json();
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replayPayload.data.manageToken).toBe(firstPayload.data.manageToken);
    expect(mocks.rpc.mock.calls[0][1].p_manage_token_hash).toBe(firstHash);
    expect(mocks.rpc.mock.calls[0][1].p_browser_binding_hash).toBe(
      firstBrowserBinding,
    );
    expect(firstBrowserBinding).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toContain(
      client.abuseIdentity,
    );
  });

  it("does not spend management-exchange quota on an invalid signed link", async () => {
    const { POST } =
      await import("@/app/api/v1/reservations/manage/exchange/route");
    const response = await POST(
      new Request("https://os.example/api/v1/reservations/manage/exchange", {
        method: "POST",
        body: JSON.stringify({ exchangeToken: "x".repeat(80) }),
      }),
    );
    expect(response.status).toBe(404);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects the same management link when another browser presents it", async () => {
    const { createReservationLinkToken } =
      await import("@/lib/reservations/link-token.server");
    const exchangeToken = createReservationLinkToken({
      purpose: "manage_exchange",
      organizationId: client.organizationId,
      locationId: client.locationId,
      subjectId: "abababab-abab-4bab-8bab-abababababab",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const { POST } =
      await import("@/app/api/v1/reservations/manage/exchange/route");
    mocks.authenticate.mockResolvedValueOnce(client).mockResolvedValueOnce({
      ...client,
      abuseIdentity: "77777777-7777-4777-8777-777777777777",
    });
    mocks.rpc
      .mockResolvedValueOnce({
        data: {
          manageExpiresAt: "2026-09-10T01:00:00.000Z",
          replayed: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    const first = await POST(
      new Request("https://os.example/api/v1/reservations/manage/exchange", {
        method: "POST",
        body: JSON.stringify({ exchangeToken }),
      }),
    );
    const firstBinding = mocks.rpc.mock.calls[0][1].p_browser_binding_hash;
    const forwarded = await POST(
      new Request("https://os.example/api/v1/reservations/manage/exchange", {
        method: "POST",
        body: JSON.stringify({ exchangeToken }),
      }),
    );
    const forwardedBinding = mocks.rpc.mock.calls[1][1].p_browser_binding_hash;
    expect(first.status).toBe(200);
    expect(forwarded.status).toBe(404);
    expect(firstBinding).not.toBe(forwardedBinding);
  });
});

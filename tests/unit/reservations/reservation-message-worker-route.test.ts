import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  channelBound: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => ({
            range: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/reservations/messaging.server", () => ({
  isReservationMessageChannelBound: mocks.channelBound,
  sendReservationOutboxMessage: mocks.send,
}));

const originalDeliverySecret = process.env.RESERVATION_DELIVERY_SECRET;
let claimedMessages: Array<ReturnType<typeof claimedMessage>> = [];
let completionError: { code: string } | null = null;
let completionThrows = false;
let completionStatusOverride: string | null = null;
let beginResults: Array<
  ReturnType<typeof begunMessage> | "cancelled" | "revoked" | "error"
> = [];

function claimedMessage(
  overrides: Partial<{
    id: string;
    claimToken: string;
    attempts: number;
  }> = {},
) {
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    claimToken: overrides.claimToken ?? "22222222-2222-4222-8222-222222222222",
    attempts: overrides.attempts ?? 1,
  };
}

function begunMessage(
  overrides: Partial<{
    id: string;
    channel: "email" | "sms";
    templateKey: string;
    templateData: Record<string, unknown>;
    recipientEmail: string | null;
    recipientPhone: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    status: "dispatching",
    attempts: 1,
    organizationId: "33333333-3333-4333-8333-333333333333",
    locationId: "44444444-4444-4444-8444-444444444444",
    reservationId: "55555555-5555-4555-8555-555555555555",
    bookingHoldId: null,
    waitlistEntryId: null,
    channel: overrides.channel ?? ("email" as const),
    templateKey: overrides.templateKey ?? "reservation_cancelled",
    templateData: overrides.templateData ?? {},
    messageCreatedAt: "2026-08-10T01:00:00.000Z",
    guestName: "Ada",
    recipientEmail:
      overrides.recipientEmail === undefined
        ? "ada@example.com"
        : overrides.recipientEmail,
    recipientPhone: overrides.recipientPhone ?? null,
    publicCode: "LY-1234",
    reservedAt: "2026-08-12T23:00:00.000Z",
    offerExpiresAt: null,
    holdExpiresAt: null,
    configurationVersion: 7,
  };
}

async function runWorker() {
  const { GET } = await import("@/app/api/internal/reservation-messages/route");
  return GET(
    new Request("https://os.example/api/internal/reservation-messages", {
      headers: {
        authorization: `Bearer ${process.env.RESERVATION_DELIVERY_SECRET}`,
      },
    }),
  );
}

beforeEach(() => {
  claimedMessages = [];
  completionError = null;
  completionThrows = false;
  completionStatusOverride = null;
  beginResults = [];
  process.env.RESERVATION_DELIVERY_SECRET = "d".repeat(48);
  mocks.channelBound.mockReset().mockReturnValue(true);
  mocks.send.mockReset().mockResolvedValue({
    state: "sent",
    providerMessageId: "provider_123",
  });
  mocks.rpc
    .mockReset()
    .mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "service_begin_reservation_delivery_run")
        return { data: { runId: args.p_run_id }, error: null };
      if (name === "service_complete_reservation_delivery_run")
        return { data: { runId: args.p_run_id, status: args.p_status }, error: null };
      if (name === "service_enqueue_reservation_reminders")
        return { data: null, error: null };
      if (name === "service_claim_reservation_message_outbox")
        return { data: claimedMessages, error: null };
      if (name === "service_begin_reservation_message_delivery") {
        const current =
          beginResults.shift() ?? begunMessage({ id: String(args.p_id) });
        if (current === "error")
          return { data: null, error: { code: "database_unavailable" } };
        if (current === "revoked")
          return { data: null, error: { code: "P0002" } };
        if (current === "cancelled")
          return {
            data: { id: args.p_id, status: "cancelled", attempts: 1 },
            error: null,
          };
        return { data: current, error: null };
      }
      if (name === "service_complete_reservation_message_outbox") {
        if (completionThrows) throw new Error("completion unavailable");
        return {
          data: completionError
            ? null
            : { status: completionStatusOverride ?? args.p_status },
          error: completionError,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
});

afterEach(() => {
  if (originalDeliverySecret === undefined)
    delete process.env.RESERVATION_DELIVERY_SECRET;
  else process.env.RESERVATION_DELIVERY_SECRET = originalDeliverySecret;
});

describe("reservation message worker completion accounting", () => {
  it("counts sent, failed, and skipped rows only after completion succeeds", async () => {
    claimedMessages = [
      claimedMessage({ id: "11111111-1111-4111-8111-111111111111" }),
      claimedMessage({ id: "22222222-2222-4222-8222-222222222222" }),
      claimedMessage({ id: "33333333-3333-4333-8333-333333333333" }),
    ];
    beginResults = [
      begunMessage({ id: "11111111-1111-4111-8111-111111111111" }),
      begunMessage({
        id: "22222222-2222-4222-8222-222222222222",
        recipientEmail: null,
      }),
      begunMessage({
        id: "33333333-3333-4333-8333-333333333333",
        templateKey: "unsupported_template",
      }),
    ];
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        sent: 1,
        failed: 1,
        skipped: 1,
        completionErrors: 0,
      },
    });
  });

  it("surfaces sent-row completion failure without reporting sent or failed", async () => {
    claimedMessages = [claimedMessage()];
    completionError = { code: "database_unavailable" };
    const response = await runWorker();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: { sent: 0, failed: 0, skipped: 0, completionErrors: 1 },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_complete_reservation_message_outbox",
      expect.objectContaining({
        p_claim_token: claimedMessages[0]!.claimToken,
        p_status: "sent",
      }),
    );
  });

  it("cancels a stale linked lifecycle before calling the provider", async () => {
    claimedMessages = [claimedMessage()];
    beginResults = ["cancelled"];
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { sent: 0, failed: 0, skipped: 1, completionErrors: 0 },
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_begin_reservation_message_delivery",
      expect.objectContaining({
        p_claim_token: claimedMessages[0]!.claimToken,
      }),
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "service_complete_reservation_message_outbox",
      expect.anything(),
    );
  });

  it("treats an atomically revoked claim as skipped without retrying it", async () => {
    claimedMessages = [claimedMessage()];
    beginResults = ["revoked"];
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { sent: 0, failed: 0, skipped: 1, completionErrors: 0 },
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "service_complete_reservation_message_outbox",
      expect.anything(),
    );
  });

  it("fails closed and schedules retry when begin delivery is unavailable", async () => {
    claimedMessages = [claimedMessage()];
    beginResults = ["error"];
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { sent: 0, failed: 1, skipped: 0, completionErrors: 0 },
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_complete_reservation_message_outbox",
      expect.objectContaining({
        p_status: "failed",
        p_error_code: "begin_delivery_unavailable",
        p_next_attempt_at: expect.any(String),
      }),
    );
  });

  it("uses only the exact begin snapshot for the provider call", async () => {
    claimedMessages = [claimedMessage()];
    beginResults = [
      begunMessage({
        recipientEmail: "fresh-recipient@example.com",
        templateData: { channel: "email", snapshot: "begin" },
      }),
    ];
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { sent: 1, failed: 0, skipped: 0, completionErrors: 0 },
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "fresh-recipient@example.com",
        messageId: begunMessage().id,
      }),
    );
    expect(mocks.send.mock.calls[0]![0]).not.toHaveProperty(
      "authorizeProviderCall",
    );
    const beginIndex = mocks.rpc.mock.calls.findIndex(
      ([name]) => name === "service_begin_reservation_message_delivery",
    );
    expect(beginIndex).toBeGreaterThan(-1);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("leaves a cancelled row reclaimable when cancellation completion fails", async () => {
    claimedMessages = [claimedMessage()];
    beginResults = [begunMessage({ templateKey: "unsupported_template" })];
    completionError = { code: "database_unavailable" };
    const response = await runWorker();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: { sent: 0, failed: 0, skipped: 0, completionErrors: 1 },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_complete_reservation_message_outbox",
      expect.objectContaining({
        p_claim_token: claimedMessages[0]!.claimToken,
        p_status: "cancelled",
      }),
    );
  });

  it("keeps a failed-delivery row on its lease when completion throws", async () => {
    claimedMessages = [claimedMessage()];
    beginResults = [begunMessage({ recipientEmail: null })];
    completionThrows = true;
    const response = await runWorker();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: { sent: 0, failed: 0, skipped: 0, completionErrors: 1 },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_complete_reservation_message_outbox",
      expect.objectContaining({
        p_claim_token: claimedMessages[0]!.claimToken,
        p_status: "failed",
        p_next_attempt_at: expect.any(String),
      }),
    );
  });

  it("rejects a completion response that does not confirm the requested state", async () => {
    claimedMessages = [claimedMessage()];
    beginResults = [begunMessage({ templateKey: "unsupported_template" })];
    completionStatusOverride = "sending";
    const response = await runWorker();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: { sent: 0, failed: 0, skipped: 0, completionErrors: 1 },
    });
  });
});

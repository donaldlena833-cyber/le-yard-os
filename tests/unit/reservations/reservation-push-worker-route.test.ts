import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
  decrypt: vi.fn(),
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/notifications/push-subscription", () => ({
  decryptPushSubscription: mocks.decrypt,
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: mocks.setVapidDetails,
    sendNotification: mocks.sendNotification,
  },
}));

const originalEnvironment = {
  secret: process.env.RESERVATION_DELIVERY_SECRET,
  enabled: process.env.RESERVATION_PUSH_DELIVERY_ENABLED,
  publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT,
};

let claimedPushes: Array<ReturnType<typeof claimedPush>> = [];
let claimError: { code: string } | null = null;
let beginState: "dispatching" | "cancelled" = "dispatching";
let currentDispatchPayload: ReturnType<typeof dispatchingPush>;
let completionError: { code: string } | null = null;
let completionThrows = false;

function claimedPush(
  overrides: Partial<{
    id: string;
    claimToken: string;
    attempts: number;
  }> = {},
) {
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    claimToken:
      overrides.claimToken ?? "22222222-2222-4222-8222-222222222222",
    organizationId: "33333333-3333-4333-8333-333333333333",
    notificationId: "44444444-4444-4444-8444-444444444444",
    subscriptionId: "55555555-5555-4555-8555-555555555555",
    attempts: overrides.attempts ?? 0,
    deliveryTopic: "11111111111141118111111111111111",
  };
}

function dispatchingPush(
  overrides: Partial<{
    encryptedSubscription: string;
    title: string;
    body: string | null;
    actionUrl: string | null;
    entityId: string | null;
    deliveryTopic: string;
  }> = {},
) {
  return {
    status: "dispatching" as const,
    attempts: 1,
    encryptedSubscription: overrides.encryptedSubscription ?? "\\xaa",
    title: overrides.title ?? "Reservation changed",
    body: overrides.body === undefined ? "A reservation changed." : overrides.body,
    actionUrl: overrides.actionUrl === undefined ? "/reservations" : overrides.actionUrl,
    entityId:
      overrides.entityId === undefined
        ? "66666666-6666-4666-8666-666666666666"
        : overrides.entityId,
    deliveryTopic:
      overrides.deliveryTopic ?? "11111111111141118111111111111111",
  };
}

async function runWorker(secret = process.env.RESERVATION_DELIVERY_SECRET) {
  const { POST } = await import("@/app/api/internal/reservation-push/route");
  return POST(
    new Request("https://os.example/api/internal/reservation-push", {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
  );
}

beforeEach(() => {
  claimedPushes = [];
  claimError = null;
  beginState = "dispatching";
  currentDispatchPayload = dispatchingPush();
  completionError = null;
  completionThrows = false;
  process.env.RESERVATION_DELIVERY_SECRET = "d".repeat(48);
  process.env.RESERVATION_PUSH_DELIVERY_ENABLED = "true";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
  process.env.VAPID_PRIVATE_KEY = "private-key";
  process.env.VAPID_SUBJECT = "mailto:ops@example.com";

  mocks.createAdminClient.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.decrypt.mockReset().mockReturnValue({
    endpoint: "https://push.example.test/subscription",
    expirationTime: null,
    keys: { p256dh: "p256dh", auth: "auth" },
  });
  mocks.setVapidDetails.mockReset();
  mocks.sendNotification
    .mockReset()
    .mockResolvedValue({ statusCode: 201, headers: {}, body: "" });
  mocks.rpc
    .mockReset()
    .mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "service_claim_reservation_push_deliveries")
        return { data: claimError ? null : claimedPushes, error: claimError };
      if (name === "service_begin_reservation_push_delivery")
        return {
          data:
            beginState === "dispatching"
              ? currentDispatchPayload
              : { status: "cancelled", attempts: 0 },
          error: null,
        };
      if (name === "service_complete_reservation_push_delivery") {
        if (completionThrows) throw new Error("completion unavailable");
        return {
          data: completionError ? null : { status: args.p_status },
          error: completionError,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
});

afterEach(() => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("RESERVATION_DELIVERY_SECRET", originalEnvironment.secret);
  restore("RESERVATION_PUSH_DELIVERY_ENABLED", originalEnvironment.enabled);
  restore("NEXT_PUBLIC_VAPID_PUBLIC_KEY", originalEnvironment.publicKey);
  restore("VAPID_PRIVATE_KEY", originalEnvironment.privateKey);
  restore("VAPID_SUBJECT", originalEnvironment.subject);
});

describe("reservation push leased worker", () => {
  it("rejects an unauthorized worker before database or provider access", async () => {
    const response = await runWorker("wrong-secret");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      data: { claimed: 0, sent: 0, completionErrors: 0 },
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("keeps provider delivery off unless the server-only switch is exactly true", async () => {
    process.env.RESERVATION_PUSH_DELIVERY_ENABLED = "TRUE";
    const response = await runWorker();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "Push delivery is disabled.",
      data: { claimed: 0, sent: 0 },
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it.each([
    "notification_read_failed",
    "preference_read_failed",
    "settings_read_failed",
    "subscription_read_failed",
    "delivery_read_failed",
  ])("fails closed when the atomic claim reports %s", async (code) => {
    claimError = { code };
    const response = await runWorker();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "Reservation push deliveries could not be claimed.",
      data: {
        claimed: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        uncertain: 0,
        completionErrors: 0,
        deferred: 0,
      },
    });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("counts provider success as sent only after claim-token completion is durable", async () => {
    claimedPushes = [claimedPush()];
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        claimed: 1,
        sent: 1,
        failed: 0,
        skipped: 0,
        uncertain: 0,
        completionErrors: 0,
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_begin_reservation_push_delivery",
      expect.objectContaining({
        p_id: claimedPushes[0]!.id,
        p_claim_token: claimedPushes[0]!.claimToken,
      }),
    );
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://push.example.test/subscription",
      }),
      expect.any(String),
      expect.objectContaining({
        timeout: 10_000,
        topic: currentDispatchPayload.deliveryTopic,
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_complete_reservation_push_delivery",
      expect.objectContaining({
        p_status: "sent",
        p_provider_status_code: 201,
      }),
    );
  });

  it("uses only the current subscription and content returned by begin", async () => {
    claimedPushes = [
      Object.assign(claimedPush(), {
        encryptedSubscription: "not-hex",
        title: "Stale title",
        body: "Stale body",
        actionUrl: "/stale",
        entityId: "77777777-7777-4777-8777-777777777777",
      }),
    ];
    currentDispatchPayload = dispatchingPush({
      encryptedSubscription: "\\xbb",
      title: "Current title",
      body: "Current body",
      actionUrl: "/current",
      entityId: "88888888-8888-4888-8888-888888888888",
      deliveryTopic: "current_dispatch_topic",
    });

    const response = await runWorker();

    expect(response.status).toBe(200);
    expect(mocks.decrypt).toHaveBeenCalledWith(Buffer.from([0xbb]));
    const [, serializedPayload, options] = mocks.sendNotification.mock.calls[0]!;
    expect(JSON.parse(serializedPayload)).toEqual({
      title: "Current title",
      body: "Current body",
      url: "/current",
      tag: "reservation-88888888-8888-4888-8888-888888888888",
    });
    expect(options).toMatchObject({ topic: "current_dispatch_topic" });
  });

  it("reports provider success plus completion loss without claiming a sent row", async () => {
    claimedPushes = [claimedPush()];
    completionError = { code: "database_unavailable" };
    const response = await runWorker();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: {
        claimed: 1,
        sent: 0,
        failed: 0,
        uncertain: 0,
        completionErrors: 1,
      },
    });
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("durably records an explicit provider failure and bounded retry before counting it", async () => {
    claimedPushes = [claimedPush()];
    mocks.sendNotification.mockRejectedValue(
      Object.assign(new Error("provider unavailable"), { statusCode: 503 }),
    );
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { claimed: 1, sent: 0, failed: 1, uncertain: 0 },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_complete_reservation_push_delivery",
      expect.objectContaining({
        p_status: "failed",
        p_error_code: "provider_http_503",
        p_next_attempt_at: expect.any(String),
        p_provider_status_code: 503,
        p_block_subscription: false,
      }),
    );
  });

  it("makes a transport-level provider failure terminally uncertain", async () => {
    claimedPushes = [claimedPush()];
    mocks.sendNotification.mockRejectedValue(new Error("socket timeout"));
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { claimed: 1, sent: 0, failed: 0, uncertain: 1 },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_complete_reservation_push_delivery",
      expect.objectContaining({
        p_status: "uncertain",
        p_error_code: "provider_transport_outcome_unknown",
        p_next_attempt_at: null,
      }),
    );
  });

  it("blocks an invalid provider subscription without deleting delivery evidence", async () => {
    claimedPushes = [claimedPush()];
    mocks.sendNotification.mockRejectedValue(
      Object.assign(new Error("gone"), { statusCode: 410 }),
    );
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { claimed: 1, sent: 0, skipped: 1, uncertain: 0 },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_complete_reservation_push_delivery",
      expect.objectContaining({
        p_status: "cancelled",
        p_error_code: "subscription_rejected_410",
        p_block_subscription: true,
      }),
    );
  });

  it("cancels corrupt subscription evidence before any provider attempt", async () => {
    claimedPushes = [claimedPush()];
    currentDispatchPayload = dispatchingPush({
      encryptedSubscription: "not-hex",
    });
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { claimed: 1, sent: 0, skipped: 1 },
    });
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_complete_reservation_push_delivery",
      expect.objectContaining({
        p_status: "cancelled",
        p_error_code: "subscription_ciphertext_invalid",
        p_block_subscription: true,
      }),
    );
  });

  it("does not contact the provider when eligibility changes after claim", async () => {
    claimedPushes = [claimedPush()];
    beginState = "cancelled";
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { claimed: 1, sent: 0, skipped: 1 },
    });
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("allows only one of two concurrent workers to receive the same atomic claim", async () => {
    const push = claimedPush();
    let leased = false;
    mocks.rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        if (name === "service_claim_reservation_push_deliveries") {
          if (leased) return { data: [], error: null };
          leased = true;
          return { data: [push], error: null };
        }
        if (name === "service_begin_reservation_push_delivery")
          return { data: dispatchingPush(), error: null };
        if (name === "service_complete_reservation_push_delivery")
          return { data: { status: args.p_status }, error: null };
        throw new Error(`Unexpected RPC: ${name}`);
      },
    );
    const responses = await Promise.all([runWorker(), runWorker()]);
    const bodies = await Promise.all(responses.map((entry) => entry.json()));
    expect(responses.map((entry) => entry.status)).toEqual([200, 200]);
    expect(bodies.map((entry) => entry.data.sent).sort()).toEqual([0, 1]);
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("uses the rotated token returned by bounded stale-lease recovery", async () => {
    const recovered = claimedPush({
      claimToken: "77777777-7777-4777-8777-777777777777",
      attempts: 2,
    });
    claimedPushes = [recovered];
    const response = await runWorker();
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_begin_reservation_push_delivery",
      expect.objectContaining({ p_claim_token: recovered.claimToken }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_complete_reservation_push_delivery",
      expect.objectContaining({ p_claim_token: recovered.claimToken }),
    );
  });

  it("stops further provider calls after durable completion becomes unavailable", async () => {
    claimedPushes = [
      claimedPush(),
      claimedPush({ id: "88888888-8888-4888-8888-888888888888" }),
    ];
    completionThrows = true;
    const response = await runWorker();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: {
        claimed: 2,
        sent: 0,
        failed: 0,
        skipped: 0,
        completionErrors: 1,
        deferred: 1,
      },
    });
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  removePushSubscriptionInputSchema,
  setNotificationPreferenceInputSchema,
} from "@/data/notification-schemas";
import type { WorkflowContext } from "@/data/execute";
import { removePushSubscription } from "@/data/workflows/notifications";
import {
  encryptPushSubscription,
  pushEndpointHash,
} from "@/lib/notifications/push-subscription";

vi.mock("server-only", () => ({}));

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  user: "33333333-3333-4333-8333-333333333333",
};
const hash = "a".repeat(64);

describe("notification preference and subscription contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("supports every derived notification type, including time-off decisions", () => {
    expect(setNotificationPreferenceInputSchema.safeParse({
      requestId: ids.request,
      organizationId: ids.organization,
      notificationType: "time_off_decided",
      inApp: false,
      email: false,
      push: false,
      quietHours: {},
    }).success).toBe(true);
  });

  it("accepts a visible endpoint hash for removal and rejects raw endpoints", () => {
    expect(removePushSubscriptionInputSchema.safeParse({
      requestId: ids.request,
      organizationId: ids.organization,
      endpointHash: hash,
    }).success).toBe(true);
    expect(removePushSubscriptionInputSchema.safeParse({
      requestId: ids.request,
      organizationId: ids.organization,
      endpoint: "https://push.example.test/subscription",
    }).success).toBe(false);
  });

  it("passes the already-derived endpoint hash to the actor-scoped removal RPC", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const context = {
      supabase: { rpc },
      actor: {
        userId: ids.user,
        aal: "aal1",
        memberships: [{
          organizationId: ids.organization,
          role: "employee",
          locationIds: [],
          organizationWide: false,
        }],
      },
    } as unknown as WorkflowContext;

    await removePushSubscription(context, {
      requestId: ids.request,
      organizationId: ids.organization,
      endpointHash: hash,
    });

    expect(rpc).toHaveBeenCalledWith("remove_push_subscription", {
      p_request_id: ids.request,
      p_organization_id: ids.organization,
      p_endpoint_hash: hash,
    });
  });

  it("hashes endpoints and encrypts subscription JSON with randomized AES-GCM evidence", () => {
    const subscription = {
      endpoint: "https://push.example.test/subscription/1",
      expirationTime: null,
      keys: { p256dh: "public-key-material", auth: "auth-secret" },
    };
    const key = Buffer.alloc(32, 7).toString("base64");
    const first = encryptPushSubscription(subscription, key);
    const second = encryptPushSubscription(subscription, key);

    expect(pushEndpointHash(subscription.endpoint)).toMatch(/^[0-9a-f]{64}$/u);
    expect(first[0]).toBe(1);
    expect(first.equals(second)).toBe(false);
    expect(first.toString("utf8")).not.toContain(subscription.endpoint);
  });
});

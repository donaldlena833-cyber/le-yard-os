import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/messaging/identity-delivery.server", () => ({
  sendIdentityDelivery: mocks.send,
}));

import { POST } from "@/app/api/internal/identity-delivery/route";

const job = {
  id: "11111111-1111-4111-8111-111111111111",
  claimToken: "22222222-2222-4222-8222-222222222222",
  workflow: "guest_interest_verification",
  correlationId: "33333333-3333-4333-8333-333333333333",
  organizationId: "44444444-4444-4444-8444-444444444444",
  locationId: "55555555-5555-4555-8555-555555555555",
  channel: "email",
  destination: "guest@example.com",
  destinationHash: "a".repeat(64),
  templateData: { expiresAt: "2026-08-25T12:00:00Z" },
  attempts: 1,
};

describe("identity delivery worker", () => {
  beforeEach(() => {
    vi.stubEnv("IDENTITY_DELIVERY_SECRET", "i".repeat(48));
    mocks.rpc.mockReset().mockImplementation(async (name: string) => {
      if (name === "service_claim_identity_delivery")
        return { data: [job], error: null };
      if (name === "service_complete_identity_delivery")
        return { data: { status: "sent" }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });
    mocks.send.mockReset().mockResolvedValue({
      state: "sent",
      providerMessageId: "delivery-1",
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects before claiming and accounts only completed rows", async () => {
    const unauthorized = await POST(
      new Request("https://os.example/api/internal/identity-delivery", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const response = await POST(
      new Request("https://os.example/api/internal/identity-delivery", {
        method: "POST",
        headers: { authorization: `Bearer ${"i".repeat(48)}` },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { sent: 1, failed: 0, completionErrors: 0 },
    });
    expect(mocks.send).toHaveBeenCalledWith(job);
  });
});

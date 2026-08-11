import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

import {
  enforceBookingContactRateLimit,
  type BookingApiClientContext,
} from "@/lib/reservations/api-auth.server";

const client: BookingApiClientContext = {
  id: "99999999-9999-4999-8999-999999999999",
  organizationId: "11111111-1111-4111-8111-111111111111",
  locationId: "22222222-2222-4222-8222-222222222222",
  name: "Public site",
  scopes: ["reservations:write"],
  abuseIdentity: "88888888-8888-4888-8888-888888888888",
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: { allowed: true }, error: null });
});

describe("public booking contact limiter", () => {
  it("claims independent opaque email and phone buckets", async () => {
    await enforceBookingContactRateLimit(
      new Request("https://os.example/api/v1/reservations"),
      client,
      "Ada@Example.com",
      "+1 (212) 555-0100",
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    const argumentsJson = JSON.stringify(mocks.rpc.mock.calls);
    const bucketHashes = mocks.rpc.mock.calls.map(
      (call) => call[1].p_bucket_hash,
    );
    expect(new Set(bucketHashes).size).toBe(2);
    expect(bucketHashes).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
    expect(argumentsJson).not.toContain("ada@example.com");
    expect(argumentsJson).not.toContain("2125550100");
  });

  it("fails closed when either bucket claim errors", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { allowed: true }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "database_error" } });
    await expect(
      enforceBookingContactRateLimit(
        new Request("https://os.example/api/v1/reservations"),
        client,
        "ada@example.com",
        "+1 212 555 0100",
      ),
    ).rejects.toMatchObject({ status: 503, code: "rate_limit_unavailable" });
  });

  it("returns one generic denial when either independent bucket is exhausted", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { allowed: false }, error: null })
      .mockResolvedValueOnce({ data: { allowed: true }, error: null });
    await expect(
      enforceBookingContactRateLimit(
        new Request("https://os.example/api/v1/reservations"),
        client,
        "ada@example.com",
        "+1 212 555 0100",
      ),
    ).rejects.toMatchObject({ status: 429, code: "contact_rate_limited" });
  });
});

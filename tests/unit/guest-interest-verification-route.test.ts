import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

import { GET, POST } from "@/app/api/v1/guest-interest/verify/route";
import { guestInterestVerificationToken } from "@/lib/guest-interest-verification.server";

describe("guest-interest verification route", () => {
  beforeEach(() => {
    vi.stubEnv("GUEST_INTEREST_VERIFICATION_SECRET", "v".repeat(48));
    mocks.rpc.mockReset().mockResolvedValue({
      data: { status: "verified", replayed: false },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("renders a non-mutating review form, then finalizes only on POST", async () => {
    const token = guestInterestVerificationToken({
      requestId: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      locationId: "33333333-3333-4333-8333-333333333333",
      destinationHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const getResponse = await GET(
      new Request(
        `https://os.example/api/v1/guest-interest/verify?token=${encodeURIComponent(token)}`,
        { headers: { accept: "text/html" } },
      ),
    );
    expect(getResponse.status).toBe(200);
    expect(await getResponse.text()).toContain("Confirm email");
    expect(mocks.rpc).not.toHaveBeenCalled();

    const postResponse = await POST(
      new Request("https://os.example/api/v1/guest-interest/verify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }),
    );
    expect(postResponse.status).toBe(200);
    expect(await postResponse.text()).toContain("You’re confirmed");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_finalize_guest_interest",
      expect.objectContaining({
        p_request_id: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  guestInterestDestinationHash,
  guestInterestVerificationToken,
  guestInterestVerificationTokenHash,
  parseGuestInterestVerificationToken,
} from "@/lib/guest-interest-verification.server";

describe("guest-interest destination verification", () => {
  beforeEach(() => {
    vi.stubEnv("GUEST_INTEREST_VERIFICATION_SECRET", "v".repeat(48));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("binds the exact tenant destination and rejects tampering or expiry", () => {
    const payload = {
      requestId: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      locationId: "33333333-3333-4333-8333-333333333333",
      destinationHash: guestInterestDestinationHash(
        "22222222-2222-4222-8222-222222222222",
        "Guest@Example.com ",
      ),
      expiresAt: "2026-08-25T12:00:00.000Z",
    };
    const token = guestInterestVerificationToken(payload);
    expect(parseGuestInterestVerificationToken(token, Date.parse("2026-08-24T12:00:00Z"))).toEqual(payload);
    expect(guestInterestVerificationTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(() =>
      parseGuestInterestVerificationToken(`${token.slice(0, -1)}x`),
    ).toThrow(/invalid/);
    expect(() =>
      parseGuestInterestVerificationToken(token, Date.parse(payload.expiresAt)),
    ).toThrow(/expired/);
  });
});

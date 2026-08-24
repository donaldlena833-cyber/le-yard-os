import { describe, expect, it } from "vitest";
import { guestInterestInputSchema } from "@/lib/guest-interest";
import { guestInterestContactRateLimitBucketHashes } from "@/lib/reservations/api-auth.server";

const baseInput = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phone: null,
  birthdayMonth: null,
  birthdayDay: null,
  age21Plus: null,
  interests: [],
  emailConsent: true as const,
  smsConsent: false,
  profileConsent: false,
  source: "coming_soon" as const,
};

describe("guest interest capture", () => {
  it("accepts a minimal email signup without profile data", () => {
    expect(guestInterestInputSchema.parse(baseInput)).toMatchObject({
      email: "ada@example.com",
      emailConsent: true,
    });
  });

  it("requires explicit personalization consent for birthday and interests", () => {
    expect(
      guestInterestInputSchema.safeParse({
        ...baseInput,
        birthdayMonth: 12,
        birthdayDay: 10,
        interests: ["reservations"],
      }).success,
    ).toBe(false);
  });

  it("rejects impossible birthday month-day pairs", () => {
    expect(
      guestInterestInputSchema.safeParse({
        ...baseInput,
        birthdayMonth: 2,
        birthdayDay: 30,
        profileConsent: true,
      }).success,
    ).toBe(false);
  });

  it("requires a mobile number for text consent", () => {
    expect(
      guestInterestInputSchema.safeParse({
        ...baseInput,
        smsConsent: true,
      }).success,
    ).toBe(false);
  });

  it("normalizes contact values before deriving rate-limit buckets", () => {
    expect(
      guestInterestContactRateLimitBucketHashes({
        clientId: "site",
        path: "/api/v1/guest-interest",
        email: " ADA@EXAMPLE.COM ",
        phone: "+1 (212) 555-0188",
      }),
    ).toEqual(
      guestInterestContactRateLimitBucketHashes({
        clientId: "site",
        path: "/api/v1/guest-interest",
        email: "ada@example.com",
        phone: "12125550188",
      }),
    );
  });
});

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  bookingGlobalRateLimitMultiplier,
  bookingContactRateLimitBucketHashes,
  bookingRateLimitBucketHashes,
  BookingApiError,
  managementExchangeBrowserBindingHash,
  readBookingJson,
  trustedAbuseIdentity,
} from "@/lib/reservations/api-auth.server";
import { isIsoCalendarDate } from "@/lib/reservations/availability";
import {
  createReservationLinkToken,
  requireReservationLinkScope,
  verifyReservationLinkToken,
} from "@/lib/reservations/link-token.server";
import { canonicalReservationPublicSiteOrigin } from "@/lib/reservations/public-origin.server";

const originalSigningSecret = process.env.RESERVATION_LINK_SIGNING_SECRET;

afterEach(() => {
  if (originalSigningSecret === undefined)
    delete process.env.RESERVATION_LINK_SIGNING_SECRET;
  else
    process.env.RESERVATION_LINK_SIGNING_SECRET = originalSigningSecret;
});

describe("server-owned reservation links", () => {
  it("signs deterministic tenant-scoped tokens without stored raw secrets", () => {
    process.env.RESERVATION_LINK_SIGNING_SECRET = "s".repeat(48);
    const payload = {
      purpose: "verify" as const,
      organizationId: "11111111-1111-4111-8111-111111111111",
      locationId: "22222222-2222-4222-8222-222222222222",
      subjectId: "33333333-3333-4333-8333-333333333333",
      expiresAt: "2026-08-10T02:00:00.000Z",
      verifiedChannel: "email" as const,
    };
    const first = createReservationLinkToken(payload);
    expect(createReservationLinkToken(payload)).toBe(first);
    expect(
      verifyReservationLinkToken(
        first,
        "verify",
        new Date("2026-08-10T01:00:00.000Z").valueOf(),
      ),
    ).toMatchObject(payload);
    expect(() =>
      requireReservationLinkScope(
        verifyReservationLinkToken(
          first,
          "verify",
          new Date("2026-08-10T01:00:00.000Z").valueOf(),
        ),
        {
          organizationId: payload.organizationId,
          locationId: "44444444-4444-4444-8444-444444444444",
        },
      ),
    ).toThrowError(BookingApiError);
  });

  it("rejects expired and purpose-confused tokens", () => {
    process.env.RESERVATION_LINK_SIGNING_SECRET = "s".repeat(48);
    const token = createReservationLinkToken({
      purpose: "verify",
      organizationId: "11111111-1111-4111-8111-111111111111",
      locationId: "22222222-2222-4222-8222-222222222222",
      subjectId: "33333333-3333-4333-8333-333333333333",
      expiresAt: "2026-08-10T02:00:00.000Z",
      verifiedChannel: "email",
    });
    expect(() =>
      verifyReservationLinkToken(
        token,
        "manage_exchange",
        new Date("2026-08-10T01:00:00.000Z").valueOf(),
      ),
    ).toThrowError(BookingApiError);
    expect(() =>
      verifyReservationLinkToken(
        token,
        "verify",
        new Date("2026-08-10T03:00:00.000Z").valueOf(),
      ),
    ).toThrowError(BookingApiError);
  });

  it("binds verification links to exactly one delivered contact channel", () => {
    process.env.RESERVATION_LINK_SIGNING_SECRET = "s".repeat(48);
    const shared = {
      purpose: "verify" as const,
      organizationId: "11111111-1111-4111-8111-111111111111",
      locationId: "22222222-2222-4222-8222-222222222222",
      subjectId: "33333333-3333-4333-8333-333333333333",
      expiresAt: "2026-08-10T02:00:00.000Z",
    };
    const emailToken = createReservationLinkToken({
      ...shared,
      verifiedChannel: "email",
    });
    const smsToken = createReservationLinkToken({
      ...shared,
      verifiedChannel: "sms",
    });
    expect(emailToken).not.toBe(smsToken);
    expect(
      verifyReservationLinkToken(
        emailToken,
        "verify",
        new Date("2026-08-10T01:00:00.000Z").valueOf(),
      ).verifiedChannel,
    ).toBe("email");
    expect(
      verifyReservationLinkToken(
        smsToken,
        "verify",
        new Date("2026-08-10T01:00:00.000Z").valueOf(),
      ).verifiedChannel,
    ).toBe("sms");
    const [payload, signature] = emailToken.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    decoded.verifiedChannel = "sms";
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
    expect(() =>
      verifyReservationLinkToken(
        tampered,
        "verify",
        new Date("2026-08-10T01:00:00.000Z").valueOf(),
      ),
    ).toThrowError(BookingApiError);
  });
});

describe("public request hardening", () => {
  it("uses independent opaque email and phone contact buckets", () => {
    const input = {
      clientId: "99999999-9999-4999-8999-999999999999",
      path: "/api/v1/reservations",
      email: "Ada@Example.com",
      phone: "+1 (212) 555-0100",
    };
    const first = bookingContactRateLimitBucketHashes(input);
    const changedPhone = bookingContactRateLimitBucketHashes({
      ...input,
      phone: "+1 (212) 555-0199",
    });
    const changedEmail = bookingContactRateLimitBucketHashes({
      ...input,
      email: "grace@example.com",
    });
    expect(first.email).toMatch(/^[0-9a-f]{64}$/);
    expect(first.phone).toMatch(/^[0-9a-f]{64}$/);
    expect(changedPhone.email).toBe(first.email);
    expect(changedPhone.phone).not.toBe(first.phone);
    expect(changedEmail.email).not.toBe(first.email);
    expect(changedEmail.phone).toBe(first.phone);
    expect(JSON.stringify(first)).not.toContain("ada@example.com");
    expect(JSON.stringify(first)).not.toContain("2125550100");
  });

  it("binds management exchange replay to one trusted BFF browser identity", () => {
    const first = managementExchangeBrowserBindingHash({
      id: "99999999-9999-4999-8999-999999999999",
      abuseIdentity: "88888888-8888-4888-8888-888888888888",
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(
      managementExchangeBrowserBindingHash({
        id: "99999999-9999-4999-8999-999999999999",
        abuseIdentity: "77777777-7777-4777-8777-777777777777",
      }),
    ).not.toBe(first);
    expect(() =>
      managementExchangeBrowserBindingHash({
        id: "99999999-9999-4999-8999-999999999999",
        abuseIdentity: "untrusted",
      }),
    ).toThrowError(BookingApiError);
  });

  it("accepts only canonical safe public-site origins for signed links", () => {
    expect(
      canonicalReservationPublicSiteOrigin(
        "https://www.leyard.example",
        true,
      ),
    ).toBe("https://www.leyard.example");
    expect(
      canonicalReservationPublicSiteOrigin("http://localhost:3000", false),
    ).toBe("http://localhost:3000");
    for (const invalid of [
      "https://user:pass@www.leyard.example",
      "https://www.leyard.example/reservations",
      "https://www.leyard.example?redirect=evil",
      "https://www.leyard.example#fragment",
      "http://www.leyard.example",
      "http://localhost:3000",
    ])
      expect(canonicalReservationPublicSiteOrigin(invalid, true)).toBeNull();
    expect(
      canonicalReservationPublicSiteOrigin(
        "http://www.leyard.example",
        false,
      ),
    ).toBeNull();
  });

  it("keeps the resettable-client global ceiling deliberately narrow", () => {
    expect(bookingGlobalRateLimitMultiplier(undefined)).toBe(2);
    expect(bookingGlobalRateLimitMultiplier("3")).toBe(3);
    expect(bookingGlobalRateLimitMultiplier("100")).toBe(2);
    expect(bookingGlobalRateLimitMultiplier("invalid")).toBe(2);
  });

  it("isolates rate-limit buckets by HTTP method and route", () => {
    const shared = {
      clientId: "99999999-9999-4999-8999-999999999999",
      abuseIdentity: "88888888-8888-4888-8888-888888888888",
      path: "/api/v1/reservations",
    };
    const getBuckets = bookingRateLimitBucketHashes({
      ...shared,
      method: "GET",
    });
    const patchBuckets = bookingRateLimitBucketHashes({
      ...shared,
      method: "PATCH",
    });
    const deleteBuckets = bookingRateLimitBucketHashes({
      ...shared,
      method: "DELETE",
    });
    expect(getBuckets.identity).toMatch(/^[0-9a-f]{64}$/);
    expect(getBuckets.global).toMatch(/^[0-9a-f]{64}$/);
    expect(patchBuckets).not.toEqual(getBuckets);
    expect(deleteBuckets).not.toEqual(getBuckets);
    expect(deleteBuckets).not.toEqual(patchBuckets);
  });

  it("uses only a fresh API-key HMAC identity and ignores proxy headers", () => {
    const key = "k".repeat(40);
    const identity = "11111111-1111-4111-8111-111111111111";
    const timestamp = "1786323600";
    const signature = createHmac("sha256", key)
      .update(`${timestamp}.${identity}`)
      .digest("hex");
    const request = new Request("https://os.example/api/v1/availability", {
      headers: {
        "x-booking-abuse-identity": identity,
        "x-booking-abuse-timestamp": timestamp,
        "x-booking-abuse-signature": signature,
        "x-forwarded-for": "203.0.113.9",
        "x-real-ip": "203.0.113.10",
      },
    });
    expect(
      trustedAbuseIdentity(
        request,
        key,
        new Date("2026-08-10T01:00:00.000Z").valueOf(),
      ),
    ).toBe(identity);
    expect(trustedAbuseIdentity(request, `${key}x`)).toBe("untrusted");
  });

  it("bounds the actual UTF-8 body and rejects invalid JSON", async () => {
    await expect(
      readBookingJson(
        new Request("https://os.example/api", {
          method: "POST",
          body: '"é"',
        }),
        "Too large.",
        3,
      ),
    ).rejects.toMatchObject({ status: 413, code: "request_too_large" });
    await expect(
      readBookingJson(
        new Request("https://os.example/api", {
          method: "POST",
          body: "not-json",
        }),
        "Too large.",
      ),
    ).rejects.toMatchObject({ status: 400, code: "invalid_json" });
  });

  it("accepts only real calendar dates", () => {
    expect(isIsoCalendarDate("2028-02-29")).toBe(true);
    expect(isIsoCalendarDate("2026-02-29")).toBe(false);
    expect(isIsoCalendarDate("2026-13-01")).toBe(false);
  });
});

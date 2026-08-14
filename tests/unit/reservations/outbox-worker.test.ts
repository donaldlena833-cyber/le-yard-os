import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isReservationMessageChannelBound,
  sendReservationOutboxMessage,
} from "@/lib/reservations/messaging.server";
import {
  reservationMessageClaimIsLeaseSafe,
  reservationMessageClaimLimit,
  reservationMessageLeaseSeconds,
  reservationProviderTimeoutMs,
} from "@/lib/reservations/outbox-policy";

const workerUrl = new URL(
  "../../../src/app/api/internal/reservation-messages/route.ts",
  import.meta.url,
);

const originalResendKey = process.env.RESEND_API_KEY;
const originalReservationFrom = process.env.RESERVATION_EMAIL_FROM;
const originalReservationReplyTo = process.env.RESERVATION_EMAIL_REPLY_TO;
const originalReservationPublicSiteUrl = process.env.RESERVATION_PUBLIC_SITE_URL;
const originalReservationLinkSigningSecret =
  process.env.RESERVATION_LINK_SIGNING_SECRET;
const originalSmsEnabled = process.env.RESERVATION_SMS_DELIVERY_ENABLED;
const originalTwilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const originalTwilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const originalTwilioFrom = process.env.TWILIO_FROM_NUMBER;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalResendKey;
  if (originalReservationFrom === undefined)
    delete process.env.RESERVATION_EMAIL_FROM;
  else process.env.RESERVATION_EMAIL_FROM = originalReservationFrom;
  if (originalReservationReplyTo === undefined)
    delete process.env.RESERVATION_EMAIL_REPLY_TO;
  else process.env.RESERVATION_EMAIL_REPLY_TO = originalReservationReplyTo;
  if (originalReservationPublicSiteUrl === undefined)
    delete process.env.RESERVATION_PUBLIC_SITE_URL;
  else process.env.RESERVATION_PUBLIC_SITE_URL = originalReservationPublicSiteUrl;
  if (originalReservationLinkSigningSecret === undefined)
    delete process.env.RESERVATION_LINK_SIGNING_SECRET;
  else
    process.env.RESERVATION_LINK_SIGNING_SECRET =
      originalReservationLinkSigningSecret;
  if (originalSmsEnabled === undefined)
    delete process.env.RESERVATION_SMS_DELIVERY_ENABLED;
  else process.env.RESERVATION_SMS_DELIVERY_ENABLED = originalSmsEnabled;
  if (originalTwilioAccountSid === undefined)
    delete process.env.TWILIO_ACCOUNT_SID;
  else process.env.TWILIO_ACCOUNT_SID = originalTwilioAccountSid;
  if (originalTwilioAuthToken === undefined)
    delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = originalTwilioAuthToken;
  if (originalTwilioFrom === undefined) delete process.env.TWILIO_FROM_NUMBER;
  else process.env.TWILIO_FROM_NUMBER = originalTwilioFrom;
});

describe("reservation maintenance worker", () => {
  it("expires every explicit tenant/location scope before reminders and claims", async () => {
    const source = await readFile(workerUrl, "utf8");
    const expiry = source.indexOf("service_expire_reservation_deadlines");
    const reminders = source.indexOf("service_enqueue_reservation_reminders");
    const claim = source.indexOf("service_claim_reservation_message_outbox");
    expect(expiry).toBeGreaterThan(-1);
    expect(reminders).toBeGreaterThan(expiry);
    expect(claim).toBeGreaterThan(reminders);
    expect(source).toContain("p_organization_id: scope.organizationId");
    expect(source).toContain("p_location_id: scope.locationId");
  });

  it("uses leased atomic claim and claim-token completion RPCs", async () => {
    const source = await readFile(workerUrl, "utf8");
    expect(source).toContain("service_claim_reservation_message_outbox");
    expect(source).toContain("p_lease_seconds: reservationMessageLeaseSeconds");
    expect(source).toContain("p_limit: reservationMessageClaimLimit");
    expect(source).toContain("service_complete_reservation_message_outbox");
    expect(source).toContain("service_begin_reservation_message_delivery");
    expect(source).toContain("p_claim_token: claim.claimToken");
    expect(source).toContain(
      "p_provider_message_id: delivered.providerMessageId",
    );
    expect(source).not.toContain('.from("reservation_message_outbox")');
    expect(source).not.toContain("service_validate_reservation_message_claim");
    expect(
      source.indexOf("service_begin_reservation_message_delivery"),
    ).toBeLessThan(source.indexOf("sendReservationOutboxMessage({"));
    expect(source).toContain("const message = begun.message");
  });

  it("keeps the sequential provider batch inside the lease safety budget", () => {
    expect(reservationMessageClaimLimit).toBe(8);
    expect(reservationMessageClaimIsLeaseSafe()).toBe(true);
    expect(
      reservationMessageClaimLimit * reservationProviderTimeoutMs,
    ).toBeLessThanOrEqual((reservationMessageLeaseSeconds * 1_000 * 2) / 3);
  });

  it("rejects verification and management messages whose metadata names another channel", () => {
    expect(
      isReservationMessageChannelBound({
        channel: "email",
        templateKey: "reservation_verify",
        templateData: { purpose: "reservation_verify", channel: "email" },
      }),
    ).toBe(true);
    expect(
      isReservationMessageChannelBound({
        channel: "email",
        templateKey: "reservation_verify",
        templateData: { purpose: "reservation_verify", channel: "sms" },
      }),
    ).toBe(false);
    expect(
      isReservationMessageChannelBound({
        channel: "sms",
        templateKey: "reservation_confirmed",
        templateData: {
          purpose: "reservation_manage_exchange",
          channel: "email",
        },
      }),
    ).toBe(false);
    expect(
      isReservationMessageChannelBound({
        channel: "email",
        templateKey: "reservation_modified",
        templateData: { channel: "sms", publicCode: "LY-1234" },
      }),
    ).toBe(false);
    expect(
      isReservationMessageChannelBound({
        channel: "email",
        templateKey: "reservation_modified",
        templateData: { publicCode: "LY-1234" },
      }),
    ).toBe(true);
    expect(
      isReservationMessageChannelBound({
        channel: "email",
        templateKey: "reservation_modified",
        templateData: { channel: null, publicCode: "LY-1234" },
      }),
    ).toBe(true);
  });

  it("captures a bounded provider message ID for outbox completion", async () => {
    process.env.RESEND_API_KEY = "resend-test";
    process.env.RESERVATION_EMAIL_FROM = "reservations@leyard.example";
    process.env.RESERVATION_EMAIL_REPLY_TO = "donaldlena833@gmail.com";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email_123" }), { status: 200 }),
      );
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );
    await expect(
      sendReservationOutboxMessage({
        messageId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        locationId: "33333333-3333-4333-8333-333333333333",
        reservationId: "44444444-4444-4444-8444-444444444444",
        bookingHoldId: null,
        channel: "email",
        templateKey: "reservation_cancelled",
        guestName: "Ada",
        email: "ada@example.com",
        phone: null,
        publicCode: "LY-1234",
        reservedAt: "2026-08-12T23:00:00.000Z",
        offerExpiresAt: null,
        holdExpiresAt: null,
        messageCreatedAt: "2026-08-10T01:00:00.000Z",
      }),
    ).resolves.toEqual({ state: "sent", providerMessageId: "email_123" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject(
      {
        from: "reservations@leyard.example",
        reply_to: "donaldlena833@gmail.com",
        to: ["ada@example.com"],
      },
    );
  });

  it("sends a clean confirmation email without exposing the internal code", async () => {
    process.env.RESEND_API_KEY = "resend-test";
    process.env.RESERVATION_EMAIL_FROM = "reservations@leyard.example";
    process.env.RESERVATION_PUBLIC_SITE_URL = "https://www.leyard.example";
    process.env.RESERVATION_LINK_SIGNING_SECRET = "s".repeat(48);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email_confirmed" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendReservationOutboxMessage({
        messageId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        locationId: "33333333-3333-4333-8333-333333333333",
        reservationId: "44444444-4444-4444-8444-444444444444",
        bookingHoldId: null,
        channel: "email",
        templateKey: "reservation_confirmed",
        guestName: "Ada",
        email: "ada@example.com",
        phone: null,
        publicCode: "LY-1234",
        reservedAt: "2026-08-12T23:00:00.000Z",
        offerExpiresAt: null,
        holdExpiresAt: null,
        messageCreatedAt: "2026-08-10T01:00:00.000Z",
      }),
    ).resolves.toEqual({ state: "sent", providerMessageId: "email_confirmed" });

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      subject: string;
      html: string;
    };
    expect(payload.subject).toBe("Your table at Le Yard is booked");
    expect(payload.html).toContain("Your table is booked.");
    expect(payload.html).toContain("Date &amp; time");
    expect(payload.html).toContain("View or manage reservation");
    expect(payload.html).not.toContain("LY-1234");
    expect(payload.html.toLowerCase()).not.toContain("confirmation number");
  });

  it("returns not configured without calling Twilio when SMS is disabled", async () => {
    process.env.RESERVATION_SMS_DELIVERY_ENABLED = "false";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "twilio-test";
    process.env.TWILIO_FROM_NUMBER = "+12125550100";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendReservationOutboxMessage({
        messageId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        locationId: "33333333-3333-4333-8333-333333333333",
        reservationId: "44444444-4444-4444-8444-444444444444",
        bookingHoldId: null,
        channel: "sms",
        templateKey: "reservation_cancelled",
        guestName: "Ada",
        email: null,
        phone: "+12125550199",
        publicCode: "LY-1234",
        reservedAt: "2026-08-12T23:00:00.000Z",
        offerExpiresAt: null,
        holdExpiresAt: null,
        messageCreatedAt: "2026-08-10T01:00:00.000Z",
      }),
    ).resolves.toEqual({ state: "not_configured", providerMessageId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends through Twilio only when the exact switch and credentials are present", async () => {
    process.env.RESERVATION_SMS_DELIVERY_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "twilio-test";
    process.env.TWILIO_FROM_NUMBER = "+12125550100";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ sid: "SM123" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendReservationOutboxMessage({
        messageId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        locationId: "33333333-3333-4333-8333-333333333333",
        reservationId: "44444444-4444-4444-8444-444444444444",
        bookingHoldId: null,
        channel: "sms",
        templateKey: "reservation_cancelled",
        guestName: "Ada",
        email: null,
        phone: "+12125550199",
        publicCode: "LY-1234",
        reservedAt: "2026-08-12T23:00:00.000Z",
        offerExpiresAt: null,
        holdExpiresAt: null,
        messageCreatedAt: "2026-08-10T01:00:00.000Z",
      }),
    ).resolves.toEqual({ state: "sent", providerMessageId: "SM123" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "api.twilio.com/2010-04-01/Accounts/AC123/Messages.json",
    );
  });

  it("keeps credential completeness as a second SMS prerequisite", async () => {
    process.env.RESERVATION_SMS_DELIVERY_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "twilio-test";
    delete process.env.TWILIO_FROM_NUMBER;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendReservationOutboxMessage({
        messageId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        locationId: "33333333-3333-4333-8333-333333333333",
        reservationId: "44444444-4444-4444-8444-444444444444",
        bookingHoldId: null,
        channel: "sms",
        templateKey: "reservation_cancelled",
        guestName: "Ada",
        email: null,
        phone: "+12125550199",
        publicCode: "LY-1234",
        reservedAt: "2026-08-12T23:00:00.000Z",
        offerExpiresAt: null,
        holdExpiresAt: null,
        messageCreatedAt: "2026-08-10T01:00:00.000Z",
      }),
    ).resolves.toEqual({ state: "not_configured", providerMessageId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
